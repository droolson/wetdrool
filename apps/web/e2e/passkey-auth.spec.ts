import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';

const AUTH_SERVICE_URL = `http://localhost:${process.env.WOKESOCIAL_AUTH_PORT ?? '4300'}`;
const SESSION_COOKIE_NAME = '__Host-wokesocial-session';

interface ObservedRequest {
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
}

interface AssertedCredential {
  readonly authenticatorId: string;
}

// These stateful ceremonies share the local Next dev server. Serial execution
// prevents an on-demand compilation reload from discarding another flow's
// in-memory browser result between WebAuthn verification and its UI assertion.
test.describe.configure({ mode: 'serial' });

test('registers ciphertext atomically, logs out, and signs in discoverably', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'One Chromium ceremony covers this browser path.',
  );
  test.skip(
    process.env.PLAYWRIGHT_BASE_URL !== undefined,
    'The state-changing passkey gate runs only against the local ephemeral auth service.',
  );

  await installPrfAuthenticator(context, page);
  const observed = observeAuthRequests(page);

  await page.goto('/onboarding');
  await expect(
    page.getByText('No active authentication-service session was found in this browser.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Create a passkey account' }).click();

  await expect(
    page.getByRole('heading', {
      name: 'Embedded signing material passed its local check.',
    }),
  ).toBeVisible();
  await expect(page.getByText('Not created', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Fail-closed fallback')).toHaveCount(0);
  const anonymousName = page.getByText(/^anon_[0-9a-hjkmnp-tv-z]{16}\.woke$/u);
  await expect(anonymousName).toBeVisible();
  const registeredAnonymousName = await anonymousName.innerText();
  await expect(
    page.getByText('Deterministically derived; not claimed onchain yet', { exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Sign out of service session' }).click();
  await expect(
    page.getByText('The authentication-service session was closed in this browser.'),
  ).toBeVisible();

  await page.goto('/signin');
  await expect(
    page.getByText('No active authentication-service session was found in this browser.'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();

  await expect(
    page.getByRole('heading', {
      name: 'Embedded signing material passed its local check.',
    }),
  ).toBeVisible();
  await expect(page.getByText('Not created', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Fail-closed fallback')).toHaveCount(0);
  await expect(page.getByText(registeredAnonymousName, { exact: true })).toBeVisible();

  const registrationVerification = requestBody(observed, '/v1/registration/verify');
  const authenticationVerification = requestBody(observed, '/v1/authentication/verify');
  expect(nestedObject(registrationVerification, 'response')['clientExtensionResults']).toEqual({});
  expect(nestedObject(authenticationVerification, 'response')['clientExtensionResults']).toEqual(
    {},
  );

  const legacyBundleWrites = observed.filter(
    (request) => request.method === 'PUT' && request.path.startsWith('/v1/key-bundles/'),
  );
  expect(legacyBundleWrites).toHaveLength(0);
  const bundle = nestedObject(registrationVerification, 'bundle');
  expect(Object.keys(bundle).sort()).toEqual([
    'algorithm',
    'credentialBinding',
    'encryptedKey',
    'kdf',
    'keyKind',
    'publicKey',
    'salt',
    'version',
  ]);
  expect(Object.keys(nestedObject(bundle, 'encryptedKey')).sort()).toEqual([
    'algorithm',
    'ciphertext',
    'domain',
    'nonce',
    'version',
  ]);

  const serializedBodies = JSON.stringify(observed.map((request) => request.body));
  expect(serializedBodies).not.toMatch(
    /"prf"|"prfOutput"|"prfResults"|"accountKeySeed"|"privateKey"|"plaintextKey"|"seed"/u,
  );
});

test('adds, lists, revokes, and rejects a passkey with real Chromium authenticators', async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'chromium',
    'Desktop Chromium provides the virtual-authenticator controls used by this security gate.',
  );
  test.skip(
    process.env.PLAYWRIGHT_BASE_URL !== undefined,
    'The state-changing passkey gate runs only against the local ephemeral auth service.',
  );

  const authenticators = await installPrfAuthenticator(context, page);
  const firstAuthenticator = authenticators.initialAuthenticatorId;
  const observed = observeAuthRequests(page);

  await page.goto('/onboarding');
  await page.getByRole('button', { name: 'Create a passkey account' }).click();
  await expect(
    page.getByRole('heading', {
      name: 'Embedded signing material passed its local check.',
    }),
  ).toBeVisible();

  const firstRegistration = requestBody(observed, '/v1/registration/verify');
  const firstCredentialId = stringProperty(nestedObject(firstRegistration, 'response'), 'id');
  const firstBundle = nestedObject(firstRegistration, 'bundle');
  expect(await authenticators.credentialCount(firstAuthenticator)).toBe(1);

  await page.goto('/settings/devices');
  const passkeyList = page.getByRole('list', {
    name: 'Authentication-service passkeys',
  });
  await expect(passkeyList.getByRole('listitem')).toHaveCount(1);
  await expect(passkeyList).toContainText(abbreviate(firstCredentialId));
  await expect(passkeyList).toContainText('Active');

  const secondAuthenticator = await authenticators.addAuthenticator(false);
  await page.route(
    '**/v1/step-up/verify',
    async (route) => {
      await authenticators.select(secondAuthenticator);
      await route.continue();
    },
    { times: 1 },
  );

  const additionalVerification = page.waitForResponse(
    (response) => response.url() === `${AUTH_SERVICE_URL}/v1/credentials/registration/verify`,
  );
  await page.getByRole('button', { name: 'Add another passkey' }).click();
  expect((await additionalVerification).status()).toBe(201);
  await expect(
    page.getByText(/was added with a new encrypted wrapper for the same local account root/u),
  ).toBeVisible();

  const secondRegistration = requestBody(observed, '/v1/credentials/registration/verify');
  const secondCredentialId = stringProperty(nestedObject(secondRegistration, 'response'), 'id');
  const secondBundle = nestedObject(secondRegistration, 'bundle');
  expect(secondCredentialId).not.toBe(firstCredentialId);
  expect(stringProperty(secondBundle, 'publicKey')).toBe(stringProperty(firstBundle, 'publicKey'));
  expect(stringProperty(secondBundle, 'credentialBinding')).not.toBe(
    stringProperty(firstBundle, 'credentialBinding'),
  );
  expect(stringProperty(nestedObject(secondBundle, 'encryptedKey'), 'ciphertext')).not.toBe(
    stringProperty(nestedObject(firstBundle, 'encryptedKey'), 'ciphertext'),
  );
  expect(await authenticators.credentialCount(firstAuthenticator)).toBe(1);
  expect(await authenticators.credentialCount(secondAuthenticator)).toBe(1);
  expect(credentialIdsForRequests(observed, '/v1/step-up/verify')).toEqual([firstCredentialId]);
  await expect(passkeyList.getByRole('listitem')).toHaveCount(2);
  await expect(passkeyList).toContainText(abbreviate(firstCredentialId));
  await expect(passkeyList).toContainText(abbreviate(secondCredentialId));

  const firstPasskey = passkeyList
    .getByRole('listitem')
    .filter({ hasText: abbreviate(firstCredentialId) });
  await firstPasskey.getByRole('button', { name: 'Revoke passkey' }).click();
  await expect(firstPasskey).toContainText('ends every authentication-service session');

  let sessionImmediatelyBeforeRevocation: string | undefined;
  let sessionStatusImmediatelyBeforeRevocation: number | undefined;
  await page.route(
    '**/v1/credentials/*',
    async (route) => {
      try {
        const sessionCookie = (await context.cookies(AUTH_SERVICE_URL)).find(
          (cookie) => cookie.name === SESSION_COOKIE_NAME,
        );
        if (sessionCookie !== undefined) {
          sessionImmediatelyBeforeRevocation = `${sessionCookie.name}=${sessionCookie.value}`;
          sessionStatusImmediatelyBeforeRevocation = (
            await fetch(`${AUTH_SERVICE_URL}/v1/session`, {
              headers: { cookie: sessionImmediatelyBeforeRevocation },
            })
          ).status;
        }
      } finally {
        await route.continue();
      }
    },
    { times: 1 },
  );

  const revocationResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      response.url() ===
        `${AUTH_SERVICE_URL}/v1/credentials/${encodeURIComponent(firstCredentialId)}`,
  );
  await firstPasskey.getByRole('button', { name: 'Verify and revoke' }).click();
  const revocation = await revocationResponse;
  expect({
    body: await revocation.json(),
    status: revocation.status(),
  }).toMatchObject({
    body: {
      credential: {
        credentialId: firstCredentialId,
        revokedAt: expect.any(String),
      },
      onchainDelegationRevocationRequiredSeparately: true,
      sessionsRevoked: true,
      synchronizedWrappersDeleted: true,
    },
    status: 200,
  });
  await expect(
    page.getByText(
      'The passkey and its encrypted wrapper were revoked. The authentication service also ended every service session for this account.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'No active authentication-service session is available in this browser. Sign in before listing or changing passkeys.',
    ),
  ).toBeVisible();

  expect(sessionStatusImmediatelyBeforeRevocation).toBe(200);
  expect(sessionImmediatelyBeforeRevocation).toBeDefined();
  expect(credentialIdsForRequests(observed, '/v1/step-up/verify')).toEqual([
    firstCredentialId,
    secondCredentialId,
  ]);
  const revokedSession = await fetch(`${AUTH_SERVICE_URL}/v1/session`, {
    headers: { cookie: sessionImmediatelyBeforeRevocation ?? '' },
  });
  expect(revokedSession.status).toBe(401);
  await expect(revokedSession.json()).resolves.toMatchObject({
    error: { code: 'session-required' },
  });

  await page.goto('/signin');
  const remainingCredentialVerification = page.waitForResponse(
    (response) => response.url() === `${AUTH_SERVICE_URL}/v1/authentication/verify`,
  );
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  expect((await remainingCredentialVerification).status()).toBe(200);
  await expect(
    page.getByRole('heading', {
      name: 'Embedded signing material passed its local check.',
    }),
  ).toBeVisible();
  const successfulAuthentication = requestBodies(observed, '/v1/authentication/verify').at(-1);
  expect(stringProperty(nestedObject(successfulAuthentication, 'response'), 'id')).toBe(
    secondCredentialId,
  );

  await page.getByRole('button', { name: 'Sign out of service session' }).click();
  await authenticators.select(firstAuthenticator);
  const revokedCredentialVerification = page.waitForResponse(
    (response) => response.url() === `${AUTH_SERVICE_URL}/v1/authentication/verify`,
  );
  await page.getByRole('button', { name: 'Sign in with a passkey' }).click();
  const rejected = await revokedCredentialVerification;
  expect(rejected.status()).toBe(400);
  await expect(rejected.json()).resolves.toMatchObject({
    error: { code: 'verification-failed' },
  });
  await expect(
    page
      .getByRole('alert')
      .getByText('The authentication service rejected the ceremony. Please start again.'),
  ).toBeVisible();
  const rejectedAuthentication = requestBodies(observed, '/v1/authentication/verify').at(-1);
  expect(stringProperty(nestedObject(rejectedAuthentication, 'response'), 'id')).toBe(
    firstCredentialId,
  );
  expect(
    (await context.cookies(AUTH_SERVICE_URL)).find((cookie) => cookie.name === SESSION_COOKIE_NAME),
  ).toBeUndefined();

  const postFailureSession = await fetch(`${AUTH_SERVICE_URL}/v1/session`, {
    headers: { cookie: sessionImmediatelyBeforeRevocation ?? '' },
  });
  expect(postFailureSession.status).toBe(401);
  const assertedAuthenticators = authenticators.assertedCredentials.map(
    (event) => event.authenticatorId,
  );
  expect(assertedAuthenticators[0]).toBe(firstAuthenticator);
  expect(assertedAuthenticators.at(-1)).toBe(firstAuthenticator);
  expect(assertedAuthenticators.slice(1, -1)).not.toHaveLength(0);
  expect(new Set(assertedAuthenticators.slice(1, -1))).toEqual(new Set([secondAuthenticator]));
});

async function installPrfAuthenticator(
  context: BrowserContext,
  page: Page,
): Promise<VirtualAuthenticatorSet> {
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  const authenticator = await client.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      ctap2Version: 'ctap2_1',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      hasPrf: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
      defaultBackupEligibility: false,
      defaultBackupState: false,
    },
  });
  return new VirtualAuthenticatorSet(client, authenticator.authenticatorId);
}

class VirtualAuthenticatorSet {
  readonly assertedCredentials: AssertedCredential[] = [];
  readonly initialAuthenticatorId: string;
  readonly #authenticatorIds: string[];
  readonly #client: CDPSession;

  constructor(client: CDPSession, initialAuthenticatorId: string) {
    this.#client = client;
    this.initialAuthenticatorId = initialAuthenticatorId;
    this.#authenticatorIds = [initialAuthenticatorId];
    client.on('WebAuthn.credentialAsserted', (event) => {
      this.assertedCredentials.push({ authenticatorId: event.authenticatorId });
    });
  }

  async addAuthenticator(active: boolean): Promise<string> {
    const created = await this.#client.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        ctap2Version: 'ctap2_1',
        // Chromium permits only one virtual `internal` authenticator per
        // environment, so the independent second passkey is a CTAP2 USB key.
        transport: 'usb',
        hasResidentKey: true,
        hasUserVerification: true,
        hasPrf: true,
        isUserVerified: true,
        automaticPresenceSimulation: active,
        defaultBackupEligibility: false,
        defaultBackupState: false,
      },
    });
    this.#authenticatorIds.push(created.authenticatorId);
    return created.authenticatorId;
  }

  async select(authenticatorId: string): Promise<void> {
    expect(this.#authenticatorIds).toContain(authenticatorId);
    for (const candidate of this.#authenticatorIds) {
      await this.#client.send('WebAuthn.setAutomaticPresenceSimulation', {
        authenticatorId: candidate,
        enabled: false,
      });
    }
    await this.#client.send('WebAuthn.setAutomaticPresenceSimulation', {
      authenticatorId,
      enabled: true,
    });
  }

  async credentialCount(authenticatorId: string): Promise<number> {
    return (
      await this.#client.send('WebAuthn.getCredentials', {
        authenticatorId,
      })
    ).credentials.length;
  }
}

function observeAuthRequests(page: Page): ObservedRequest[] {
  const observed: ObservedRequest[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.origin !== AUTH_SERVICE_URL || request.postData() === null) return;
    observed.push({
      body: JSON.parse(request.postData() ?? 'null') as unknown,
      method: request.method(),
      path: url.pathname,
    });
  });
  return observed;
}

function requestBody(observed: readonly ObservedRequest[], path: string): unknown {
  const matches = requestBodies(observed, path);
  expect(matches).toHaveLength(1);
  return matches[0];
}

function requestBodies(observed: readonly ObservedRequest[], path: string): unknown[] {
  return observed.filter((request) => request.path === path).map((request) => request.body);
}

function credentialIdsForRequests(observed: readonly ObservedRequest[], path: string): string[] {
  return requestBodies(observed, path).map((body) =>
    stringProperty(nestedObject(body, 'response'), 'id'),
  );
}

function nestedObject(value: unknown, property: string): Record<string, unknown> {
  expect(typeof value).toBe('object');
  expect(value).not.toBeNull();
  expect(Array.isArray(value)).toBe(false);
  const nested = (value as Record<string, unknown>)[property];
  expect(typeof nested).toBe('object');
  expect(nested).not.toBeNull();
  expect(Array.isArray(nested)).toBe(false);
  return nested as Record<string, unknown>;
}

function stringProperty(value: Record<string, unknown>, property: string): string {
  const nested = value[property];
  expect(typeof nested).toBe('string');
  return nested as string;
}

function abbreviate(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
}
