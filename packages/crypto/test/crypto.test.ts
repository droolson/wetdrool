import { describe, expect, it } from 'vitest';

import {
  CryptoInputError,
  CryptoOperationError,
  createPasskeyPrfEvaluationInput,
  hkdfSha256,
  openAes256Gcm,
  sealAes256Gcm,
  secureRandomBytes,
  secureRandomId,
  sha256,
  unwrapPasskeyAccountKey,
  wrapPasskeyAccountKey,
} from '../src/index.js';

const bytes = (start: number, length: number) =>
  Uint8Array.from({ length }, (_, index) => (start + index) & 0xff);
const hex = (value: Uint8Array) =>
  Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');

describe('secure randomness', () => {
  it('returns fresh random bytes and opaque IDs with at least 128 bits of entropy', () => {
    const first = secureRandomBytes(32);
    const second = secureRandomBytes(32);
    const identifiers = new Set(Array.from({ length: 16 }, () => secureRandomId()));

    expect(first).toHaveLength(32);
    expect(second).toHaveLength(32);
    expect(first).not.toEqual(second);
    expect(identifiers.size).toBe(16);
    expect([...identifiers][0]).toMatch(/^wokesocial_[A-Za-z0-9_-]{22}$/u);
  });

  it('rejects unsafe lengths and ambiguous prefixes', () => {
    expect(() => secureRandomBytes(0)).toThrow(CryptoInputError);
    expect(() => secureRandomBytes(65_537)).toThrow(CryptoInputError);
    expect(() => secureRandomId({ bytes: 15 })).toThrow(CryptoInputError);
    expect(() => secureRandomId({ prefix: 'Messaging Key' })).toThrow(CryptoInputError);
  });
});

describe('domain-separated SHA-256 and HKDF-SHA-256', () => {
  it('matches a stable framed SHA-256 vector and separates domains', async () => {
    const data = new TextEncoder().encode('portable social data');
    const digest = await sha256({
      domain: 'wokesocial/protocol/content-reference',
      data,
    });
    const other = await sha256({
      domain: 'wokesocial/messaging/content-reference',
      data,
    });

    expect(hex(digest)).toBe('b9ab8e1299d1e85fd4bbb91526e4d243e2ce9d0ca907eb382f84ddfea0b01d86');
    expect(other).not.toEqual(digest);
  });

  it('matches a stable HKDF vector and binds public context', async () => {
    const input = {
      inputKeyMaterial: bytes(1, 32),
      salt: bytes(101, 32),
      domain: 'wokesocial/messaging/conversation-key',
      context: new TextEncoder().encode('conversation:fixture-1:key-version:3'),
      length: 32,
    } as const;
    const derived = await hkdfSha256(input);
    const otherContext = await hkdfSha256({
      ...input,
      context: new TextEncoder().encode('conversation:fixture-2:key-version:3'),
    });

    expect(hex(derived)).toBe('1e9ed230ba2677d026c09610b25b1c70070fb1297b1181bf508d45f3799ed03f');
    expect(otherContext).not.toEqual(derived);
  });

  it('requires explicit, well-formed domains and strong HKDF inputs', async () => {
    await expect(sha256({ domain: 'Upper Case', data: new Uint8Array() })).rejects.toThrow(
      CryptoInputError,
    );
    await expect(
      hkdfSha256({
        inputKeyMaterial: bytes(0, 15),
        salt: bytes(0, 16),
        domain: 'wokesocial/test/key',
        length: 32,
      }),
    ).rejects.toThrow(CryptoInputError);
  });
});

describe('AES-256-GCM sealed envelopes', () => {
  const key = bytes(1, 32);
  const nonce = bytes(201, 12);
  const plaintext = new TextEncoder().encode('Only the intended conversation can open this.');
  const context = new TextEncoder().encode('conversation:fixture-1:message:42');
  const domain = 'wokesocial/messaging/message';

  it('matches a stable vector and round-trips authenticated plaintext', async () => {
    const envelope = await sealAes256Gcm({ key, nonce, plaintext, context, domain });

    expect(envelope).toEqual({
      version: 1,
      algorithm: 'A256GCM',
      domain,
      nonce: 'ycrLzM3Oz9DR0tPU',
      ciphertext:
        '7lYAR4fK3uMx5D2hv__s8YDjUJdgfPdpoRpxSqmJ4gjKFbFlEev_Ofx9xL-0myGnzoSO3xfsdroLanZGIg',
    });
    await expect(openAes256Gcm({ key, envelope, context })).resolves.toEqual(plaintext);
  });

  it('rejects tampering, wrong context, wrong keys, and unknown fields uniformly', async () => {
    const envelope = await sealAes256Gcm({ key, nonce, plaintext, context, domain });
    const ciphertext =
      (envelope.ciphertext.startsWith('A') ? 'B' : 'A') + envelope.ciphertext.slice(1);

    await expect(
      openAes256Gcm({ key, envelope: { ...envelope, ciphertext }, context }),
    ).rejects.toThrow(CryptoOperationError);
    await expect(
      openAes256Gcm({
        key,
        envelope,
        context: new TextEncoder().encode('conversation:other'),
      }),
    ).rejects.toThrow(CryptoOperationError);
    await expect(openAes256Gcm({ key: bytes(2, 32), envelope, context })).rejects.toThrow(
      CryptoOperationError,
    );
    await expect(
      openAes256Gcm({ key, envelope: { ...envelope, ignored: true }, context }),
    ).rejects.toThrow(CryptoInputError);
  });

  it('validates key and nonce sizes before invoking WebCrypto', async () => {
    await expect(
      sealAes256Gcm({ key: bytes(0, 31), nonce, plaintext, context, domain }),
    ).rejects.toThrow(CryptoInputError);
    await expect(
      sealAes256Gcm({ key, nonce: bytes(0, 11), plaintext, context, domain }),
    ).rejects.toThrow(CryptoInputError);
  });
});

describe('passkey PRF account-key wrapping', () => {
  const prfOutput = bytes(1, 32);
  const credentialId = bytes(51, 64);
  const accountKeySeed = bytes(101, 32);
  const publicKey = bytes(151, 32);
  const salt = bytes(201, 32);
  const nonce = bytes(17, 12);

  it('round-trips a root key and emits a stable, credential-bound vector', async () => {
    const bundle = await wrapPasskeyAccountKey({
      prfOutput,
      credentialId,
      accountKeySeed,
      publicKey,
      keyKind: 'solana-ed25519-root-seed',
      salt,
      nonce,
    });

    expect(bundle).toEqual({
      version: 1,
      kdf: 'HKDF-SHA-256',
      algorithm: 'A256GCM',
      credentialBinding: 'tYvkHBe9wWcRS-TOhNHgvrdWgtKJEbY2UAk5ti7oZmM', // gitleaks:allow -- deterministic public SHA-256 binding vector, not a credential.
      keyKind: 'solana-ed25519-root-seed',
      publicKey: 'l5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tbY',
      salt: 'ycrLzM3Oz9DR0tPU1dbX2Nna29zd3t_g4eLj5OXm5-g',
      encryptedKey: {
        version: 1,
        algorithm: 'A256GCM',
        domain: 'wokesocial/auth/account-key-bundle',
        nonce: 'ERITFBUWFxgZGhsc',
        ciphertext: 'iVMEfep3Pck1Wy_0U0TV6JSr8hsfYaewDl9vv0gvwARcBTWg0r4tnPL56Yp8L2ym',
      },
    });
    await expect(unwrapPasskeyAccountKey({ prfOutput, credentialId, bundle })).resolves.toEqual(
      accountKeySeed,
    );
  });

  it('rejects a different credential, PRF output, public-key binding, or purpose', async () => {
    const bundle = await wrapPasskeyAccountKey({
      prfOutput,
      credentialId,
      accountKeySeed,
      publicKey,
      keyKind: 'solana-ed25519-delegation-seed',
      salt,
      nonce,
    });

    await expect(
      unwrapPasskeyAccountKey({
        prfOutput,
        credentialId: bytes(52, 64),
        bundle,
      }),
    ).rejects.toThrow(CryptoOperationError);
    await expect(
      unwrapPasskeyAccountKey({
        prfOutput: bytes(2, 32),
        credentialId,
        bundle,
      }),
    ).rejects.toThrow(CryptoOperationError);
    await expect(
      unwrapPasskeyAccountKey({
        prfOutput,
        credentialId,
        bundle: { ...bundle, publicKey: 'm5iZmpucnZ6foKGio6SlpqeoqaqrrK2ur7CxsrO0tbY' },
      }),
    ).rejects.toThrow(CryptoOperationError);
    await expect(
      unwrapPasskeyAccountKey({
        prfOutput,
        credentialId,
        bundle: { ...bundle, keyKind: 'solana-ed25519-root-seed' },
      }),
    ).rejects.toThrow(CryptoOperationError);
  });

  it('rejects malformed bundles, unsupported fields, and wrong input sizes', async () => {
    const bundle = await wrapPasskeyAccountKey({
      prfOutput,
      credentialId,
      accountKeySeed,
      publicKey,
      keyKind: 'solana-ed25519-root-seed',
      salt,
      nonce,
    });

    await expect(
      unwrapPasskeyAccountKey({
        prfOutput,
        credentialId,
        bundle: { ...bundle, ignored: true },
      }),
    ).rejects.toThrow(CryptoInputError);
    await expect(
      wrapPasskeyAccountKey({
        prfOutput: bytes(0, 31),
        credentialId,
        accountKeySeed,
        publicKey,
        keyKind: 'solana-ed25519-root-seed',
      }),
    ).rejects.toThrow(CryptoInputError);
    await expect(
      wrapPasskeyAccountKey({
        prfOutput,
        credentialId: new Uint8Array(),
        accountKeySeed,
        publicKey,
        keyKind: 'solana-ed25519-root-seed',
      }),
    ).rejects.toThrow(CryptoInputError);
    await expect(
      wrapPasskeyAccountKey({
        prfOutput,
        credentialId,
        accountKeySeed: bytes(0, 64),
        publicKey,
        keyKind: 'solana-ed25519-root-seed',
      }),
    ).rejects.toThrow(CryptoInputError);
  });
});

describe('versioned passkey PRF evaluation input', () => {
  it('returns a fresh copy of one stable public v1 input', async () => {
    const first = await createPasskeyPrfEvaluationInput();
    const second = await createPasskeyPrfEvaluationInput();

    expect(first.version).toBe(1);
    expect(first.first).toHaveLength(32);
    expect(hex(first.first)).toBe(
      '6c58052fb7378ef76ade99101ebd9cee5c0553c91281243ae238ae1b27813e05',
    );
    expect(second).toEqual(first);
    expect(second.first).not.toBe(first.first);
  });
});
