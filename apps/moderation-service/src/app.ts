import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { identityIdSchema, objectIdSchema, type ModerationSubject } from '@wokesocial/protocol';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createTrustedProxyPolicy } from '@wokesocial/config/trusted-proxy';

import { ModerationServiceError } from './errors.js';
import { operatorAssertionSchema, type OperatorAssertion } from './models.js';
import { moderationOpenApiDocument } from './openapi.js';
import { publicLabelEnvelope, type ModerationService } from './service.js';

const MAXIMUM_BODY_BYTES = 192 * 1_024;
const INVALID_PURPOSE = 'missing-or-invalid-purpose';
const labelQuerySchema = z
  .object({
    subjectKind: z.enum(['community', 'identity', 'object']),
    subjectId: z.string().min(1).max(220),
  })
  .strict();
const caseParamsSchema = z.object({ reportId: objectIdSchema }).strict();
const purposeSchema = z.string().trim().min(3).max(160);
const transparencyQuerySchema = z
  .object({
    from: z.string().min(1),
    to: z.string().min(1),
    minimumCellSize: z.coerce.number().int().min(3).max(100).optional(),
  })
  .strict();

export interface ModerationCaseAccess {
  readonly reportId: string;
  readonly authorization: string | undefined;
  readonly purpose: string;
}

export interface ModerationOperatorAccess extends ModerationCaseAccess {
  readonly operation:
    'case-action' | 'case-audit' | 'case-hold' | 'case-read' | 'case-review' | 'case-transition';
}

export interface ModerationAppOptions {
  readonly service: ModerationService;
  readonly logger?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly rateLimitMax?: number;
  readonly readinessCheck?: () => void | Promise<void>;
  readonly authorizeCaseRead?: (input: ModerationCaseAccess) => boolean | Promise<boolean>;
  readonly authorizeOperator?: (
    input: ModerationOperatorAccess,
  ) => OperatorAssertion | false | Promise<OperatorAssertion | false>;
  readonly transparencyMinimumCellSize?: number;
  readonly trustedProxyCidrs?: readonly string[];
}

export async function buildModerationApp(options: ModerationAppOptions): Promise<FastifyInstance> {
  const clientIpPolicy = createTrustedProxyPolicy(options.trustedProxyCidrs ?? []);
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: 'info',
            base: { service: '@wokesocial/moderation-service' },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body',
                'request.body',
              ],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: MAXIMUM_BODY_BYTES,
    connectionTimeout: 5_000,
    keepAliveTimeout: 5_000,
    requestTimeout: 10_000,
    requestIdHeader: 'x-request-id',
    trustProxy: clientIpPolicy.trustProxy,
  });

  await app.register(cors, {
    origin: options.allowedOrigins === undefined ? false : [...options.allowedOrigins],
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    keyGenerator: (request) => clientIpPolicy.clientIp(request.raw),
    max: options.rateLimitMax ?? 30,
    timeWindow: '1 minute',
  });

  app.addHook('onRequest', async (request, reply) => {
    if (request.method === 'POST' && !isJsonMediaType(request.headers['content-type'])) {
      return reply
        .code(415)
        .send(errorBody('unsupported-media-type', 'Request bodies must use application/json.'));
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    void reply
      .header('cache-control', 'no-store')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('permissions-policy', 'camera=(), microphone=(), geolocation=()')
      .header('referrer-policy', 'no-referrer')
      .header('x-content-type-options', 'nosniff');
    return payload;
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: '@wokesocial/moderation-service',
    advisory: true,
    canonical: false,
    authorization: options.service.authorizationMode,
    storage: options.service.store.kind,
  }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await options.readinessCheck?.();
      if (!options.service.ready) {
        void reply.code(503);
      }
      return {
        ok: options.service.ready,
        authorization: options.service.authorizationMode,
        storage: options.service.store.kind,
      };
    } catch {
      void reply.code(503);
      return {
        ok: false,
        authorization: options.service.authorizationMode,
        storage: options.service.store.kind,
      };
    }
  });

  app.get('/openapi.json', async () => moderationOpenApiDocument);
  app.get('/v1/policy', async () => ({
    advisory: true,
    canonical: false,
    publicLabels: true,
    reportConfidentiality: 'restricted',
    caseReadRequiresPurposeBoundAuthorization: true,
    operatorAuthorizationConfigured:
      options.authorizeOperator !== undefined || options.authorizeCaseRead !== undefined,
    authorization: options.service.authorizationMode,
    storage: options.service.store.kind,
    durableStorage: options.service.store.kind === 'postgres',
    restrictedAtRestEncryption: options.service.store.kind === 'postgres',
    appendOnlyCaseLedger: true,
    transparencyMinimumCellSize: options.transparencyMinimumCellSize ?? 5,
  }));

  app.get('/v1/labels', async (request, reply) => {
    const query = labelQuerySchema.safeParse(request.query);
    if (!query.success) {
      return invalidRequest(reply, query.error);
    }
    const subject = subjectFromQuery(query.data);
    if (subject === undefined) {
      void reply.code(400);
      return errorBody('invalid-subject', 'The moderation subject is invalid.');
    }
    const objects = await options.service.activeLabels(subject);
    return {
      advisory: true,
      canonical: false,
      subject,
      labels: objects.map((object) => ({
        objectId: object.objectId,
        cid: object.cid,
        receivedAt: object.receivedAt,
        envelope: publicLabelEnvelope(object),
      })),
    };
  });

  app.post('/v1/labels', async (request, reply) => {
    const receipt = await options.service.ingestLabel(request.body);
    void reply.code(receipt.duplicate ? 200 : 201);
    return receipt;
  });

  app.post('/v1/reports', async (request, reply) => {
    const receipt = await options.service.ingestReport(request.body);
    void reply.code(receipt.duplicate ? 200 : 202);
    return reportSafeReceipt(receipt);
  });

  app.post('/v1/appeals', async (request, reply) => {
    const receipt = await options.service.ingestAppeal(request.body);
    void reply.code(receipt.duplicate ? 200 : 202);
    return reportSafeReceipt(receipt);
  });

  app.get('/v1/cases/:reportId', async (request, reply) => {
    const params = caseParamsSchema.safeParse(request.params);
    const purpose = purposeSchema.safeParse(request.headers['x-moderation-purpose']);
    if (!params.success || !purpose.success) {
      if (params.success) {
        await auditDenied(options.service, params.data.reportId, 'case.read', INVALID_PURPOSE);
      }
      void reply.code(403);
      return errorBody(
        'case-access-denied',
        'Restricted case access requires an authorized, declared purpose.',
      );
    }
    const assertion = await resolveOperator(options, {
      reportId: params.data.reportId,
      authorization: request.headers.authorization,
      purpose: purpose.data,
      operation: 'case-read',
    });
    if (assertion === undefined || !assertion.permissions.includes('case.read')) {
      await auditDenied(
        options.service,
        params.data.reportId,
        'case.read',
        purpose.data,
        assertion,
      );
      void reply.code(403);
      return errorBody('case-access-denied', 'Restricted case access was denied.');
    }
    await options.service.recordAccess({
      reportId: params.data.reportId,
      operation: 'case.read',
      allowed: true,
      actorId: assertion.actorId,
      assertionId: assertion.assertionId,
      purpose: purpose.data,
    });
    const moderationCase = await options.service.readCase(params.data.reportId);
    if (moderationCase === undefined) {
      void reply.code(404);
      return errorBody('case-not-found', 'The moderation case was not found.');
    }
    return {
      advisory: true,
      canonical: false,
      confidentiality: 'restricted',
      report: moderationCase.report.envelope,
      appeals: moderationCase.appeals.map((appeal) => appeal.envelope),
    };
  });

  app.get('/v1/cases/:reportId/ledger', async (request, reply) => {
    const params = caseParamsSchema.safeParse(request.params);
    const purpose = purposeSchema.safeParse(request.headers['x-moderation-purpose']);
    if (!params.success || !purpose.success) {
      if (params.success) {
        await auditDenied(options.service, params.data.reportId, 'case.audit', INVALID_PURPOSE);
      }
      void reply.code(403);
      return errorBody(
        'case-access-denied',
        'Restricted ledger access requires an authorized, declared purpose.',
      );
    }
    const assertion = await resolveOperator(options, {
      reportId: params.data.reportId,
      authorization: request.headers.authorization,
      purpose: purpose.data,
      operation: 'case-audit',
    });
    if (assertion === undefined || !assertion.permissions.includes('case.audit')) {
      await auditDenied(
        options.service,
        params.data.reportId,
        'case.audit',
        purpose.data,
        assertion,
      );
      void reply.code(403);
      return errorBody('case-access-denied', 'Restricted ledger access was denied.');
    }
    await options.service.recordAccess({
      reportId: params.data.reportId,
      operation: 'case.audit',
      allowed: true,
      actorId: assertion.actorId,
      assertionId: assertion.assertionId,
      purpose: purpose.data,
    });
    const ledger = await options.service.readCaseLedger(params.data.reportId);
    if (ledger === undefined) {
      void reply.code(404);
      return errorBody('case-not-found', 'The moderation case was not found.');
    }
    return {
      advisory: true,
      canonical: false,
      confidentiality: 'restricted',
      ledger,
    };
  });

  app.post('/v1/cases/:reportId/transitions', async (request, reply) => {
    return withOperatorMutation(
      options,
      request,
      reply,
      'case-transition',
      'case.transition',
      async (reportId, assertion) => ({
        statusCode: 200,
        body: {
          advisory: true,
          canonical: false,
          case: await options.service.transitionCase(reportId, request.body, assertion),
        },
      }),
    );
  });

  app.post('/v1/cases/:reportId/actions', async (request, reply) => {
    return withOperatorMutation(
      options,
      request,
      reply,
      'case-action',
      'case.action',
      async (reportId, assertion) => ({
        statusCode: 201,
        body: {
          advisory: true,
          canonical: false,
          action: await options.service.applyAction(reportId, request.body, assertion),
        },
      }),
    );
  });

  app.post('/v1/cases/:reportId/reviews', async (request, reply) => {
    return withOperatorMutation(
      options,
      request,
      reply,
      'case-review',
      'case.review',
      async (reportId, assertion) => ({
        statusCode: 201,
        body: {
          advisory: true,
          canonical: false,
          review: await options.service.reviewAction(reportId, request.body, assertion),
        },
      }),
    );
  });

  app.post('/v1/cases/:reportId/legal-hold', async (request, reply) => {
    return withOperatorMutation(
      options,
      request,
      reply,
      'case-hold',
      'case.legal-hold',
      async (reportId, assertion) => ({
        statusCode: 200,
        body: {
          advisory: true,
          canonical: false,
          case: await options.service.setLegalHold(reportId, request.body, assertion),
        },
      }),
    );
  });

  app.get('/v1/transparency', async (request, reply) => {
    const query = transparencyQuerySchema.safeParse(request.query);
    if (!query.success) return invalidRequest(reply, query.error);
    const configuredMinimum = options.transparencyMinimumCellSize ?? 5;
    const minimumCellSize = Math.max(
      configuredMinimum,
      query.data.minimumCellSize ?? configuredMinimum,
    );
    return options.service.transparency({
      from: query.data.from,
      to: query.data.to,
      minimumCellSize,
    });
  });

  app.setNotFoundHandler(async (_request, reply) => {
    void reply
      .code(404)
      .send(errorBody('route-not-found', 'The moderation API route was not found.'));
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ModerationServiceError) {
      const status =
        error.code === 'locked'
          ? 503
          : error.code === 'database-unavailable' ||
              error.code === 'encryption-failed' ||
              error.code === 'encryption-unavailable' ||
              error.code === 'corrupt-storage' ||
              error.code === 'retention-failed'
            ? 503
            : error.code === 'case-not-found' ||
                error.code === 'action-not-found' ||
                error.code === 'appeal-not-found'
              ? 404
              : error.code === 'appeal-decision-not-found' ||
                  error.code === 'superseded-label-not-found' ||
                  error.code === 'label-provider-mismatch' ||
                  error.code === 'label-subject-mismatch' ||
                  error.code === 'conflicting-object' ||
                  error.code === 'case-conflict' ||
                  error.code === 'conflict-of-interest' ||
                  error.code === 'invalid-transition'
                ? 409
                : error.code === 'unauthorized' || error.code === 'case-access-denied'
                  ? 403
                  : 400;
      void reply.code(status).send(errorBody(error.code, error.message));
      return;
    }
    if (error instanceof z.ZodError) {
      void reply.code(400).send({
        ...errorBody('invalid-request', 'The request is invalid.'),
        issues: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    if (hasStatus(error, 413)) {
      void reply
        .code(413)
        .send(
          errorBody(
            'body-too-large',
            `Request bodies may not exceed ${String(MAXIMUM_BODY_BYTES)} bytes.`,
          ),
        );
      return;
    }
    if (hasStatus(error, 429)) {
      void reply
        .code(429)
        .send(errorBody('rate-limit-exceeded', 'The request rate limit was exceeded.'));
      return;
    }
    if (hasStatus(error, 415)) {
      void reply
        .code(415)
        .send(errorBody('unsupported-media-type', 'Request bodies must use application/json.'));
      return;
    }
    if (hasCode(error, 'FST_ERR_CTP_INVALID_JSON_BODY', 'FST_ERR_CTP_EMPTY_JSON_BODY')) {
      void reply.code(400).send(errorBody('invalid-json', 'The request body must be valid JSON.'));
      return;
    }

    request.log.error({ error }, 'Unhandled moderation-service request error');
    void reply
      .code(500)
      .send(errorBody('internal-error', 'The moderation service could not complete the request.'));
  });

  return app;
}

async function withOperatorMutation(
  options: ModerationAppOptions,
  request: Pick<FastifyRequest, 'headers' | 'params'>,
  reply: FastifyReply,
  operation: ModerationOperatorAccess['operation'],
  auditOperation: string,
  mutation: (
    reportId: string,
    assertion: OperatorAssertion,
  ) => Promise<{ readonly statusCode: number; readonly body: unknown }>,
) {
  const params = caseParamsSchema.safeParse(request.params);
  const purpose = purposeSchema.safeParse(request.headers['x-moderation-purpose']);
  if (!params.success || !purpose.success) {
    if (params.success) {
      await auditDenied(options.service, params.data.reportId, auditOperation, INVALID_PURPOSE);
    }
    void reply.code(403);
    return errorBody(
      'case-access-denied',
      'Moderation mutations require authorized, purpose-bound operator access.',
    );
  }
  const assertion = await resolveOperator(options, {
    reportId: params.data.reportId,
    authorization: request.headers.authorization,
    purpose: purpose.data,
    operation,
  });
  if (assertion === undefined) {
    await auditDenied(options.service, params.data.reportId, auditOperation, purpose.data);
    void reply.code(403);
    return errorBody('case-access-denied', 'Moderation operator access was denied.');
  }
  try {
    const result = await mutation(params.data.reportId, assertion);
    await options.service.recordAccess({
      reportId: params.data.reportId,
      operation: auditOperation,
      allowed: true,
      actorId: assertion.actorId,
      assertionId: assertion.assertionId,
      purpose: purpose.data,
    });
    void reply.code(result.statusCode);
    return result.body;
  } catch (error) {
    if (
      error instanceof ModerationServiceError &&
      (error.code === 'unauthorized' || error.code === 'conflict-of-interest')
    ) {
      await auditDenied(
        options.service,
        params.data.reportId,
        auditOperation,
        purpose.data,
        assertion,
      );
    }
    throw error;
  }
}

async function resolveOperator(
  options: ModerationAppOptions,
  input: ModerationOperatorAccess,
): Promise<OperatorAssertion | undefined> {
  try {
    if (options.authorizeOperator !== undefined) {
      const result = await options.authorizeOperator(input);
      if (result === false) return undefined;
      const parsed = operatorAssertionSchema.safeParse(result);
      if (!parsed.success || Date.parse(parsed.data.expiresAt) <= Date.now()) return undefined;
      return parsed.data;
    }
    if (input.operation === 'case-read' && options.authorizeCaseRead !== undefined) {
      const authorized = await options.authorizeCaseRead(input);
      if (!authorized) return undefined;
      return {
        actorId: 'operator:legacy-callback',
        assertionId: 'legacy-purpose-bound-callback',
        permissions: ['case.read'],
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function auditDenied(
  service: ModerationService,
  reportId: string,
  operation: string,
  purpose: string,
  assertion?: OperatorAssertion,
): Promise<void> {
  await service.recordAccess({
    reportId,
    operation,
    allowed: false,
    actorId: assertion?.actorId ?? 'anonymous',
    assertionId: assertion?.assertionId ?? 'authorization-denied',
    purpose,
  });
}

function subjectFromQuery(query: z.infer<typeof labelQuerySchema>): ModerationSubject | undefined {
  const candidate =
    query.subjectKind === 'identity'
      ? { kind: 'identity' as const, identity: query.subjectId }
      : query.subjectKind === 'object'
        ? { kind: 'object' as const, object: { id: query.subjectId } }
        : { kind: 'community' as const, community: { id: query.subjectId } };
  const parsed =
    query.subjectKind === 'identity'
      ? identityIdSchema.safeParse(query.subjectId)
      : objectIdSchema.safeParse(query.subjectId);
  return parsed.success ? candidate : undefined;
}

function reportSafeReceipt(receipt: {
  readonly advisory: true;
  readonly canonical: false;
  readonly duplicate: boolean;
  readonly objectId: string;
  readonly objectType: string;
  readonly receivedAt: string;
}) {
  return {
    advisory: receipt.advisory,
    canonical: receipt.canonical,
    duplicate: receipt.duplicate,
    objectId: receipt.objectId,
    objectType: receipt.objectType,
    receivedAt: receipt.receivedAt,
    confidentiality: 'restricted' as const,
  };
}

function invalidRequest(reply: FastifyReply, error: z.ZodError) {
  void reply.code(400);
  return {
    ...errorBody('invalid-request', 'The request is invalid.'),
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

function errorBody(code: string, message: string) {
  return {
    advisory: true,
    canonical: false,
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

function isJsonMediaType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const mediaType = value.split(';', 1)[0]?.trim().toLowerCase();
  return mediaType === 'application/json' || mediaType?.endsWith('+json') === true;
}
