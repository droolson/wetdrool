import { describe, expect, it } from 'vitest';

import type { PasskeyWrappedKeyBundle, UnwrapPasskeyAccountKeyInput } from '@socially-woke/crypto';

import {
  BrowserAuthClient,
  type LocalKeyOperations,
  type PasskeyPlatform,
} from '../lib/auth/browser-auth-client';
import { ciphertextBundle, type TokenStorage } from '../lib/auth/auth-api';
import { encodeBase64Url } from '../lib/auth/passkey-codec';

const accountId = `acct_${'A'.repeat(22)}`;
const ceremonyId = `cer_${'B'.repeat(22)}`;
const csrf = 'C'.repeat(43);
const sessionCsrf = 'D'.repeat(43);
const credentialBytes = bytes(31, 32);
const credentialId = encodeBase64Url(credentialBytes);
const prfSecret = bytes(71, 32);
const localSeed = bytes(111, 32);
const publicKey = bytes(151, 32);

describe('browser passkey authentication boundary', () => {
  it('rejects the legacy redirect host as an authentication-service origin', () => {
    expect(
      () =>
        new BrowserAuthClient({
          baseUrl: 'https://sociallywoke.com',
          tokenStorage: new MemoryStorage(),
        }),
    ).toThrow('not a permitted secure origin');
  });

  it('registers and synchronizes only ciphertext while clearing client key buffers', async () => {
    const recorder = registrationApi();
    const storage = new MemoryStorage();
    const platform = registrationPlatform(prfSecret);
    let wrappedPrf: Uint8Array | undefined;
    let wrappedSeed: Uint8Array | undefined;
    const operations: LocalKeyOperations = {
      randomBytes: () => localSeed.slice(),
      publicKeyFromSeed: () => publicKey.slice(),
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
    const synchronized = requestBody(recorder.calls, `/v1/key-bundles/${credentialId}`);
    expect(Object.keys(objectValue(synchronized))).toEqual(['bundle']);
    expect(Object.keys(objectValue(objectValue(synchronized)['bundle'])).sort()).toEqual([
      'algorithm',
      'credentialBinding',
      'encryptedKey',
      'kdf',
      'keyKind',
      'publicKey',
      'salt',
      'version',
    ]);
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

  it('fails closed to explicit noncustodial fallbacks when PRF is unsupported', async () => {
    const recorder = registrationApi();
    const operations: LocalKeyOperations = {
      randomBytes: () => {
        throw new Error('A key must not be generated without PRF.');
      },
      publicKeyFromSeed: () => {
        throw new Error('A public key must not be derived without PRF.');
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

    await expect(client.register()).resolves.toMatchObject({
      accountId,
      credentialId,
      protocolIdentityEstablished: false,
      key: {
        status: 'fallback-required',
        reason: 'prf-unsupported',
        safeFallbacks: ['external-wallet', 'reviewed-encrypted-recovery-kit'],
      },
    });
    expect(recorder.calls.some((call) => call.url.includes('/v1/key-bundles/'))).toBe(false);
    assertNoKeyMaterial(recorder.calls);
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
          credential: { credentialId },
          csrfToken: sessionCsrf,
        });
      case `/v1/key-bundles/${credentialId}`:
        return json({
          credentialId,
          keyKind: 'solana-ed25519-root-seed',
          publicKey: encodeBase64Url(publicKey),
          ciphertextOnly: true,
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
          credential: { credentialId },
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

function authenticationPlatform(prf: Uint8Array): PasskeyPlatform {
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

function registrationCredential(prf: Uint8Array | undefined): PublicKeyCredential {
  return {
    id: credentialId,
    rawId: credentialBytes.slice().buffer,
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

function authenticationCredential(prf: Uint8Array): PublicKeyCredential {
  return {
    id: credentialId,
    rawId: credentialBytes.slice().buffer,
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: bytes(1, 16).buffer,
      authenticatorData: bytes(21, 37).buffer,
      signature: bytes(61, 64).buffer,
      userHandle: bytes(131, 32).buffer,
    },
    getClientExtensionResults: () => ({
      prf: { enabled: true, results: { first: prf.slice().buffer } },
    }),
  } as unknown as PublicKeyCredential;
}

function creationOptions(): PublicKeyCredentialCreationOptionsJSON {
  return {
    challenge: encodeBase64Url(bytes(1, 32)),
    rp: { id: 'example', name: 'Socially Woke Test' },
    user: {
      id: encodeBase64Url(bytes(41, 32)),
      name: accountId,
      displayName: 'Socially Woke account',
    },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
  };
}

function requestOptions(): PublicKeyCredentialRequestOptionsJSON {
  return {
    challenge: encodeBase64Url(bytes(1, 32)),
    rpId: 'example',
    allowCredentials: [],
    userVerification: 'required',
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
      domain: 'socially-woke/auth/account-key-bundle',
      nonce: encodeBase64Url(bytes(81, 12)),
      ciphertext: encodeBase64Url(bytes(101, 48)),
    },
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

function assertNoKeyMaterial(calls: readonly RecordedCall[]): void {
  const serialized = calls
    .map((call) => (typeof call.init.body === 'string' ? call.init.body : ''))
    .join('\n');
  expect(serialized).not.toContain(encodeBase64Url(prfSecret));
  expect(serialized).not.toContain(encodeBase64Url(localSeed));
  expect(serialized).not.toMatch(/prfOutput|accountKeySeed|privateKey|"prf"|"seed"/u);
  for (const call of calls) {
    expect(call.init.credentials).toBe('include');
  }
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
