import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createTrustedProxyPolicy } from '@wokesocial/config/trusted-proxy';

import { FeedCursorError, publicFeedPolicy, rankFeed } from './engine.js';
import { openApiDocument } from './openapi.js';
import { FEED_POLICY, FEED_POLICY_VERSION } from './policy.js';
import { feedProviderDescriptor } from './provider.js';

export interface FeedServiceAppOptions {
  readonly logger?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly rateLimitMax?: number;
  readonly readinessCheck?: () => Promise<void>;
  readonly trustedProxyCidrs?: readonly string[];
}

export async function buildFeedServiceApp(
  options: FeedServiceAppOptions = {},
): Promise<FastifyInstance> {
  const clientIpPolicy = createTrustedProxyPolicy(options.trustedProxyCidrs ?? []);
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: 'info',
            base: { service: '@wokesocial/feed-service' },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'request.body.viewer.viewerId',
              ],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: FEED_POLICY.request.maximumBodyBytes,
    connectionTimeout: 5_000,
    keepAliveTimeout: 5_000,
    requestTimeout: 5_000,
    routerOptions: {
      maxParamLength: 256,
    },
    requestIdHeader: 'x-request-id',
    trustProxy: clientIpPolicy.trustProxy,
  });

  await app.register(cors, {
    origin: options.allowedOrigins === undefined ? false : [...options.allowedOrigins],
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    keyGenerator: (request) => clientIpPolicy.clientIp(request.raw),
    max: options.rateLimitMax ?? 60,
    timeWindow: '1 minute',
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    void reply
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', 'no-store')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });

  app.get('/healthz', async () => ({
    ok: true,
    service: '@wokesocial/feed-service',
    policyVersion: FEED_POLICY_VERSION,
  }));

  app.get('/readyz', async (_request, reply) => {
    try {
      await options.readinessCheck?.();
      return { ok: true, policyVersion: FEED_POLICY_VERSION };
    } catch (error) {
      _request.log.warn({ error }, 'Feed readiness check failed');
      void reply.code(503);
      return { ok: false, policyVersion: FEED_POLICY_VERSION };
    }
  });

  app.get('/openapi.json', async () => openApiDocument);
  app.get('/v1/provider', async () => feedProviderDescriptor);
  app.get('/v1/policy', async () => ({
    canonical: false,
    policyVersion: FEED_POLICY_VERSION,
    policy: publicFeedPolicy,
  }));

  app.post('/v1/rank', async (request, reply) => {
    try {
      return rankFeed(request.body);
    } catch (error) {
      if (error instanceof z.ZodError) {
        void reply.code(400);
        return {
          canonical: false,
          error: {
            code: 'invalid-request',
            message: 'The ranking request is invalid.',
            issues: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              message: issue.message,
            })),
          },
        };
      }
      if (error instanceof FeedCursorError) {
        void reply.code(400);
        return {
          canonical: false,
          error: {
            code: error.code,
            message: error.message,
          },
        };
      }
      throw error;
    }
  });

  app.setErrorHandler((error, request, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 413
    ) {
      void reply.code(413).send({
        canonical: false,
        error: {
          code: 'body-too-large',
          message: `Request bodies may not exceed ${String(FEED_POLICY.request.maximumBodyBytes)} bytes.`,
        },
      });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 429
    ) {
      void reply.code(429).send({
        canonical: false,
        error: {
          code: 'rate-limit-exceeded',
          message: 'The per-client request rate limit was exceeded.',
        },
      });
      return;
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'FST_ERR_CTP_INVALID_JSON_BODY' ||
        error.code === 'FST_ERR_CTP_EMPTY_JSON_BODY')
    ) {
      void reply.code(400).send({
        canonical: false,
        error: {
          code: 'invalid-json',
          message: 'The request body must be valid JSON.',
        },
      });
      return;
    }

    request.log.error({ error }, 'Unhandled feed-service request error');
    void reply.code(500).send({
      canonical: false,
      error: {
        code: 'internal-error',
        message: 'The feed service could not complete the request.',
      },
    });
  });

  return app;
}
