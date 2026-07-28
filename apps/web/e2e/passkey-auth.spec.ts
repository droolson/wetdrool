import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const AUTH_SERVICE_URL = `http://localhost:${process.env.SOCIALLY_WOKE_AUTH_PORT ?? '4300'}`;

interface ObservedRequest {
  readonly body: unknown;
  readonly method: string;
  readonly path: string;
}

test('registers, synchronizes ciphertext, logs out, and signs in discoverably', async ({
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

  const registrationVerification = requestBody(observed, '/v1/registration/verify');
  const authenticationVerification = requestBody(observed, '/v1/authentication/verify');
  expect(nestedObject(registrationVerification, 'response')['clientExtensionResults']).toEqual({});
  expect(nestedObject(authenticationVerification, 'response')['clientExtensionResults']).toEqual(
    {},
  );

  const bundleWrite = observed.find(
    (request) => request.method === 'PUT' && request.path.startsWith('/v1/key-bundles/'),
  );
  expect(bundleWrite).toBeDefined();
  const bundle = nestedObject(bundleWrite?.body, 'bundle');
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

async function installPrfAuthenticator(context: BrowserContext, page: Page): Promise<void> {
  const client = await context.newCDPSession(page);
  await client.send('WebAuthn.enable');
  await client.send('WebAuthn.addVirtualAuthenticator', {
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
  const matches = observed.filter((request) => request.path === path);
  expect(matches).toHaveLength(1);
  return matches[0]?.body;
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
