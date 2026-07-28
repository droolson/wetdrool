import type { OutgoingHttpHeaders } from 'node:http';

import type { FastifyInstance } from 'fastify';
import { describe, expect, it } from 'vitest';

import {
  AuthService,
  buildAuthApp,
  CSRF_COOKIE_NAME,
  MemoryAuthStore,
  SESSION_COOKIE_NAME,
} from '../src/index.js';
import {
  authenticationResponse,
  credentialId,
  FakeCeremonyVerifier,
  registrationResponse,
  wrappedKeyBundle,
} from './fixtures.js';

const origin = 'http://localhost:4300';

describe('authentication HTTP contract', () => {
  it('states custody and recovery limits and emits hardened response headers', async () => {
    const fixture = await appFixture();
    try {
      const policy = await fixture.app.inject({ method: 'GET', url: '/v1/policy' });
      expect(policy.statusCode).toBe(200);
      expect(policy.json()).toMatchObject({
        replaceable: true,
        canonical: false,
        rpId: 'localhost',
        origin,
        userVerification: 'required',
        attestation: 'none',
        protocolIdentity: false,
        solanaSigning: false,
        serverKeyCustody: false,
        prfAcceptedByServer: false,
        plaintextKeysAcceptedByServer: false,
        credentialRevocationSessionPolicy: 'revoke-all-account-sessions',
        emailRecovery: false,
        recoveryPath: 'unsupported',
      });
      expect(policy.headers['cache-control']).toBe('no-store');
      expect(policy.headers['content-security-policy']).toContain("default-src 'none'");
      expect(policy.headers['permissions-policy']).toContain('publickey-credentials-get=(self)');
      expect(policy.headers['strict-transport-security']).toContain('max-age=');

      const openApi = await fixture.app.inject({ method: 'GET', url: '/openapi.json' });
      const openApiBody = openApi.json<{
        paths: Record<string, unknown>;
      }>();
      expect(openApiBody).toMatchObject({
        paths: {
          '/v1/registration/options': { post: { summary: expect.any(String) } },
          '/v1/authentication/options': { post: { summary: expect.any(String) } },
          '/v1/key-bundles': { get: { summary: expect.any(String) } },
        },
      });
      expect(openApiBody.paths['/v1/key-bundles/{credentialId}']).toBeUndefined();

      const csrf = await bootstrapCsrf(fixture.app);
      const retiredMutation = await fixture.app.inject({
        method: 'PUT',
        url: `/v1/key-bundles/${credentialId(30)}`,
        headers: mutationHeaders(csrf),
        payload: { bundle: await wrappedKeyBundle(credentialId(30)) },
      });
      expect(retiredMutation.statusCode).toBe(404);
    } finally {
      await fixture.app.close();
    }
  });

  it('requires exact Origin and a server-issued CSRF token on every mutation', async () => {
    const fixture = await appFixture();
    try {
      const missing = await fixture.app.inject({
        method: 'POST',
        url: '/v1/registration/options',
        payload: {},
      });
      expect(missing.statusCode).toBe(403);
      expect(missing.json()).toMatchObject({ error: { code: 'origin-invalid' } });

      const csrf = await bootstrapCsrf(fixture.app);
      expect(csrf.setCookie).toContain(`${CSRF_COOKIE_NAME}=`);
      expect(csrf.setCookie).toContain('Secure');
      expect(csrf.setCookie).toContain('SameSite=Strict');
      expect(csrf.setCookie).not.toContain('Domain=');

      const wrongOrigin = await fixture.app.inject({
        method: 'POST',
        url: '/v1/registration/options',
        headers: mutationHeaders(csrf, 'https://attacker.example'),
        payload: {},
      });
      expect(wrongOrigin.statusCode).toBe(403);
      expect(wrongOrigin.json()).toMatchObject({ error: { code: 'origin-invalid' } });

      const wrongToken = await fixture.app.inject({
        method: 'POST',
        url: '/v1/registration/options',
        headers: {
          ...mutationHeaders(csrf),
          'x-csrf-token': 'A'.repeat(43),
        },
        payload: {},
      });
      expect(wrongToken.statusCode).toBe(403);
      expect(wrongToken.json()).toMatchObject({ error: { code: 'csrf-invalid' } });
    } finally {
      await fixture.app.close();
    }
  });

  it('recovers the existing session-bound CSRF token for a new browser tab', async () => {
    const fixture = await appFixture();
    try {
      const registered = await registerThroughApi(fixture.app, credentialId(30));
      const recovered = await fixture.app.inject({
        method: 'GET',
        url: '/v1/csrf',
        headers: { cookie: serializeCookies(registered.cookies) },
      });

      expect(recovered.statusCode).toBe(200);
      expect(recovered.json()).toEqual({ csrfToken: registered.csrfToken });
      expect(normalizedSetCookie(recovered)).toBe('');

      const stepUp = await fixture.app.inject({
        method: 'POST',
        url: '/v1/step-up/options',
        headers: authenticatedMutationHeaders(
          registered.cookies,
          recovered.json<{ csrfToken: string }>().csrfToken,
        ),
        payload: {},
      });
      expect(stepUp.statusCode).toBe(200);
      expect(stepUp.json()).toMatchObject({ ceremonyId: expect.stringMatching(/^cer_/u) });
    } finally {
      await fixture.app.close();
    }
  });

  it('registers, rotates secure session cookies, adds a passkey, and blocks last-key revocation', async () => {
    const fixture = await appFixture();
    try {
      const csrf = await bootstrapCsrf(fixture.app);
      const registrationOptions = await fixture.app.inject({
        method: 'POST',
        url: '/v1/registration/options',
        headers: mutationHeaders(csrf),
        payload: {},
      });
      expect(registrationOptions.statusCode).toBe(200);
      const issued = registrationOptions.json<{
        accountId: string;
        ceremonyId: string;
        options: { user: { id: string } };
      }>();
      expect(issued.accountId).toMatch(/^acct_/u);

      const firstId = credentialId(31);
      const firstBundle = await wrappedKeyBundle(firstId);
      const verified = await fixture.app.inject({
        method: 'POST',
        url: '/v1/registration/verify',
        headers: mutationHeaders(csrf),
        payload: {
          accountId: issued.accountId,
          ceremonyId: issued.ceremonyId,
          response: registrationResponse(firstId),
          bundle: firstBundle,
        },
      });
      expect(verified.statusCode).toBe(201);
      const verifiedBody = verified.json<{
        csrfToken: string;
        capabilities: Record<string, unknown>;
      }>();
      expect(verifiedBody.capabilities).toMatchObject({
        protocolIdentityEstablished: false,
        solanaSigningAvailableFromServer: false,
        recovery: 'unsupported',
      });
      const sessionCookies = cookieJar(verified);
      expect(sessionCookies[SESSION_COOKIE_NAME]).toBeDefined();
      expect(sessionCookies[CSRF_COOKIE_NAME]).toBe(verifiedBody.csrfToken);
      const setCookie = normalizedSetCookie(verified);
      expect(setCookie).toContain(`${SESSION_COOKIE_NAME}=`);
      expect(setCookie).toContain('HttpOnly');
      expect(setCookie).toContain('Secure');
      expect(setCookie).toContain('SameSite=Strict');
      expect(setCookie).not.toContain('Domain=');

      const session = await fixture.app.inject({
        method: 'GET',
        url: '/v1/session',
        headers: { cookie: serializeCookies(sessionCookies) },
      });
      expect(session.statusCode).toBe(200);
      expect(session.json()).toMatchObject({ accountId: issued.accountId });

      const unrelatedCsrf = await bootstrapCsrf(fixture.app);
      const mismatchedSessionCsrf = await fixture.app.inject({
        method: 'POST',
        url: '/v1/credentials/registration/options',
        headers: authenticatedMutationHeaders(
          {
            ...sessionCookies,
            [CSRF_COOKIE_NAME]: unrelatedCsrf.csrfToken,
          },
          unrelatedCsrf.csrfToken,
        ),
        payload: {},
      });
      expect(mismatchedSessionCsrf.statusCode).toBe(403);
      expect(mismatchedSessionCsrf.json()).toMatchObject({
        error: { code: 'csrf-invalid' },
      });

      const addOptions = await fixture.app.inject({
        method: 'POST',
        url: '/v1/credentials/registration/options',
        headers: authenticatedMutationHeaders(sessionCookies, verifiedBody.csrfToken),
        payload: {},
      });
      expect(addOptions.statusCode).toBe(200);
      const add = addOptions.json<{ ceremonyId: string }>();
      const secondId = credentialId(32);
      const added = await fixture.app.inject({
        method: 'POST',
        url: '/v1/credentials/registration/verify',
        headers: authenticatedMutationHeaders(sessionCookies, verifiedBody.csrfToken),
        payload: {
          ceremonyId: add.ceremonyId,
          response: registrationResponse(secondId),
          bundle: await wrappedKeyBundle(secondId),
        },
      });
      expect(added.statusCode).toBe(201);

      const revoked = await fixture.app.inject({
        method: 'DELETE',
        url: `/v1/credentials/${firstId}`,
        headers: authenticatedMutationHeaders(sessionCookies, verifiedBody.csrfToken),
      });
      expect(revoked.statusCode).toBe(200);
      expect(revoked.json()).toMatchObject({
        credential: { credentialId: firstId },
        synchronizedWrappersDeleted: true,
        sessionsRevoked: true,
        onchainDelegationRevocationRequiredSeparately: true,
      });
      expect(normalizedSetCookie(revoked)).toContain(`${SESSION_COOKIE_NAME}=;`);
      expect(normalizedSetCookie(revoked)).toContain(`${CSRF_COOKIE_NAME}=;`);

      const afterRevocation = await fixture.app.inject({
        method: 'GET',
        url: '/v1/session',
        headers: { cookie: serializeCookies(sessionCookies) },
      });
      expect(afterRevocation.statusCode).toBe(401);

      const loginCsrf = await bootstrapCsrf(fixture.app);
      const loginOptions = await fixture.app.inject({
        method: 'POST',
        url: '/v1/authentication/options',
        headers: mutationHeaders(loginCsrf),
        payload: {},
      });
      const loginCeremony = loginOptions.json<{ ceremonyId: string }>();
      const login = await fixture.app.inject({
        method: 'POST',
        url: '/v1/authentication/verify',
        headers: mutationHeaders(loginCsrf),
        payload: {
          ceremonyId: loginCeremony.ceremonyId,
          response: authenticationResponse(secondId, issued.options.user.id),
        },
      });
      expect(login.statusCode).toBe(200);
      const loginBody = login.json<{ csrfToken: string }>();
      const loginCookies = cookieJar(login);

      const stepOptions = await fixture.app.inject({
        method: 'POST',
        url: '/v1/step-up/options',
        headers: authenticatedMutationHeaders(loginCookies, loginBody.csrfToken),
        payload: {},
      });
      const stepCeremony = stepOptions.json<{ ceremonyId: string }>();
      const stepped = await fixture.app.inject({
        method: 'POST',
        url: '/v1/step-up/verify',
        headers: authenticatedMutationHeaders(loginCookies, loginBody.csrfToken),
        payload: {
          ceremonyId: stepCeremony.ceremonyId,
          response: authenticationResponse(secondId),
        },
      });
      expect(stepped.statusCode).toBe(200);
      const steppedBody = stepped.json<{ csrfToken: string }>();
      const steppedCookies = cookieJar(stepped);

      const last = await fixture.app.inject({
        method: 'DELETE',
        url: `/v1/credentials/${secondId}`,
        headers: authenticatedMutationHeaders(steppedCookies, steppedBody.csrfToken),
      });
      expect(last.statusCode).toBe(409);
      expect(last.json()).toMatchObject({ error: { code: 'last-credential' } });

      const logout = await fixture.app.inject({
        method: 'POST',
        url: '/v1/logout',
        headers: authenticatedMutationHeaders(steppedCookies, steppedBody.csrfToken),
        payload: {},
      });
      expect(logout.statusCode).toBe(204);
      const afterLogout = await fixture.app.inject({
        method: 'GET',
        url: '/v1/session',
        headers: { cookie: serializeCookies(steppedCookies) },
      });
      expect(afterLogout.statusCode).toBe(401);
    } finally {
      await fixture.app.close();
    }
  });

  it('performs discoverable login, then requires and verifies fresh step-up', async () => {
    const fixture = await appFixture();
    try {
      const registered = await registerThroughApi(fixture.app, credentialId(33));
      const csrf = await bootstrapCsrf(fixture.app);
      const options = await fixture.app.inject({
        method: 'POST',
        url: '/v1/authentication/options',
        headers: mutationHeaders(csrf),
        payload: {},
      });
      const issued = options.json<{
        ceremonyId: string;
        options: { allowCredentials: unknown[]; userVerification: string };
      }>();
      expect(issued.options).toMatchObject({
        allowCredentials: [],
        userVerification: 'required',
      });
      const verified = await fixture.app.inject({
        method: 'POST',
        url: '/v1/authentication/verify',
        headers: mutationHeaders(csrf),
        payload: {
          ceremonyId: issued.ceremonyId,
          response: authenticationResponse(registered.credentialId, registered.userHandle),
        },
      });
      expect(verified.statusCode).toBe(200);
      const body = verified.json<{ csrfToken: string }>();
      const cookies = cookieJar(verified);

      const premature = await fixture.app.inject({
        method: 'POST',
        url: '/v1/credentials/registration/options',
        headers: authenticatedMutationHeaders(cookies, body.csrfToken),
        payload: {},
      });
      expect(premature.statusCode).toBe(403);
      expect(premature.json()).toMatchObject({ error: { code: 'step-up-required' } });

      const stepOptions = await fixture.app.inject({
        method: 'POST',
        url: '/v1/step-up/options',
        headers: authenticatedMutationHeaders(cookies, body.csrfToken),
        payload: {},
      });
      const step = stepOptions.json<{ ceremonyId: string }>();
      const stepped = await fixture.app.inject({
        method: 'POST',
        url: '/v1/step-up/verify',
        headers: authenticatedMutationHeaders(cookies, body.csrfToken),
        payload: {
          ceremonyId: step.ceremonyId,
          response: authenticationResponse(registered.credentialId),
        },
      });
      expect(stepped.statusCode).toBe(200);
      expect(cookieJar(stepped)[SESSION_COOKIE_NAME]).not.toBe(cookies[SESSION_COOKIE_NAME]);
    } finally {
      await fixture.app.close();
    }
  });

  it('rejects PRF output and plaintext key fields before ceremony handling', async () => {
    const fixture = await appFixture();
    try {
      const csrf = await bootstrapCsrf(fixture.app);
      for (const payload of [
        { prfOutput: 'server-must-never-see-this' },
        { privateKey: 'server-must-never-see-this' },
        { accountKeySeed: 'server-must-never-see-this' },
        { clientExtensionResults: { prf: { results: { first: 'secret' } } } },
      ]) {
        const response = await fixture.app.inject({
          method: 'POST',
          url: '/v1/registration/options',
          headers: mutationHeaders(csrf),
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json()).toMatchObject({ error: { code: 'invalid-request' } });
        expect(response.body).not.toContain('server-must-never-see-this');
      }
    } finally {
      await fixture.app.close();
    }
  });

  it('requires the initial root wrapper before activation', async () => {
    const fixture = await appFixture();
    try {
      const csrf = await bootstrapCsrf(fixture.app);
      const optionsResponse = await fixture.app.inject({
        method: 'POST',
        url: '/v1/registration/options',
        headers: mutationHeaders(csrf),
        payload: {},
      });
      const issued = optionsResponse.json<{ accountId: string; ceremonyId: string }>();
      const id = credentialId(34);
      const verified = await fixture.app.inject({
        method: 'POST',
        url: '/v1/registration/verify',
        headers: mutationHeaders(csrf),
        payload: {
          accountId: issued.accountId,
          ceremonyId: issued.ceremonyId,
          response: registrationResponse(id),
        },
      });

      expect(verified.statusCode).toBe(400);
      expect(verified.json()).toMatchObject({ error: { code: 'invalid-request' } });
      expect(fixture.verifier.registrationCalls).toHaveLength(0);
      await expect(fixture.store.getAccount(issued.accountId)).resolves.toMatchObject({
        status: 'pending',
      });
      await expect(fixture.store.getCredential(id)).resolves.toBeUndefined();
    } finally {
      await fixture.app.close();
    }
  });

  it('rejects an added passkey for a different root without persisting it', async () => {
    const fixture = await appFixture();
    try {
      const registered = await registerThroughApi(fixture.app, credentialId(35));
      const addOptions = await fixture.app.inject({
        method: 'POST',
        url: '/v1/credentials/registration/options',
        headers: authenticatedMutationHeaders(registered.cookies, registered.csrfToken),
        payload: {},
      });
      const issued = addOptions.json<{ ceremonyId: string }>();
      const secondId = credentialId(36);
      const added = await fixture.app.inject({
        method: 'POST',
        url: '/v1/credentials/registration/verify',
        headers: authenticatedMutationHeaders(registered.cookies, registered.csrfToken),
        payload: {
          ceremonyId: issued.ceremonyId,
          response: registrationResponse(secondId),
          bundle: await wrappedKeyBundle(secondId, {
            publicKey: Uint8Array.from({ length: 32 }, (_, index) => 120 + index),
          }),
        },
      });

      expect(added.statusCode).toBe(400);
      expect(added.json()).toMatchObject({ error: { code: 'bundle-invalid' } });
      await expect(fixture.store.getCredential(secondId)).resolves.toBeUndefined();
      await expect(fixture.store.listCredentials(registered.accountId)).resolves.toHaveLength(1);
      await expect(fixture.store.listKeyBundles(registered.accountId)).resolves.toHaveLength(1);
    } finally {
      await fixture.app.close();
    }
  });
});

async function appFixture() {
  const store = new MemoryAuthStore();
  const verifier = new FakeCeremonyVerifier();
  const service = new AuthService({
    store,
    verifier,
    rpName: 'WokeSocial Test',
    rpId: 'localhost',
    origin,
  });
  const app = await buildAuthApp({ service, logger: false, rateLimitMax: 200 });
  return { app, service, store, verifier };
}

async function registerThroughApi(app: FastifyInstance, id: string) {
  const csrf = await bootstrapCsrf(app);
  const optionsResponse = await app.inject({
    method: 'POST',
    url: '/v1/registration/options',
    headers: mutationHeaders(csrf),
    payload: {},
  });
  const issued = optionsResponse.json<{
    accountId: string;
    ceremonyId: string;
    options: { user: { id: string } };
  }>();
  const verified = await app.inject({
    method: 'POST',
    url: '/v1/registration/verify',
    headers: mutationHeaders(csrf),
    payload: {
      accountId: issued.accountId,
      ceremonyId: issued.ceremonyId,
      response: registrationResponse(id),
      bundle: await wrappedKeyBundle(id),
    },
  });
  expect(verified.statusCode).toBe(201);
  const body = verified.json<{ csrfToken: string }>();
  return {
    accountId: issued.accountId,
    credentialId: id,
    userHandle: issued.options.user.id,
    csrfToken: body.csrfToken,
    cookies: cookieJar(verified),
  };
}

async function bootstrapCsrf(app: FastifyInstance) {
  const response = await app.inject({ method: 'GET', url: '/v1/csrf' });
  const body = response.json<{ csrfToken: string }>();
  return {
    csrfToken: body.csrfToken,
    cookie: `${CSRF_COOKIE_NAME}=${body.csrfToken}`,
    setCookie: normalizedSetCookie(response),
  };
}

function mutationHeaders(
  csrf: { readonly csrfToken: string; readonly cookie: string },
  requestOrigin = origin,
) {
  return {
    origin: requestOrigin,
    cookie: csrf.cookie,
    'x-csrf-token': csrf.csrfToken,
  };
}

function authenticatedMutationHeaders(cookies: Record<string, string>, csrfToken: string) {
  return {
    origin,
    cookie: serializeCookies(cookies),
    'x-csrf-token': csrfToken,
  };
}

function cookieJar(response: { readonly headers: OutgoingHttpHeaders }): Record<string, string> {
  const jar: Record<string, string> = {};
  for (const cookie of setCookieValues(response)) {
    const [pair] = cookie.split(';');
    const separator = pair?.indexOf('=');
    if (pair === undefined || separator === undefined || separator < 1) continue;
    jar[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return jar;
}

function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ');
}

function normalizedSetCookie(response: { readonly headers: OutgoingHttpHeaders }): string {
  return setCookieValues(response).join('\n');
}

function setCookieValues(response: { readonly headers: OutgoingHttpHeaders }): string[] {
  const value = response.headers['set-cookie'];
  return value === undefined ? [] : Array.isArray(value) ? value.map(String) : [String(value)];
}
