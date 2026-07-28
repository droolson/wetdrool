import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { mediaWorkerOriginSchema } from './config.js';
import { MediaWorkerError } from './errors.js';
import { listAllowedMediaTypes } from './mime.js';
import { mediaWorkerOpenApiDocument } from './openapi.js';
import {
  chunkDigestSchema,
  maximumChunkBytes,
  maximumUploadBytes,
  uploadCreateSchema,
  uploadIdSchema,
  uploadOffsetSchema,
  type UploadCreateInput,
} from './schemas.js';
import type { MediaWorkerService } from './service.js';

const parametersSchema = z.object({ uploadId: uploadIdSchema }).strict();
const maximumDeclarationBytes = 64_000;
const chunkHeadersSchema = z
  .object({
    'upload-offset': uploadOffsetSchema,
    'upload-chunk-sha256': chunkDigestSchema,
  })
  .loose();

export interface MediaWorkerAppOptions {
  readonly service: MediaWorkerService;
  readonly logger?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly rateLimitMax?: number;
  readonly authorizeRequest?: (input: {
    readonly action: 'create' | 'claim' | 'read' | 'append' | 'cancel' | 'finalize';
    readonly uploadId?: string;
    readonly authorization: string | undefined;
    readonly declaration?: UploadAuthorizationDeclaration;
  }) => boolean | Promise<boolean>;
}

export type UploadAuthorizationDeclaration = Readonly<
  Pick<UploadCreateInput, 'declaredMediaType' | 'processingMode' | 'storagePolicy' | 'totalBytes'>
>;

export async function buildMediaWorkerApp(
  options: MediaWorkerAppOptions,
): Promise<FastifyInstance> {
  const allowedOrigins =
    options.allowedOrigins === undefined
      ? undefined
      : [...new Set(options.allowedOrigins.map((origin) => mediaWorkerOriginSchema.parse(origin)))];
  await options.service.initialize();
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: 'info',
            base: { service: '@wokesocial/media-worker' },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers.upload-chunk-sha256',
                'req.body',
                'request.body',
              ],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: maximumChunkBytes,
    connectionTimeout: 5_000,
    keepAliveTimeout: 5_000,
    requestTimeout: 180_000,
    requestIdHeader: 'x-request-id',
  });
  app.addContentTypeParser(
    'application/offset+octet-stream',
    { parseAs: 'buffer', bodyLimit: maximumChunkBytes },
    (_request, body, done) => {
      done(null, body);
    },
  );
  await app.register(cors, {
    origin: allowedOrigins === undefined ? false : allowedOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'authorization',
      'content-type',
      'upload-offset',
      'upload-chunk-sha256',
      'x-request-id',
    ],
    exposedHeaders: ['location', 'upload-expires', 'upload-length', 'upload-offset'],
  });
  await app.register(rateLimit, {
    max: options.rateLimitMax ?? 120,
    timeWindow: '1 minute',
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    void reply
      .header('cache-control', 'no-store')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('cross-origin-resource-policy', 'same-site')
      .header('permissions-policy', 'camera=(), microphone=(), geolocation=()')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');
    return payload;
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: '@wokesocial/media-worker',
    canonical: false,
    signsForUsers: false,
  }));
  app.get('/readyz', async (_request, reply) => {
    const readiness = await options.service.readiness();
    const ready = readiness.ok && options.authorizeRequest !== undefined;
    if (!ready) {
      void reply.code(503);
    }
    return {
      ...readiness,
      ok: ready,
      authorization: options.authorizeRequest === undefined ? 'locked' : 'configured',
    };
  });
  app.get('/openapi.json', async () => mediaWorkerOpenApiDocument);
  app.get('/v1/policy', async () => ({
    canonical: false,
    signsForUsers: false,
    authorization: options.authorizeRequest === undefined ? 'locked' : 'configured',
    malwareScanning: options.service.scanner.available ? 'configured' : 'locked',
    defaultStoragePermanence: 'deletion-compatible',
    maximumUploadBytes,
    maximumChunkBytes,
    allowedMediaTypes: listAllowedMediaTypes(),
    processingModes: {
      managed: 'Worker sanitizes or transcodes bytes and derives bounded variants.',
      preprocessed:
        'Worker validates and publishes independently processed bytes unchanged after a metadata-stripped assertion.',
    },
  }));

  app.post('/v1/uploads', { bodyLimit: maximumDeclarationBytes }, async (request, reply) => {
    const declaration = uploadCreateSchema.parse(request.body);
    const authorizationDeclaration = authorizationDeclarationFrom(declaration);
    await requireAuthorization(options, request, 'create', undefined, authorizationDeclaration);
    const record = await options.service.createUpload(declaration);
    try {
      await requireAuthorization(options, request, 'claim', record.id, authorizationDeclaration);
    } catch (error) {
      await options.service.cancelUpload(record.id);
      throw error;
    }
    setUploadHeaders(reply, record);
    void reply.code(201).header('location', `/v1/uploads/${record.id}`);
    return publicRecord(record);
  });
  app.get('/v1/uploads/:uploadId', { exposeHeadRoute: false }, async (request, reply) => {
    const { uploadId } = parametersSchema.parse(request.params);
    await requireAuthorization(options, request, 'read', uploadId);
    const record = await options.service.getUpload(uploadId);
    setUploadHeaders(reply, record);
    return publicRecord(record);
  });
  app.head('/v1/uploads/:uploadId', async (request, reply) => {
    const { uploadId } = parametersSchema.parse(request.params);
    await requireAuthorization(options, request, 'read', uploadId);
    const record = await options.service.getUpload(uploadId);
    setUploadHeaders(reply, record);
    void reply.code(200).send();
  });
  app.patch('/v1/uploads/:uploadId', async (request, reply) => {
    const { uploadId } = parametersSchema.parse(request.params);
    await requireAuthorization(options, request, 'append', uploadId);
    const headers = chunkHeadersSchema.parse(request.headers);
    if (!(request.body instanceof Buffer)) {
      throw new MediaWorkerError(
        'invalid-media',
        'Chunk bodies require application/offset+octet-stream.',
      );
    }
    const record = await options.service.appendChunk(
      uploadId,
      headers['upload-offset'],
      new Uint8Array(request.body),
      headers['upload-chunk-sha256'],
    );
    setUploadHeaders(reply, record);
    void reply.code(204).send();
  });
  app.delete('/v1/uploads/:uploadId', async (request, reply) => {
    const { uploadId } = parametersSchema.parse(request.params);
    await requireAuthorization(options, request, 'cancel', uploadId);
    const record = await options.service.cancelUpload(uploadId);
    setUploadHeaders(reply, record);
    void reply.code(204).send();
  });
  app.post('/v1/uploads/:uploadId/finalize', async (request, reply) => {
    const { uploadId } = parametersSchema.parse(request.params);
    await requireAuthorization(options, request, 'finalize', uploadId);
    const before = await options.service.getUpload(uploadId);
    const result = await options.service.finalize(uploadId);
    void reply.code(before.state === 'completed' ? 200 : 201);
    return result;
  });

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof MediaWorkerError) {
      const status = errorStatus(error.code);
      if (error.code === 'conflict') {
        await attachCurrentOffset(options.service, request, reply);
      }
      void reply.code(status).send(errorBody(error.code, error.message));
      return;
    }
    if (error instanceof z.ZodError) {
      void reply.code(400).send({
        ...errorBody('invalid-request', 'The request is invalid.'),
        issues: error.issues.slice(0, 16).map((issue) => ({
          path: issue.path.join('.').slice(0, 200),
          code: issue.code,
        })),
        issuesTruncated: error.issues.length > 16,
      });
      return;
    }
    if (hasStatus(error, 413)) {
      void reply
        .code(413)
        .send(errorBody('body-too-large', 'The request body exceeds the configured byte limit.'));
      return;
    }
    if (hasStatus(error, 429)) {
      void reply
        .code(429)
        .send(errorBody('rate-limit-exceeded', 'The request rate limit was exceeded.'));
      return;
    }
    if (hasCode(error, 'FST_ERR_CTP_INVALID_MEDIA_TYPE')) {
      void reply
        .code(415)
        .send(
          errorBody(
            'unsupported-content-type',
            'Chunk bodies require application/offset+octet-stream.',
          ),
        );
      return;
    }
    if (hasCode(error, 'FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_EMPTY_JSON_BODY')) {
      void reply.code(400).send(errorBody('invalid-json', 'The body must be valid JSON.'));
      return;
    }
    request.log.error(
      {
        errorName: error instanceof Error ? error.name : 'UnknownError',
        errorCode:
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          typeof error.code === 'string'
            ? error.code.slice(0, 80)
            : 'unknown',
      },
      'Unhandled media-worker request error',
    );
    void reply
      .code(500)
      .send(errorBody('internal-error', 'The media worker could not complete the request.'));
  });
  return app;
}

function setUploadHeaders(
  reply: FastifyReply,
  record: { readonly offset: number; readonly totalBytes: number; readonly expiresAt: string },
): void {
  void reply
    .header('upload-offset', record.offset)
    .header('upload-length', record.totalBytes)
    .header('upload-expires', record.expiresAt);
}

function publicRecord(record: Awaited<ReturnType<MediaWorkerService['getUpload']>>) {
  return {
    id: record.id,
    state: record.state,
    offset: record.offset,
    totalBytes: record.totalBytes,
    declaredMediaType: record.declaredMediaType,
    detectedMediaType: record.detectedMediaType,
    processingMode: record.processingMode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    expiresAt: record.expiresAt,
    failureCode: record.failureCode,
    result: record.result,
  };
}

async function attachCurrentOffset(
  service: MediaWorkerService,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parameters = parametersSchema.safeParse(request.params);
  if (!parameters.success) {
    return;
  }
  try {
    const record = await service.getUpload(parameters.data.uploadId);
    setUploadHeaders(reply, record);
  } catch {
    // Preserve the original conflict when the upload disappears concurrently.
  }
}

function errorStatus(code: MediaWorkerError['code']): number {
  switch (code) {
    case 'not-found':
      return 404;
    case 'conflict':
    case 'invalid-state':
      return 409;
    case 'cancelled':
    case 'expired':
      return 410;
    case 'unsupported-media':
      return 415;
    case 'size-limit':
    case 'output-limit':
      return 413;
    case 'scanner-unavailable':
    case 'authorization-unavailable':
    case 'storage-unavailable':
    case 'worker-busy':
      return 503;
    case 'cleanup-failed':
    case 'persistence-failed':
      return 500;
    case 'unauthorized':
      return 403;
    case 'chunk-hash-mismatch':
    case 'invalid-media':
    case 'malware-detected':
    case 'processing-failed':
    case 'total-hash-mismatch':
      return 422;
  }
}

async function requireAuthorization(
  options: MediaWorkerAppOptions,
  request: FastifyRequest,
  action: 'create' | 'claim' | 'read' | 'append' | 'cancel' | 'finalize',
  uploadId?: string,
  declaration?: UploadAuthorizationDeclaration,
): Promise<void> {
  if (options.authorizeRequest === undefined) {
    throw new MediaWorkerError(
      'authorization-unavailable',
      'Upload access is locked until an authorization adapter is configured.',
    );
  }
  let authorized: boolean;
  try {
    authorized = await options.authorizeRequest({
      action,
      ...(uploadId === undefined ? {} : { uploadId }),
      ...(declaration === undefined ? {} : { declaration }),
      authorization: request.headers.authorization,
    });
  } catch (error) {
    throw new MediaWorkerError(
      'authorization-unavailable',
      'The deployment authorization adapter did not complete safely.',
      { cause: error },
    );
  }
  if (!authorized) {
    throw new MediaWorkerError('unauthorized', 'Upload access was denied.');
  }
}

function authorizationDeclarationFrom(
  declaration: UploadCreateInput,
): UploadAuthorizationDeclaration {
  return {
    declaredMediaType: declaration.declaredMediaType,
    processingMode: declaration.processingMode,
    storagePolicy: declaration.storagePolicy,
    totalBytes: declaration.totalBytes,
  };
}

function errorBody(code: string, message: string) {
  return {
    canonical: false,
    signsForUsers: false,
    error: { code, message },
  };
}

function hasStatus(error: unknown, statusCode: number): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    error.statusCode === statusCode
  );
}

function hasCode(error: unknown, ...codes: readonly string[]): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    codes.includes(error.code)
  );
}
