import { CryptoInputError, CryptoOperationError } from './errors.js';
import { hkdfSha256 } from './hkdf.js';
import { sha256 } from './hash.js';
import { decodeBase64Url, encodeBase64Url, frameDomain, requireBytes } from './internal.js';
import { type SealedEnvelope, openAes256Gcm, sealAes256Gcm } from './sealed-envelope.js';
import { secureRandomBytes } from './random.js';

const CREDENTIAL_BINDING_DOMAIN = 'wokesocial/auth/passkey-credential-binding';
const KEY_DERIVATION_DOMAIN = 'wokesocial/auth/passkey-key-wrap';
const KEY_ENVELOPE_DOMAIN = 'wokesocial/auth/account-key-bundle';
const encoder = new TextEncoder();

export type PasskeyAccountKeyKind = 'solana-ed25519-root-seed' | 'solana-ed25519-delegation-seed';

export interface PasskeyWrappedKeyBundle {
  readonly version: 1;
  readonly kdf: 'HKDF-SHA-256';
  readonly algorithm: 'A256GCM';
  /**
   * A domain-separated digest of the credential ID. The raw credential ID is
   * deliberately not duplicated in this portable ciphertext record.
   */
  readonly credentialBinding: string;
  readonly keyKind: PasskeyAccountKeyKind;
  readonly publicKey: string;
  readonly salt: string;
  readonly encryptedKey: SealedEnvelope;
}

export interface WrapPasskeyAccountKeyInput {
  /** The 32-byte output of the WebAuthn PRF extension. */
  readonly prfOutput: Uint8Array;
  /** The credential ID returned by a verified WebAuthn registration. */
  readonly credentialId: Uint8Array;
  /** A locally generated Ed25519 seed. This function never generates custody keys. */
  readonly accountKeySeed: Uint8Array;
  /** The public key corresponding to accountKeySeed. */
  readonly publicKey: Uint8Array;
  readonly keyKind: PasskeyAccountKeyKind;
  /** Optional deterministic salt for conformance vectors only. */
  readonly salt?: Uint8Array;
  /** Optional deterministic AES-GCM nonce for conformance vectors only. */
  readonly nonce?: Uint8Array;
}

export interface UnwrapPasskeyAccountKeyInput {
  /** The 32-byte output of the same WebAuthn credential's PRF extension. */
  readonly prfOutput: Uint8Array;
  readonly credentialId: Uint8Array;
  readonly bundle: unknown;
}

/**
 * Wraps a locally generated Ed25519 seed with a key derived from a WebAuthn PRF
 * output. WebAuthn assertions authenticate a user but cannot directly sign
 * WokeNet's Solana-compatible transactions, so the two key roles remain
 * explicit and separate.
 *
 * The returned object may be stored by an untrusted synchronization provider:
 * the credential-scoped PRF output is never included. Callers remain
 * responsible for clearing their account seed and PRF buffers when practical.
 */
export async function wrapPasskeyAccountKey(
  input: WrapPasskeyAccountKeyInput,
): Promise<PasskeyWrappedKeyBundle> {
  const prfOutput = requireBytes(input.prfOutput, 'prfOutput', { exact: 32 });
  const credentialId = requireCredentialId(input.credentialId);
  const accountKeySeed = requireBytes(input.accountKeySeed, 'accountKeySeed', {
    exact: 32,
  });
  const publicKey = requireBytes(input.publicKey, 'publicKey', { exact: 32 });
  const keyKind = requireKeyKind(input.keyKind);
  const salt = requireBytes(input.salt ?? secureRandomBytes(32), 'salt', { exact: 32 });
  const nonce =
    input.nonce === undefined ? undefined : requireBytes(input.nonce, 'nonce', { exact: 12 });
  const credentialBinding = await bindCredential(credentialId);
  const context = bundleContext(credentialBinding, keyKind, publicKey);
  const wrappingKey = await deriveWrappingKey(prfOutput, salt, context);

  try {
    const encryptedKey = await sealAes256Gcm({
      key: wrappingKey,
      plaintext: accountKeySeed,
      domain: KEY_ENVELOPE_DOMAIN,
      context,
      ...(nonce === undefined ? {} : { nonce }),
    });
    return {
      version: 1,
      kdf: 'HKDF-SHA-256',
      algorithm: 'A256GCM',
      credentialBinding: encodeBase64Url(credentialBinding),
      keyKind,
      publicKey: encodeBase64Url(publicKey),
      salt: encodeBase64Url(salt),
      encryptedKey,
    };
  } finally {
    wrappingKey.fill(0);
  }
}

/**
 * Opens a passkey-wrapped Ed25519 seed after rebinding the ciphertext to the
 * supplied credential ID, key purpose, and public key.
 */
export async function unwrapPasskeyAccountKey(
  input: UnwrapPasskeyAccountKeyInput,
): Promise<Uint8Array> {
  const prfOutput = requireBytes(input.prfOutput, 'prfOutput', { exact: 32 });
  const credentialId = requireCredentialId(input.credentialId);
  const parsed = parseBundle(input.bundle);
  const expectedBinding = await bindCredential(credentialId);

  if (!equalBytes(parsed.credentialBinding, expectedBinding)) {
    throw new CryptoOperationError('Unable to open passkey key bundle.');
  }

  const context = bundleContext(parsed.credentialBinding, parsed.bundle.keyKind, parsed.publicKey);
  const wrappingKey = await deriveWrappingKey(prfOutput, parsed.salt, context);

  try {
    const accountKeySeed = await openAes256Gcm({
      key: wrappingKey,
      envelope: parsed.bundle.encryptedKey,
      context,
    });
    if (accountKeySeed.byteLength !== 32) {
      accountKeySeed.fill(0);
      throw new CryptoOperationError('Unable to open passkey key bundle.');
    }
    return accountKeySeed;
  } catch (error) {
    if (error instanceof CryptoInputError) {
      throw error;
    }
    throw new CryptoOperationError('Unable to open passkey key bundle.');
  } finally {
    wrappingKey.fill(0);
  }
}

function parseBundle(input: unknown): {
  readonly bundle: PasskeyWrappedKeyBundle;
  readonly credentialBinding: Uint8Array;
  readonly publicKey: Uint8Array;
  readonly salt: Uint8Array;
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new CryptoInputError('bundle must be an object.');
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [
    'algorithm',
    'credentialBinding',
    'encryptedKey',
    'kdf',
    'keyKind',
    'publicKey',
    'salt',
    'version',
  ];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new CryptoInputError('bundle contains missing or unsupported fields.');
  }
  if (record.version !== 1 || record.kdf !== 'HKDF-SHA-256' || record.algorithm !== 'A256GCM') {
    throw new CryptoInputError('bundle version or algorithms are unsupported.');
  }

  const keyKind = requireKeyKind(record.keyKind);
  const credentialBinding = decodeBase64Url(record.credentialBinding, 'bundle.credentialBinding', {
    exact: 32,
  });
  const publicKey = decodeBase64Url(record.publicKey, 'bundle.publicKey', {
    exact: 32,
  });
  const salt = decodeBase64Url(record.salt, 'bundle.salt', { exact: 32 });

  return {
    bundle: {
      version: 1,
      kdf: 'HKDF-SHA-256',
      algorithm: 'A256GCM',
      credentialBinding: record.credentialBinding as string,
      keyKind,
      publicKey: record.publicKey as string,
      salt: record.salt as string,
      encryptedKey: record.encryptedKey as SealedEnvelope,
    },
    credentialBinding,
    publicKey,
    salt,
  };
}

function requireCredentialId(value: unknown): Uint8Array {
  return requireBytes(value, 'credentialId', { minimum: 1, maximum: 1_023 });
}

function requireKeyKind(value: unknown): PasskeyAccountKeyKind {
  if (value !== 'solana-ed25519-root-seed' && value !== 'solana-ed25519-delegation-seed') {
    throw new CryptoInputError('keyKind is unsupported.');
  }
  return value;
}

async function bindCredential(credentialId: Uint8Array): Promise<Uint8Array> {
  return sha256({
    domain: CREDENTIAL_BINDING_DOMAIN,
    data: credentialId,
  });
}

function bundleContext(
  credentialBinding: Uint8Array,
  keyKind: PasskeyAccountKeyKind,
  publicKey: Uint8Array,
): Uint8Array {
  return frameDomain('passkey-key-bundle', KEY_ENVELOPE_DOMAIN, [
    credentialBinding,
    encoder.encode(keyKind),
    publicKey,
  ]);
}

function deriveWrappingKey(
  prfOutput: Uint8Array,
  salt: Uint8Array,
  context: Uint8Array,
): Promise<Uint8Array> {
  return hkdfSha256({
    inputKeyMaterial: prfOutput,
    salt,
    domain: KEY_DERIVATION_DOMAIN,
    context,
    length: 32,
  });
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}
