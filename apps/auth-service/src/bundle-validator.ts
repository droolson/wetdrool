import {
  CryptoInputError,
  CryptoOperationError,
  openAes256Gcm,
  secureRandomBytes,
  sha256,
  unwrapPasskeyAccountKey,
  type PasskeyWrappedKeyBundle,
} from '@wetdrool/crypto';
import { z } from 'zod';

import { AuthServiceError } from './errors.js';
import { decodeBase64Url, encodeBase64Url } from './security.js';

const CREDENTIAL_BINDING_DOMAIN = 'wetdrool/auth/passkey-credential-binding';
const base64url32Schema = z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
const envelopeSchema = z
  .object({
    version: z.literal(1),
    algorithm: z.literal('A256GCM'),
    domain: z.literal('wetdrool/auth/account-key-bundle'),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
    ciphertext: z.string().regex(/^[A-Za-z0-9_-]{64}$/u),
  })
  .strict();
const bundleSchema = z
  .object({
    version: z.literal(1),
    kdf: z.literal('HKDF-SHA-256'),
    algorithm: z.literal('A256GCM'),
    credentialBinding: base64url32Schema,
    keyKind: z.enum(['solana-ed25519-root-seed', 'solana-ed25519-delegation-seed']),
    publicKey: base64url32Schema,
    salt: base64url32Schema,
    encryptedKey: envelopeSchema,
  })
  .strict();

export async function validateKeyBundle(
  input: unknown,
  credentialId: string,
): Promise<PasskeyWrappedKeyBundle> {
  const parsed = bundleSchema.safeParse(input);
  const credentialBytes = decodeBase64Url(credentialId, 1_023);
  if (!parsed.success || credentialBytes === undefined) {
    throw invalidBundle();
  }

  const binding = await sha256({
    domain: CREDENTIAL_BINDING_DOMAIN,
    data: credentialBytes,
  });
  if (parsed.data.credentialBinding !== encodeBase64Url(binding)) {
    throw invalidBundle();
  }

  // @wetdrool/crypto intentionally exposes no parse-only helper. Invoke its
  // exact bundle parser with a different credential binding so it exits before
  // key derivation or decryption; no client PRF value or plaintext key enters here.
  try {
    await unwrapPasskeyAccountKey({
      prfOutput: secureRandomBytes(32),
      credentialId: differentCredentialId(credentialBytes),
      bundle: parsed.data,
    });
    throw invalidBundle();
  } catch (error) {
    if (error instanceof CryptoInputError) throw invalidBundle(error);
    if (!(error instanceof CryptoOperationError)) throw error;
  }

  // Validate the nested sealed-envelope parser with a fresh unknowable key.
  // Authentication must fail; a structurally malformed envelope fails earlier
  // as CryptoInputError. Any unexpected successful open is wiped and rejected.
  try {
    const unexpected = await openAes256Gcm({
      key: secureRandomBytes(32),
      envelope: parsed.data.encryptedKey,
    });
    unexpected.fill(0);
    throw invalidBundle();
  } catch (error) {
    if (error instanceof CryptoInputError) throw invalidBundle(error);
    if (!(error instanceof CryptoOperationError)) throw error;
  }

  return parsed.data;
}

function differentCredentialId(value: Uint8Array): Uint8Array {
  const result = value.slice();
  result[0] = (result[0] ?? 0) ^ 0xff;
  return result;
}

function invalidBundle(cause?: unknown): AuthServiceError {
  return new AuthServiceError(
    'Encrypted key bundle is malformed or not bound to this credential.',
    'bundle-invalid',
    cause === undefined ? undefined : { cause },
  );
}
