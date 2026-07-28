import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { AuthServiceError } from './errors.js';
import {
  assertNoClientKeyMaterial,
  CSRF_COOKIE_NAME,
  equalHash,
  hashSecret,
  SESSION_COOKIE_NAME,
} from './security.js';
import type { AuthenticatedSession, AuthService, IssuedSession } from './service.js';

export function installHttpSecurity(app: FastifyInstance, expectedOrigin: string): void {
  app.addHook('preValidation', async (request) => {
    if (!isStateChanging(request.method)) return;
    if (request.headers.origin !== expectedOrigin) {
      throw new AuthServiceError(
        'State-changing requests require the exact configured Origin.',
        'origin-invalid',
      );
    }
    assertDoubleSubmitCsrf(request);
    try {
      assertNoClientKeyMaterial(request.body);
    } catch (error) {
      throw new AuthServiceError(
        'PRF output, plaintext keys, and private key material are not accepted.',
        'invalid-request',
        { cause: error },
      );
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    void reply
      .header('cache-control', 'no-store')
      .header('content-security-policy', "default-src 'none'; frame-ancestors 'none'")
      .header('cross-origin-opener-policy', 'same-origin')
      .header('cross-origin-resource-policy', 'same-origin')
      .header(
        'permissions-policy',
        'camera=(), microphone=(), geolocation=(), publickey-credentials-create=(self), publickey-credentials-get=(self)',
      )
      .header('referrer-policy', 'no-referrer')
      .header('strict-transport-security', 'max-age=31536000; includeSubDomains')
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY');
    return payload;
  });
}

export async function authenticatedRequest(
  service: AuthService,
  request: FastifyRequest,
): Promise<AuthenticatedSession> {
  const authenticated = await service.resolveSession(request.cookies[SESSION_COOKIE_NAME]);
  service.requireSession(authenticated);
  return authenticated;
}

export function requireSessionCsrf(
  service: AuthService,
  authenticated: AuthenticatedSession,
  request: FastifyRequest,
): void {
  service.validateSessionCsrf(authenticated, csrfHeader(request));
}

export function setIssuedSession(reply: FastifyReply, issued: IssuedSession): void {
  const maximumAge = Math.max(
    1,
    Math.floor((Date.parse(issued.session.expiresAt) - Date.now()) / 1_000),
  );
  void reply.setCookie(SESSION_COOKIE_NAME, issued.cookieValue, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
    maxAge: maximumAge,
  });
  setCsrfCookie(reply, issued.csrfToken, maximumAge);
}

export function setCsrfCookie(reply: FastifyReply, csrfToken: string, maxAge = 8 * 60 * 60): void {
  void reply.setCookie(CSRF_COOKIE_NAME, csrfToken, {
    path: '/',
    secure: true,
    httpOnly: false,
    sameSite: 'strict',
    maxAge,
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  void reply.clearCookie(SESSION_COOKIE_NAME, {
    path: '/',
    secure: true,
    httpOnly: true,
    sameSite: 'strict',
  });
  void reply.clearCookie(CSRF_COOKIE_NAME, {
    path: '/',
    secure: true,
    httpOnly: false,
    sameSite: 'strict',
  });
}

function assertDoubleSubmitCsrf(request: FastifyRequest): void {
  const header = csrfHeader(request);
  const cookieValue = request.cookies[CSRF_COOKIE_NAME];
  if (cookieValue === undefined || !equalHash(hashSecret(cookieValue), hashSecret(header))) {
    throw new AuthServiceError('CSRF token is invalid.', 'csrf-invalid');
  }
}

function csrfHeader(request: FastifyRequest): string {
  const value = request.headers['x-csrf-token'];
  if (
    typeof value !== 'string' ||
    value.length < 22 ||
    value.length > 86 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new AuthServiceError('CSRF token is invalid.', 'csrf-invalid');
  }
  return value;
}

function isStateChanging(method: string): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);
}
