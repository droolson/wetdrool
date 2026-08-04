import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { createTrustedProxyPolicy } from '@wetdrool/config/trusted-proxy';
import { createFastifyRateLimitStore, type RateLimiter } from '@wetdrool/rate-limit';

import { installAuthErrorHandler } from './http-errors.js';
import {
  authenticatedCapabilities,
  policyBody,
  publicCredential,
  publicSession,
} from './http-presenters.js';
import {
  authenticatedRequest,
  clearAuthCookies,
  installHttpSecurity,
  requireSessionCsrf,
  setCsrfCookie,
  setIssuedSession,
} from './http-security.js';
import { authOpenApiDocument } from './openapi.js';
import {
  additionalRegistrationVerificationSchema,
  authenticationVerificationSchema,
  credentialIdParamSchema,
  emptyBodySchema,
  registrationVerificationSchema,
} from './request-schemas.js';
import { CSRF_COOKIE_NAME, randomToken, SESSION_COOKIE_NAME } from './security.js';
import type { AuthService } from './service.js';

const MAXIMUM_BODY_BYTES = 128 * 1_024;
const credentialParamsSchema = z.object({ credentialId: credentialIdParamSchema }).strict();

export interface AuthAppOptions {
  readonly service: AuthService;
  readonly logger?: boolean;
  readonly rateLimitMax?: number;
  readonly rateLimiter?: RateLimiter;
  readonly trustedProxyCidrs?: readonly string[];
}

export async function buildAuthApp(options: AuthAppOptions): Promise<FastifyInstance> {
  const clientIpPolicy = createTrustedProxyPolicy(options.trustedProxyCidrs ?? []);
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: 'info',
            base: { service: '@wetdrool/auth-service' },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers.x-csrf-token',
                'req.body',
                'request.body',
                'res.headers.set-cookie',
              ],
              censor: '[REDACTED]',
            },
          },
    bodyLimit: MAXIMUM_BODY_BYTES,
    connectionTimeout: 5_000,
    keepAliveTimeout: 5_000,
    requestTimeout: 15_000,
    requestIdHeader: 'x-request-id',
    trustProxy: clientIpPolicy.trustProxy,
  });

  await app.register(cookie);
  await app.register(cors, {
    origin: options.service.origin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'x-request-id'],
  });
  await app.register(rateLimit, {
    keyGenerator: (request) => clientIpPolicy.clientIp(request.raw),
    max: options.rateLimitMax ?? 30,
    ...(options.rateLimiter === undefined
      ? {}
      : {
          store: createFastifyRateLimitStore({
            limiter: options.rateLimiter,
            namespace: 'http:auth-service',
          }),
        }),
    skipOnError: false,
    timeWindow: '1 minute',
  });
  if (options.rateLimiter !== undefined) {
    app.addHook('onClose', async () => options.rateLimiter?.close());
  }

  installHttpSecurity(app, options.service.origin);

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({
    ok: true,
    service: '@wetdrool/auth-service',
    replaceable: true,
    canonical: false,
    storage: options.service.store.kind,
  }));

  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    try {
      await options.service.store.readiness();
      const rateLimitHealth = await options.rateLimiter?.readiness();
      if (rateLimitHealth !== undefined && !rateLimitHealth.ready) {
        throw new Error('The shared rate limiter is unavailable.');
      }
      return { ok: true, storage: options.service.store.kind };
    } catch {
      void reply.code(503);
      return { ok: false, storage: options.service.store.kind };
    }
  });

  app.get('/openapi.json', async () => authOpenApiDocument);
  app.get('/v1/policy', async () => policyBody(options.service));

  app.get('/v1/csrf', async (request, reply) => {
    const authenticated = await options.service.resolveSession(
      request.cookies[SESSION_COOKIE_NAME],
    );
    const sessionToken = request.cookies[CSRF_COOKIE_NAME];
    if (
      authenticated !== undefined &&
      sessionToken !== undefined &&
      options.service.matchesSessionCsrf(authenticated, sessionToken)
    ) {
      return { csrfToken: sessionToken };
    }
    const csrfToken = randomToken();
    setCsrfCookie(reply, csrfToken);
    return { csrfToken };
  });

  app.post('/v1/registration/options', async (request) => {
    emptyBodySchema.parse(request.body ?? {});
    return options.service.registrationOptions();
  });

  app.post('/v1/registration/verify', async (request, reply) => {
    const body = registrationVerificationSchema.parse(request.body);
    const result = await options.service.verifyFirstRegistration({
      accountId: body.accountId,
      ceremonyId: body.ceremonyId,
      response: body.response as RegistrationResponseJSON,
      bundle: body.bundle,
    });
    setIssuedSession(reply, result.session);
    void reply.code(201);
    return {
      accountId: result.credential.accountId,
      credential: publicCredential(result.credential),
      session: publicSession(result.session.session),
      csrfToken: result.session.csrfToken,
      capabilities: authenticatedCapabilities(),
    };
  });

  app.post('/v1/authentication/options', async (request) => {
    emptyBodySchema.parse(request.body ?? {});
    return options.service.authenticationOptions();
  });

  app.post('/v1/authentication/verify', async (request, reply) => {
    const body = authenticationVerificationSchema.parse(request.body);
    const result = await options.service.verifyAuthentication({
      ceremonyId: body.ceremonyId,
      response: body.response as AuthenticationResponseJSON,
    });
    setIssuedSession(reply, result.session);
    return {
      accountId: result.credential.accountId,
      credential: publicCredential(result.credential),
      session: publicSession(result.session.session),
      csrfToken: result.session.csrfToken,
      capabilities: authenticatedCapabilities(),
    };
  });

  app.post('/v1/step-up/options', async (request) => {
    emptyBodySchema.parse(request.body ?? {});
    const authenticated = await authenticatedRequest(options.service, request);
    requireSessionCsrf(options.service, authenticated, request);
    return options.service.stepUpOptions(authenticated);
  });

  app.post('/v1/step-up/verify', async (request, reply) => {
    const body = authenticationVerificationSchema.parse(request.body);
    const authenticated = await authenticatedRequest(options.service, request);
    requireSessionCsrf(options.service, authenticated, request);
    const result = await options.service.verifyStepUp(authenticated, {
      ceremonyId: body.ceremonyId,
      response: body.response as AuthenticationResponseJSON,
    });
    setIssuedSession(reply, result.session);
    return {
      credential: publicCredential(result.credential),
      session: publicSession(result.session.session),
      csrfToken: result.session.csrfToken,
      stepUp: 'verified',
    };
  });

  app.get('/v1/credentials', async (request) => {
    const authenticated = await authenticatedRequest(options.service, request);
    const credentials = await options.service.listCredentials(authenticated.account.accountId);
    return {
      accountId: authenticated.account.accountId,
      credentials: credentials.map(publicCredential),
    };
  });

  app.post('/v1/credentials/registration/options', async (request) => {
    emptyBodySchema.parse(request.body ?? {});
    const authenticated = await authenticatedRequest(options.service, request);
    requireSessionCsrf(options.service, authenticated, request);
    return options.service.additionalCredentialOptions(authenticated);
  });

  app.post('/v1/credentials/registration/verify', async (request, reply) => {
    const body = additionalRegistrationVerificationSchema.parse(request.body);
    const authenticated = await authenticatedRequest(options.service, request);
    requireSessionCsrf(options.service, authenticated, request);
    const credential = await options.service.verifyAdditionalCredential(authenticated, {
      ceremonyId: body.ceremonyId,
      response: body.response as RegistrationResponseJSON,
      bundle: body.bundle,
    });
    void reply.code(201);
    return { credential: publicCredential(credential) };
  });

  app.delete<{ Params: { credentialId: string } }>(
    '/v1/credentials/:credentialId',
    async (request, reply) => {
      const params = credentialParamsSchema.parse(request.params);
      const authenticated = await authenticatedRequest(options.service, request);
      requireSessionCsrf(options.service, authenticated, request);
      const credential = await options.service.revokeCredential(authenticated, params.credentialId);
      clearAuthCookies(reply);
      return {
        credential: publicCredential(credential),
        synchronizedWrappersDeleted: true,
        sessionsRevoked: true,
        onchainDelegationRevocationRequiredSeparately: true,
      };
    },
  );

  app.get('/v1/key-bundles', async (request) => {
    const authenticated = await authenticatedRequest(options.service, request);
    const bundles = await options.service.listKeyBundles(authenticated.account.accountId);
    return {
      accountId: authenticated.account.accountId,
      ciphertextOnly: true,
      bundles: bundles.map((bundle) => ({
        credentialId: bundle.credentialId,
        bundle: bundle.bundle,
        updatedAt: bundle.updatedAt,
      })),
    };
  });

  app.get('/v1/session', async (request) => {
    const authenticated = await authenticatedRequest(options.service, request);
    return {
      accountId: authenticated.account.accountId,
      session: publicSession(authenticated.session),
      capabilities: authenticatedCapabilities(),
    };
  });

  app.post('/v1/logout', async (request, reply) => {
    emptyBodySchema.parse(request.body ?? {});
    const authenticated = await authenticatedRequest(options.service, request);
    requireSessionCsrf(options.service, authenticated, request);
    await options.service.logout(authenticated);
    clearAuthCookies(reply);
    void reply.code(204);
    return undefined;
  });

  installAuthErrorHandler(app, MAXIMUM_BODY_BYTES);

  return app;
}
