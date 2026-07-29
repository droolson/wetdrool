import { describe, expect, it } from 'vitest';

import type { PasskeyWrappedKeyBundle, UnwrapPasskeyAccountKeyInput } from '@wokesocial/crypto';

import {
  BrowserAuthClient,
  type LocalKeyOperations,
  type PasskeyOperationSigner,
  type PasskeyPlatform,
} from '../lib/auth/browser-auth-client';
import { ciphertextBundle, type TokenStorage } from '../lib/auth/auth-api';
import { BrowserAuthError } from '../lib/auth/errors';
import { encodeBase64Url, extractPrfOutput } from '../lib/auth/passkey-codec';

const accountId = `acct_${'A'.repeat(22)}`;
const ceremonyId = `cer_${'B'.repeat(22)}`;
const csrf = 'C'.repeat(43);
const sessionCsrf = 'D'.repeat(43);
const credentialBytes = bytes(31, 32);
const credentialId = encodeBase64Url(credentialBytes);
const prfSecret = bytes(71, 32);
const newPrfSecret = bytes(91, 32);
const localSeed = bytes(111, 32);
const publicKey = bytes(151, 32);
const newCredentialBytes = bytes(191, 32);
const newCredentialId = encodeBase64Url(newCredentialBytes);

describe('browser passkey authentication boundary', () => {
  it.each(['https://sociallywoke.com', 'https://WWW.SOCIALLYWOKE.COM..'])(
    'rejects the legacy redirect host %s as an authentication-service origin',
    (baseUrl) => {
      expect(
        () =>
          new BrowserAuthClient({
            baseUrl,
            tokenStorage: new MemoryStorage(),
          }),
      ).toThrow('not a permitted secure origin');
    },
  );

  it('registers with an atomic ciphertext bundle while clearing client key buffers', async () => {
    const recorder = registrationApi();
    const storage = new MemoryStorage();
    const platform = registrationPlatform(prfSecret);
    let wrappedPrf: Uint8Array | undefined;
    let wrappedSeed: Uint8Array | undefined;
    const operations: LocalKeyOperations = {
      randomBytes: () => localSeed.slice(),
      publicKeyFromSeed: () => publicKey.slice(),
      sign: () => {
        throw new Error('Registration must not sign a message.');
      },
      wrap: async (input) => {
        wrappedPrf = input.prfOutput;
        wrappedSeed = input.accountKeySeed;
        return {
          ...bundleFixture(),
          // Deliberately hostile extra fields must be projected away by the
          // network boundary even if a caller bypasses the TypeScript type.
          prfOutput: encodeBase64Url(prfSecret),
          accountKeySeed: encodeBase64Url(localSeed),
          privateKey: encodeBase64Url(localSeed),
        } as unknown as PasskeyWrappedKeyBundle;
      },
      unwrap: async () => {
        throw new Error('Registration must not unwrap a key.');
      },
    };
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: storage,
      platform,
      keyOperations: operations,
    });

    const result = await client.register();
    expect(result).toMatchObject({
      accountId,
      credentialId,
      protocolIdentityEstablished: false,
      key: {
        status: 'ready',
        publicKey: encodeBase64Url(publicKey),
        lifecycle: 'generated-wrapped-and-cleared',
      },
    });
    expect(wrappedPrf).toBeDefined();
    expect(wrappedSeed).toBeDefined();
    expect(wrappedPrf?.every((value) => value === 0)).toBe(true);
    expect(wrappedSeed?.every((value) => value === 0)).toBe(true);

    const session = await client.session();
    expect(session).toMatchObject({ accountId });
    await client.logout();
    expect(storage.values.size).toBe(0);

    assertNoKeyMaterial(recorder.calls);
    const verification = requestBody(recorder.calls, '/v1/registration/verify');
    expect(objectValue(objectValue(verification)['response'])['clientExtensionResults']).toEqual(
      {},
    );
    expect(Object.keys(objectValue(verification)['bundle'] as object).sort()).toEqual([
      'algorithm',
      'credentialBinding',
      'encryptedKey',
      'kdf',
      'keyKind',
      'publicKey',
      'salt',
      'version',
    ]);
    expect(
      recorder.calls.some(
        (call) =>
          call.init.method === 'PUT' && new URL(call.url).pathname.startsWith('/v1/key-bundles/'),
      ),
    ).toBe(false);
  });

  it('signs in discoverably, unwraps the matching bundle locally, and clears the result', async () => {
    const recorder = authenticationApi();
    const unwrappedSeed = localSeed.slice();
    let unwrappedPrf: Uint8Array | undefined;
    const operations: LocalKeyOperations = {
      randomBytes: () => {
        throw new Error('Sign-in must not create a replacement key.');
      },
      publicKeyFromSeed: () => publicKey.slice(),
      sign: () => {
        throw new Error('Sign-in must not sign a message.');
      },
      wrap: async () => {
        throw new Error('Sign-in must not wrap a replacement key.');
      },
      unwrap: async (input: UnwrapPasskeyAccountKeyInput) => {
        unwrappedPrf = input.prfOutput;
        return unwrappedSeed;
      },
    };
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: new MemoryStorage(),
      platform: authenticationPlatform(prfSecret),
      keyOperations: operations,
    });

    const result = await client.signIn();
    expect(result).toMatchObject({
      accountId,
      credentialId,
      protocolIdentityEstablished: false,
      key: {
        status: 'ready',
        publicKey: encodeBase64Url(publicKey),
        lifecycle: 'unwrapped-verified-and-cleared',
      },
    });
    expect(unwrappedSeed.every((value) => value === 0)).toBe(true);
    expect(unwrappedPrf?.every((value) => value === 0)).toBe(true);
    assertNoKeyMaterial(recorder.calls);
    const verification = requestBody(recorder.calls, '/v1/authentication/verify');
    expect(objectValue(objectValue(verification)['response'])['clientExtensionResults']).toEqual(
      {},
    );
  });

  it('rejects registration before verification when PRF is unsupported', async () => {
    const recorder = registrationApi();
    const operations: LocalKeyOperations = {
      randomBytes: () => {
        throw new Error('A key must not be generated without PRF.');
      },
      publicKeyFromSeed: () => {
        throw new Error('A public key must not be derived without PRF.');
      },
      sign: () => {
        throw new Error('A message must not be signed without PRF.');
      },
      wrap: async () => {
        throw new Error('A key must not be wrapped without PRF.');
      },
      unwrap: async () => {
        throw new Error('A key must not be unwrapped without PRF.');
      },
    };
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: new MemoryStorage(),
      platform: registrationPlatform(undefined),
      keyOperations: operations,
    });

    const registration = client.register();
    await expect(registration).rejects.toBeInstanceOf(BrowserAuthError);
    await expect(registration).rejects.toMatchObject({ code: 'prf-required' });
    expect(recorder.calls.some((call) => call.url.endsWith('/v1/registration/verify'))).toBe(false);
    expect(recorder.calls.some((call) => call.url.includes('/v1/key-bundles/'))).toBe(false);
    assertNoKeyMaterial(recorder.calls);
  });

  it('lists complete authentication-service passkey records', async () => {
    const recorder = credentialListApi();
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: new MemoryStorage(),
      platform: unreachablePlatform(),
    });

    await expect(client.listPasskeys()).resolves.toEqual([
      credentialView(credentialId),
      credentialView(newCredentialId, {
        backedUp: true,
        deviceType: 'multiDevice',
        lastUsedAt: null,
        revokedAt: '2026-07-28T21:00:00.000Z',
      }),
    ]);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0]?.init.method).toBe('GET');
    expect(new URL(recorder.calls[0]?.url ?? '').pathname).toBe('/v1/credentials');
  });

  it('adds a passkey by unwrapping the existing root and atomically wrapping that same root', async () => {
    const recorder = additionalPasskeyApi();
    const storage = authenticatedStorage();
    const unwrappedSeed = localSeed.slice();
    let unwrappedPrf: Uint8Array | undefined;
    let wrappedPrf: Uint8Array | undefined;
    let wrappedSeed: Uint8Array | undefined;
    let wrappedPublicKey: Uint8Array | undefined;
    const operations: LocalKeyOperations = {
      randomBytes: () => {
        throw new Error('Adding a passkey must not generate a replacement root.');
      },
      publicKeyFromSeed: (seed) => {
        expect(seed).toBe(unwrappedSeed);
        return publicKey.slice();
      },
      sign: () => {
        throw new Error('Adding a passkey must not sign a message.');
      },
      wrap: async (input) => {
        expect(input.credentialId).toEqual(newCredentialBytes);
        expect(input.prfOutput).toEqual(newPrfSecret);
        expect(input.accountKeySeed).toEqual(localSeed);
        expect(input.publicKey).toEqual(publicKey);
        wrappedPrf = input.prfOutput;
        wrappedSeed = input.accountKeySeed;
        wrappedPublicKey = input.publicKey;
        return {
          ...bundleFixture(),
          credentialBinding: encodeBase64Url(bytes(211, 32)),
          prfOutput: encodeBase64Url(newPrfSecret),
          accountKeySeed: encodeBase64Url(localSeed),
          privateKey: encodeBase64Url(localSeed),
        } as unknown as PasskeyWrappedKeyBundle;
      },
      unwrap: async (input) => {
        expect(input.credentialId).toEqual(credentialBytes);
        expect(input.prfOutput).toEqual(prfSecret);
        unwrappedPrf = input.prfOutput;
        return unwrappedSeed;
      },
    };
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: storage,
      platform: credentialLifecyclePlatform(),
      keyOperations: operations,
    });

    await expect(client.addPasskeyForExistingRoot()).resolves.toEqual(
      credentialView(newCredentialId),
    );
    expect(unwrappedPrf?.every((value) => value === 0)).toBe(true);
    expect(wrappedPrf?.every((value) => value === 0)).toBe(true);
    expect(wrappedSeed?.every((value) => value === 0)).toBe(true);
    expect(wrappedPublicKey?.every((value) => value === 0)).toBe(true);
    expect(unwrappedSeed.every((value) => value === 0)).toBe(true);

    expect(requestPaths(recorder.calls)).toEqual([
      'POST /v1/step-up/options',
      'POST /v1/step-up/verify',
      'POST /v1/credentials/registration/options',
      'GET /v1/key-bundles',
      'POST /v1/credentials/registration/verify',
    ]);
    expect(
      headerValue(recorder.calls, '/v1/credentials/registration/options', 'x-csrf-token'),
    ).toBe(sessionCsrf);
    const verification = requestBody(recorder.calls, '/v1/credentials/registration/verify');
    expect(objectValue(objectValue(verification)['response'])['clientExtensionResults']).toEqual(
      {},
    );
    expect(objectValue(objectValue(verification)['bundle'])['publicKey']).toBe(
      encodeBase64Url(publicKey),
    );
    expect(
      recorder.calls.some(
        (call) =>
          call.init.method === 'PUT' && new URL(call.url).pathname.startsWith('/v1/key-bundles/'),
      ),
    ).toBe(false);
    assertNoKeyMaterial(recorder.calls);
  });

  it('step-ups, verifies the synchronized root, and signs the exact operation bytes locally', async () => {
    const recorder = operationSigningApi();
    const harness = signingKeyHarness();
    const message = bytes(217, 73);
    const messageBeforeSigning = message.slice();
    const expectedSignature = harness.buffers.signatureWorking.slice();
    let scopedPublicKey: Uint8Array | undefined;
    let scopedSignature: Uint8Array | undefined;
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: authenticatedStorage(),
      platform: authenticationPlatform(prfSecret),
      keyOperations: harness.operations,
    });

    const result = await client.withFreshPasskeySigner(async (signer) => {
      expect(Object.isFrozen(signer)).toBe(true);
      expect(Object.keys(signer).sort()).toEqual([
        'credentialId',
        'publicKey',
        'publicKeyBytes',
        'sign',
      ]);
      expect(signer).not.toHaveProperty('seed');
      expect(signer).not.toHaveProperty('prfOutput');
      expect(signer.credentialId).toBe(credentialId);
      expect(signer.publicKey).toBe(encodeBase64Url(publicKey));
      expect(signer.publicKeyBytes).toEqual(publicKey);
      expect(signer.publicKeyBytes).not.toBe(harness.buffers.publicKeyWorking);
      scopedPublicKey = signer.publicKeyBytes;

      scopedSignature = signer.sign(message);
      expect(scopedSignature).toEqual(expectedSignature);
      expect(scopedSignature).not.toBe(harness.buffers.signatureWorking);
      expect(harness.buffers.messageWorking).not.toBe(message);
      expect(harness.buffers.messageSnapshot).toEqual(messageBeforeSigning);
      expect(harness.buffers.signingSeed).toBe(harness.buffers.seed);
      expect(message).toEqual(messageBeforeSigning);
      expect(harness.buffers.messageWorking?.every((value) => value === 0)).toBe(true);
      expect(harness.buffers.signatureWorking.every((value) => value === 0)).toBe(true);

      await Promise.resolve();
      expect(scopedSignature).toEqual(expectedSignature);
      return { publicKey: signer.publicKey, signed: true };
    });

    expect(result).toEqual({
      publicKey: encodeBase64Url(publicKey),
      signed: true,
    });
    expect(requestPaths(recorder.calls)).toEqual([
      'POST /v1/step-up/options',
      'POST /v1/step-up/verify',
      'GET /v1/key-bundles',
    ]);
    expect(harness.buffers.signCalls).toBe(1);
    expect(harness.buffers.prfOutput?.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.seed.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.publicKeyWorking.every((value) => value === 0)).toBe(true);
    expect(scopedPublicKey?.every((value) => value === 0)).toBe(true);
    expect(scopedSignature?.every((value) => value === 0)).toBe(true);
    assertNoKeyMaterial(recorder.calls);
  });

  it('clears every scoped signing buffer when the operation callback fails', async () => {
    const recorder = operationSigningApi();
    const harness = signingKeyHarness();
    const failure = new Error('transaction assembly failed');
    let capturedSigner: PasskeyOperationSigner | undefined;
    let scopedSignature: Uint8Array | undefined;
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: authenticatedStorage(),
      platform: authenticationPlatform(prfSecret),
      keyOperations: harness.operations,
    });

    const operation = client.withFreshPasskeySigner(async (signer) => {
      capturedSigner = signer;
      scopedSignature = signer.sign(bytes(31, 64));
      await Promise.resolve();
      throw failure;
    });

    await expect(operation).rejects.toBe(failure);
    expect(harness.buffers.prfOutput?.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.seed.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.publicKeyWorking.every((value) => value === 0)).toBe(true);
    expect(capturedSigner?.publicKeyBytes.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.messageWorking?.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.signatureWorking.every((value) => value === 0)).toBe(true);
    expect(scopedSignature?.every((value) => value === 0)).toBe(true);
    expect(() => capturedSigner?.sign(bytes(1, 1))).toThrowError(
      expect.objectContaining({ code: 'signer-expired' }),
    );
  });

  it('clears the step-up PRF and never invokes the operation when root unwrap fails', async () => {
    const recorder = operationSigningApi();
    const harness = signingKeyHarness({
      unwrapError: new Error('ciphertext authentication failed'),
    });
    let operationCalled = false;
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: authenticatedStorage(),
      platform: authenticationPlatform(prfSecret),
      keyOperations: harness.operations,
    });

    const operation = client.withFreshPasskeySigner(() => {
      operationCalled = true;
    });

    await expect(operation).rejects.toMatchObject({ code: 'key-wrapper-invalid' });
    expect(operationCalled).toBe(false);
    expect(harness.buffers.prfOutput?.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.signCalls).toBe(0);
  });

  it('rejects a synchronized root whose derived public key does not match its bundle', async () => {
    const recorder = operationSigningApi();
    const harness = signingKeyHarness({
      publicKeyWorking: bytes(7, 32),
    });
    let operationCalled = false;
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: authenticatedStorage(),
      platform: authenticationPlatform(prfSecret),
      keyOperations: harness.operations,
    });

    const operation = client.withFreshPasskeySigner(() => {
      operationCalled = true;
    });

    await expect(operation).rejects.toMatchObject({ code: 'key-wrapper-invalid' });
    expect(operationCalled).toBe(false);
    expect(harness.buffers.prfOutput?.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.seed.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.publicKeyWorking.every((value) => value === 0)).toBe(true);
    expect(harness.buffers.signCalls).toBe(0);
  });

  it('disables a captured signer as soon as its synchronous operation returns', async () => {
    const recorder = operationSigningApi();
    const harness = signingKeyHarness();
    let capturedSigner: PasskeyOperationSigner | undefined;
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: authenticatedStorage(),
      platform: authenticationPlatform(prfSecret),
      keyOperations: harness.operations,
    });

    await client.withFreshPasskeySigner((signer) => {
      capturedSigner = signer;
      return 'complete';
    });

    expect(() => capturedSigner?.sign(bytes(1, 32))).toThrowError(
      expect.objectContaining({ code: 'signer-expired' }),
    );
    expect(harness.buffers.signCalls).toBe(0);
    expect(capturedSigner?.publicKeyBytes.every((value) => value === 0)).toBe(true);
  });

  it('uses a fresh step-up to revoke a passkey and clears the rotated session boundary', async () => {
    const recorder = revocationApi();
    const storage = authenticatedStorage();
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: storage,
      platform: authenticationPlatform(undefined),
    });

    await expect(client.revokePasskey(newCredentialId)).resolves.toEqual(
      credentialView(newCredentialId, {
        revokedAt: '2026-07-28T22:00:00.000Z',
      }),
    );
    expect(requestPaths(recorder.calls)).toEqual([
      'POST /v1/step-up/options',
      'POST /v1/step-up/verify',
      `DELETE /v1/credentials/${newCredentialId}`,
    ]);
    expect(headerValue(recorder.calls, `/v1/credentials/${newCredentialId}`, 'x-csrf-token')).toBe(
      sessionCsrf,
    );
    expect(
      headerValue(recorder.calls, `/v1/credentials/${newCredentialId}`, 'content-type'),
    ).toBeNull();
    expect(storage.values.size).toBe(0);
    assertNoKeyMaterial(recorder.calls);
  });

  it('recovers the session-bound CSRF token when a new tab has no stored copy', async () => {
    const recorder = revocationApi();
    const storage = new MemoryStorage();
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: storage,
      platform: authenticationPlatform(undefined),
    });

    await expect(client.revokePasskey(newCredentialId)).resolves.toMatchObject({
      credentialId: newCredentialId,
      revokedAt: '2026-07-28T22:00:00.000Z',
    });
    expect(requestPaths(recorder.calls)).toEqual([
      'GET /v1/csrf',
      'POST /v1/step-up/options',
      'POST /v1/step-up/verify',
      `DELETE /v1/credentials/${newCredentialId}`,
    ]);
    expect(headerValue(recorder.calls, '/v1/step-up/options', 'x-csrf-token')).toBe(csrf);
    expect(storage.values.size).toBe(0);
  });

  it('keeps in-memory CSRF state authoritative when Web Storage is denied', async () => {
    const recorder = registrationApi();
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch: recorder.fetch,
      tokenStorage: new DeniedStorage(),
      platform: registrationPlatform(prfSecret),
      keyOperations: {
        randomBytes: () => localSeed.slice(),
        publicKeyFromSeed: () => publicKey.slice(),
        sign: () => {
          throw new Error('Registration must not sign a message.');
        },
        wrap: async () => bundleFixture(),
        unwrap: async () => {
          throw new Error('Registration must not unwrap a key.');
        },
      },
    });

    await expect(client.register()).resolves.toMatchObject({ accountId, credentialId });
    await expect(client.logout()).resolves.toBeUndefined();
  });

  it('rejects weakened WebAuthn options before prompting the platform', async () => {
    const fetch: typeof globalThis.fetch = async (input) => {
      const path = new URL(String(input)).pathname;
      if (path === '/v1/csrf') return json({ csrfToken: csrf });
      if (path === '/v1/registration/options') {
        return json({
          accountId,
          ceremonyId,
          options: {
            ...creationOptions(),
            authenticatorSelection: {
              residentKey: 'preferred',
              requireResidentKey: false,
              userVerification: 'preferred',
            },
          },
        });
      }
      return json({ error: 'unexpected request' }, 500);
    };
    const client = new BrowserAuthClient({
      baseUrl: 'https://auth.example',
      fetch,
      tokenStorage: new MemoryStorage(),
      platform: unreachablePlatform(),
    });

    await expect(client.register()).rejects.toMatchObject({ code: 'server-invalid' });
  });

  it('projects a ciphertext bundle to its exact safe wire shape', () => {
    const hostile = {
      ...bundleFixture(),
      prf: 'must-not-pass',
      seed: 'must-not-pass',
      encryptedKey: {
        ...bundleFixture().encryptedKey,
        plaintextKey: 'must-not-pass',
      },
    } as unknown as PasskeyWrappedKeyBundle;

    expect(JSON.stringify(ciphertextBundle(hostile))).not.toMatch(
      /must-not-pass|plaintextKey|"prf"|"seed"/u,
    );
  });

  it('copies and clears the JavaScript-visible PRF extension buffer', () => {
    const exposed = prfSecret.slice();
    const credential = {
      getClientExtensionResults: () => ({
        prf: { enabled: true, results: { first: exposed.buffer } },
      }),
    } as unknown as PublicKeyCredential;

    const copied = extractPrfOutput(credential);
    expect(copied).toEqual(prfSecret);
    expect(exposed.every((value) => value === 0)).toBe(true);
    copied?.fill(0);
  });
});

interface RecordedCall {
  readonly url: string;
  readonly init: RequestInit;
}

function registrationApi() {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    switch (path) {
      case '/v1/csrf':
        return json({ csrfToken: csrf });
      case '/v1/registration/options':
        return json({
          accountId,
          ceremonyId,
          options: creationOptions(),
        });
      case '/v1/registration/verify':
        return json({
          accountId,
          credential: credentialRecord(credentialId),
          csrfToken: sessionCsrf,
        });
      case '/v1/session':
        return json({
          accountId,
          session: {
            expiresAt: '2026-07-29T00:00:00.000Z',
            lastAuthenticatedAt: '2026-07-28T20:00:00.000Z',
            stepUpAt: null,
          },
        });
      case '/v1/logout':
        return new Response(null, { status: 204 });
      default:
        return json({ error: 'unexpected request' }, 500);
    }
  };
  return { calls, fetch };
}

function credentialListApi() {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (new URL(url).pathname !== '/v1/credentials') {
      return json({ error: 'unexpected request' }, 500);
    }
    return json({
      accountId,
      credentials: [
        credentialRecord(credentialId),
        credentialRecord(newCredentialId, {
          backedUp: true,
          deviceType: 'multiDevice',
          lastUsedAt: null,
          revokedAt: '2026-07-28T21:00:00.000Z',
        }),
      ],
    });
  };
  return { calls, fetch };
}

function additionalPasskeyApi() {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    switch (path) {
      case '/v1/csrf':
        return json({ csrfToken: csrf });
      case '/v1/step-up/options':
        return json({
          ceremonyId,
          options: requestOptions(),
        });
      case '/v1/step-up/verify':
        return json({
          credential: credentialRecord(credentialId),
          session: {
            expiresAt: '2026-07-29T00:00:00.000Z',
            lastAuthenticatedAt: '2026-07-28T20:00:00.000Z',
            stepUpAt: '2026-07-28T20:00:00.000Z',
          },
          csrfToken: sessionCsrf,
          stepUp: 'verified',
        });
      case '/v1/credentials/registration/options':
        return json({
          ceremonyId: `cer_${'E'.repeat(22)}`,
          options: creationOptions(),
        });
      case '/v1/key-bundles':
        return json({
          accountId,
          ciphertextOnly: true,
          bundles: [
            {
              credentialId,
              bundle: bundleFixture(),
              updatedAt: '2026-07-28T20:00:00.000Z',
            },
          ],
        });
      case '/v1/credentials/registration/verify':
        return json(
          {
            credential: credentialRecord(newCredentialId),
          },
          201,
        );
      default:
        return json({ error: 'unexpected request' }, 500);
    }
  };
  return { calls, fetch };
}

function operationSigningApi() {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    switch (path) {
      case '/v1/step-up/options':
        return json({
          ceremonyId,
          options: requestOptions(),
        });
      case '/v1/step-up/verify':
        return json({
          credential: credentialRecord(credentialId),
          session: {
            expiresAt: '2026-07-29T00:00:00.000Z',
            lastAuthenticatedAt: '2026-07-28T20:00:00.000Z',
            stepUpAt: '2026-07-28T20:00:00.000Z',
          },
          csrfToken: sessionCsrf,
          stepUp: 'verified',
        });
      case '/v1/key-bundles':
        return json({
          accountId,
          ciphertextOnly: true,
          bundles: [
            {
              credentialId,
              bundle: bundleFixture(),
              updatedAt: '2026-07-28T20:00:00.000Z',
            },
          ],
        });
      default:
        return json({ error: 'unexpected request' }, 500);
    }
  };
  return { calls, fetch };
}

function revocationApi() {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    switch (path) {
      case '/v1/csrf':
        return json({ csrfToken: csrf });
      case '/v1/step-up/options':
        return json({
          ceremonyId,
          options: requestOptions(),
        });
      case '/v1/step-up/verify':
        return json({
          credential: credentialRecord(credentialId),
          session: {
            expiresAt: '2026-07-29T00:00:00.000Z',
            lastAuthenticatedAt: '2026-07-28T20:00:00.000Z',
            stepUpAt: '2026-07-28T20:00:00.000Z',
          },
          csrfToken: sessionCsrf,
          stepUp: 'verified',
        });
      case `/v1/credentials/${newCredentialId}`:
        return json({
          credential: credentialRecord(newCredentialId, {
            revokedAt: '2026-07-28T22:00:00.000Z',
          }),
          synchronizedWrappersDeleted: true,
          sessionsRevoked: true,
          onchainDelegationRevocationRequiredSeparately: true,
        });
      default:
        return json({ error: 'unexpected request' }, 500);
    }
  };
  return { calls, fetch };
}

interface SigningBuffers {
  readonly seed: Uint8Array;
  readonly publicKeyWorking: Uint8Array;
  readonly signatureWorking: Uint8Array;
  prfOutput?: Uint8Array;
  messageWorking?: Uint8Array;
  messageSnapshot?: Uint8Array;
  signingSeed?: Uint8Array;
  signCalls: number;
}

function signingKeyHarness(
  options: {
    readonly unwrapError?: Error;
    readonly publicKeyWorking?: Uint8Array;
  } = {},
): {
  readonly operations: LocalKeyOperations;
  readonly buffers: SigningBuffers;
} {
  const buffers: SigningBuffers = {
    seed: localSeed.slice(),
    publicKeyWorking: options.publicKeyWorking ?? publicKey.slice(),
    signatureWorking: bytes(157, 64),
    signCalls: 0,
  };
  return {
    buffers,
    operations: {
      randomBytes: () => {
        throw new Error('Operation signing must not create a replacement key.');
      },
      publicKeyFromSeed: (seed) => {
        expect(seed).toBe(buffers.seed);
        return buffers.publicKeyWorking;
      },
      sign: (message, seed) => {
        buffers.signCalls += 1;
        buffers.messageWorking = message;
        buffers.messageSnapshot = message.slice();
        buffers.signingSeed = seed;
        return buffers.signatureWorking;
      },
      wrap: async () => {
        throw new Error('Operation signing must not wrap a key.');
      },
      unwrap: async (input) => {
        buffers.prfOutput = input.prfOutput;
        if (options.unwrapError !== undefined) throw options.unwrapError;
        expect(input.credentialId).toEqual(credentialBytes);
        return buffers.seed;
      },
    },
  };
}

function authenticationApi() {
  const calls: RecordedCall[] = [];
  const fetch: typeof globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const path = new URL(url).pathname;
    switch (path) {
      case '/v1/csrf':
        return json({ csrfToken: csrf });
      case '/v1/authentication/options':
        return json({
          ceremonyId,
          options: requestOptions(),
        });
      case '/v1/authentication/verify':
        return json({
          accountId,
          credential: credentialRecord(credentialId),
          csrfToken: sessionCsrf,
        });
      case '/v1/key-bundles':
        return json({
          accountId,
          ciphertextOnly: true,
          bundles: [
            {
              credentialId,
              bundle: bundleFixture(),
              updatedAt: '2026-07-28T20:00:00.000Z',
            },
          ],
        });
      default:
        return json({ error: 'unexpected request' }, 500);
    }
  };
  return { calls, fetch };
}

function registrationPlatform(prf: Uint8Array | undefined): PasskeyPlatform {
  return {
    parseCreationOptions: (options) => options as unknown as PublicKeyCredentialCreationOptions,
    parseRequestOptions: () => {
      throw new Error('Registration must not parse request options.');
    },
    create: async () => registrationCredential(prf),
    get: async () => {
      throw new Error('Registration must not request an assertion.');
    },
  };
}

function authenticationPlatform(prf: Uint8Array | undefined): PasskeyPlatform {
  return {
    parseCreationOptions: () => {
      throw new Error('Authentication must not parse creation options.');
    },
    parseRequestOptions: (options) => options as unknown as PublicKeyCredentialRequestOptions,
    create: async () => {
      throw new Error('Authentication must not create a credential.');
    },
    get: async () => authenticationCredential(prf),
  };
}

function credentialLifecyclePlatform(): PasskeyPlatform {
  return {
    parseCreationOptions: (options) => options as unknown as PublicKeyCredentialCreationOptions,
    parseRequestOptions: (options) => options as unknown as PublicKeyCredentialRequestOptions,
    create: async () => registrationCredential(newPrfSecret, newCredentialId, newCredentialBytes),
    get: async () => authenticationCredential(prfSecret),
  };
}

function unreachablePlatform(): PasskeyPlatform {
  return {
    parseCreationOptions: () => {
      throw new Error('Credential listing must not parse creation options.');
    },
    parseRequestOptions: () => {
      throw new Error('Credential listing must not parse request options.');
    },
    create: async () => {
      throw new Error('Credential listing must not create a passkey.');
    },
    get: async () => {
      throw new Error('Credential listing must not request an assertion.');
    },
  };
}

function registrationCredential(
  prf: Uint8Array | undefined,
  id = credentialId,
  rawId = credentialBytes,
): PublicKeyCredential {
  return {
    id,
    rawId: rawId.slice().buffer,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: bytes(1, 16).buffer,
      attestationObject: bytes(21, 32).buffer,
      getTransports: () => ['internal'],
    },
    getClientExtensionResults: () =>
      prf === undefined
        ? { prf: { enabled: false } }
        : { prf: { enabled: true, results: { first: prf.slice().buffer } } },
  } as unknown as PublicKeyCredential;
}

function authenticationCredential(
  prf: Uint8Array | undefined,
  id = credentialId,
  rawId = credentialBytes,
): PublicKeyCredential {
  return {
    id,
    rawId: rawId.slice().buffer,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: bytes(1, 16).buffer,
      authenticatorData: bytes(21, 37).buffer,
      signature: bytes(61, 64).buffer,
      userHandle: bytes(131, 32).buffer,
    },
    getClientExtensionResults: () =>
      prf === undefined
        ? { prf: { enabled: false } }
        : { prf: { enabled: true, results: { first: prf.slice().buffer } } },
  } as unknown as PublicKeyCredential;
}

function creationOptions(): PublicKeyCredentialCreationOptionsJSON {
  return {
    challenge: encodeBase64Url(bytes(1, 32)),
    rp: { id: 'example', name: 'WokeSocial Test' },
    user: {
      id: encodeBase64Url(bytes(41, 32)),
      name: accountId,
      displayName: 'WokeSocial account',
    },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    timeout: 60_000,
    excludeCredentials: [],
    authenticatorSelection: {
      residentKey: 'required',
      requireResidentKey: true,
      userVerification: 'required',
    },
    attestation: 'none',
  };
}

function requestOptions(): PublicKeyCredentialRequestOptionsJSON {
  return {
    challenge: encodeBase64Url(bytes(1, 32)),
    rpId: 'example',
    allowCredentials: [],
    userVerification: 'required',
    timeout: 60_000,
  };
}

function bundleFixture(): PasskeyWrappedKeyBundle {
  return {
    version: 1,
    kdf: 'HKDF-SHA-256',
    algorithm: 'A256GCM',
    credentialBinding: encodeBase64Url(bytes(1, 32)),
    keyKind: 'solana-ed25519-root-seed',
    publicKey: encodeBase64Url(publicKey),
    salt: encodeBase64Url(bytes(41, 32)),
    encryptedKey: {
      version: 1,
      algorithm: 'A256GCM',
      domain: 'wokesocial/auth/account-key-bundle',
      nonce: encodeBase64Url(bytes(81, 12)),
      ciphertext: encodeBase64Url(bytes(101, 48)),
    },
  };
}

interface CredentialRecord {
  readonly credentialId: string;
  readonly transports: readonly string[];
  readonly deviceType: 'multiDevice' | 'singleDevice';
  readonly backedUp: boolean;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
}

function credentialRecord(
  id: string,
  overrides: Partial<Omit<CredentialRecord, 'credentialId'>> = {},
): CredentialRecord {
  return {
    credentialId: id,
    transports: ['internal'],
    deviceType: 'singleDevice',
    backedUp: false,
    createdAt: '2026-07-28T19:00:00.000Z',
    lastUsedAt: '2026-07-28T20:00:00.000Z',
    revokedAt: null,
    ...overrides,
  };
}

function credentialView(
  id: string,
  overrides: Partial<Omit<CredentialRecord, 'credentialId'>> = {},
): Record<string, unknown> {
  const record = credentialRecord(id, overrides);
  return {
    credentialId: record.credentialId,
    transports: record.transports,
    deviceType: record.deviceType,
    backedUp: record.backedUp,
    createdAt: record.createdAt,
    ...(record.lastUsedAt === null ? {} : { lastUsedAt: record.lastUsedAt }),
    ...(record.revokedAt === null ? {} : { revokedAt: record.revokedAt }),
  };
}

class MemoryStorage implements TokenStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class DeniedStorage implements TokenStorage {
  getItem(): string | null {
    throw new DOMException('Storage access is denied.', 'SecurityError');
  }

  setItem(): void {
    throw new DOMException('Storage access is denied.', 'SecurityError');
  }

  removeItem(): void {
    throw new DOMException('Storage access is denied.', 'SecurityError');
  }
}

function authenticatedStorage(): MemoryStorage {
  const storage = new MemoryStorage();
  storage.setItem(`wokesocial.auth.csrf.v1:${encodeURIComponent('https://auth.example/')}`, csrf);
  return storage;
}

function assertNoKeyMaterial(calls: readonly RecordedCall[]): void {
  const serialized = calls
    .map((call) => (typeof call.init.body === 'string' ? call.init.body : ''))
    .join('\n');
  expect(serialized).not.toContain(encodeBase64Url(prfSecret));
  expect(serialized).not.toContain(encodeBase64Url(newPrfSecret));
  expect(serialized).not.toContain(encodeBase64Url(localSeed));
  expect(serialized).not.toMatch(/prfOutput|accountKeySeed|privateKey|"prf"|"seed"/u);
  for (const call of calls) {
    expect(call.init.credentials).toBe('include');
  }
}

function requestPaths(calls: readonly RecordedCall[]): string[] {
  return calls.map((call) => {
    const path = new URL(call.url).pathname;
    return `${call.init.method ?? 'GET'} ${path}`;
  });
}

function headerValue(
  calls: readonly RecordedCall[],
  suffix: string,
  header: string,
): string | null {
  const call = calls.find((candidate) => candidate.url.endsWith(suffix));
  if (call === undefined) throw new Error(`Missing request for ${suffix}.`);
  return new Headers(call.init.headers).get(header);
}

function requestBody(calls: readonly RecordedCall[], suffix: string): Record<string, unknown> {
  const call = calls.find((candidate) => candidate.url.endsWith(suffix));
  if (call === undefined || typeof call.init.body !== 'string') {
    throw new Error(`Missing request body for ${suffix}.`);
  }
  return objectValue(JSON.parse(call.init.body) as unknown);
}

function objectValue(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected an object.');
  }
  return value as Record<string, unknown>;
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status });
}

function bytes(start: number, length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
}
