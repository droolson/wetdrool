import { listAllowedMediaTypes } from './mime.js';
import { maximumChunkBytes, maximumUploadBytes } from './schemas.js';

const uploadIdParameter = {
  in: 'path',
  name: 'uploadId',
  required: true,
  schema: { type: 'string', format: 'uuid' },
} as const;

export const mediaWorkerOpenApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'WokeSocial media worker',
    version: '0.1.0',
    description:
      'Resumable upload, bounded media processing, malware-gated content-addressed publication, and unsigned media-manifest preparation.',
  },
  components: {
    securitySchemes: {
      deploymentAuthorization: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Illustrative bearer transport. The deployment-provided authorization callback defines actual credentials and policy.',
      },
    },
  },
  paths: {
    '/healthz': {
      get: { summary: 'Process liveness', responses: { '200': { description: 'Alive' } } },
    },
    '/readyz': {
      get: {
        summary: 'Scanner, storage, and processor readiness',
        responses: {
          '200': { description: 'Ready to finalize uploads' },
          '503': { description: 'A required dependency is unavailable' },
        },
      },
    },
    '/v1/policy': {
      get: {
        summary: 'Upload and publication policy',
        responses: { '200': { description: 'Current worker policy' } },
      },
    },
    '/v1/uploads': {
      post: {
        summary: 'Create a resumable upload',
        security: [{ deploymentAuthorization: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                additionalProperties: false,
                required: ['declaredMediaType', 'totalBytes', 'sha256'],
                properties: {
                  declaredMediaType: { enum: listAllowedMediaTypes() },
                  totalBytes: { type: 'integer', minimum: 1, maximum: maximumUploadBytes },
                  sha256: { type: 'string', pattern: '^u[A-Za-z0-9_-]{43}$' },
                  processingMode: {
                    enum: ['managed', 'preprocessed'],
                    default: 'managed',
                  },
                  metadataStripped: {
                    type: 'boolean',
                    const: true,
                    description: 'Required as a client assertion in preprocessed mode.',
                  },
                  altText: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 2_000,
                    description: 'Maximum 2,000 bytes after UTF-8 encoding.',
                  },
                  caption: {
                    type: 'string',
                    minLength: 1,
                    maxLength: 4_000,
                    description: 'Maximum 4,000 bytes after UTF-8 encoding.',
                  },
                  captions: { type: 'array', maxItems: 32 },
                  storagePolicy: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      permanence: {
                        enum: ['deletion-compatible', 'provider-dependent', 'permanent'],
                        default: 'deletion-compatible',
                      },
                      consentId: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: 'Upload created' },
          '400': { description: 'Invalid upload declaration' },
          '403': { description: 'Upload creation or ownership claim was denied' },
          '413': { description: 'Upload declaration body is too large' },
          '415': { description: 'Declared media type is not allowed' },
          '503': { description: 'No deployment authorization adapter is configured' },
        },
      },
    },
    '/v1/uploads/{uploadId}': {
      parameters: [uploadIdParameter],
      get: {
        summary: 'Read upload state and current offset',
        security: [{ deploymentAuthorization: [] }],
        responses: {
          '200': { description: 'Upload state' },
          '403': { description: 'Upload read was denied' },
          '404': { description: 'Upload not found' },
          '503': { description: 'Deployment authorization is unavailable' },
        },
      },
      head: {
        summary: 'Read resumable offset through response headers',
        security: [{ deploymentAuthorization: [] }],
        responses: {
          '200': { description: 'Upload-Offset and Upload-Length headers' },
          '403': { description: 'Upload read was denied' },
          '404': { description: 'Upload not found' },
          '503': { description: 'Deployment authorization is unavailable' },
        },
      },
      patch: {
        summary: 'Append one independently SHA-256-verified chunk at an exact offset',
        security: [{ deploymentAuthorization: [] }],
        parameters: [
          {
            in: 'header',
            name: 'Upload-Offset',
            required: true,
            schema: {
              type: 'integer',
              minimum: 0,
              maximum: maximumUploadBytes,
            },
          },
          {
            in: 'header',
            name: 'Upload-Chunk-Sha256',
            required: true,
            schema: { type: 'string', pattern: '^u[A-Za-z0-9_-]{43}$' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/offset+octet-stream': {
              schema: {
                type: 'string',
                contentEncoding: 'binary',
                maxLength: maximumChunkBytes,
              },
            },
          },
        },
        responses: {
          '204': { description: 'Chunk committed and offset advanced' },
          '403': { description: 'Upload append was denied' },
          '409': { description: 'Offset conflict; current offset is returned' },
          '410': { description: 'Upload was cancelled or expired' },
          '413': { description: 'Chunk or declared upload byte bound was exceeded' },
          '415': { description: 'Chunk content type is unsupported' },
          '422': { description: 'Chunk digest mismatch' },
          '503': { description: 'Deployment authorization is unavailable' },
        },
      },
      delete: {
        summary: 'Cancel an incomplete upload and remove staged bytes',
        security: [{ deploymentAuthorization: [] }],
        responses: {
          '204': { description: 'Cancelled or already cancelled' },
          '403': { description: 'Upload cancellation was denied' },
          '409': { description: 'Completed publication cannot be cancelled' },
          '503': { description: 'Deployment authorization is unavailable' },
        },
      },
    },
    '/v1/uploads/{uploadId}/finalize': {
      parameters: [uploadIdParameter],
      post: {
        summary:
          'Verify, scan, process, publish, and return unsigned protocol media-manifest content',
        security: [{ deploymentAuthorization: [] }],
        responses: {
          '200': { description: 'Existing idempotent publication result' },
          '201': { description: 'New publication result' },
          '403': { description: 'Upload finalization was denied' },
          '409': { description: 'Upload is not complete and ready' },
          '410': { description: 'Upload expired before finalization' },
          '413': { description: 'Processed artifact or aggregate output bound was exceeded' },
          '415': { description: 'Detected media type is unsupported' },
          '422': { description: 'Hash, MIME, scan, or processing validation failed' },
          '503': {
            description:
              'Scanner, storage publication, authorization, or finalization capacity is unavailable',
          },
          '500': {
            description: 'Publication completed durably, but staged-source cleanup must be retried',
          },
        },
      },
    },
  },
} as const;
