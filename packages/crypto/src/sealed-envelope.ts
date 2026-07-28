import { CryptoInputError, CryptoOperationError } from './errors.js';
import {
  decodeBase64Url,
  encodeBase64Url,
  frameDomain,
  getWebCrypto,
  MAX_CONTEXT_BYTES,
  MAX_ENVELOPE_PLAINTEXT_BYTES,
  requireBytes,
  requireDomain,
  toArrayBuffer,
} from './internal.js';
import { secureRandomBytes } from './random.js';

export interface SealedEnvelope {
  readonly version: 1;
  readonly algorithm: 'A256GCM';
  readonly domain: string;
  readonly nonce: string;
  readonly ciphertext: string;
}

export interface SealAes256GcmInput {
  readonly key: Uint8Array;
  readonly plaintext: Uint8Array;
  readonly domain: string;
  /** Public context authenticated but not stored in the envelope. */
  readonly context?: Uint8Array;
  /**
   * A 96-bit nonce. Omit in production so secure randomness is used. This
   * option exists for deterministic vectors; a nonce must never repeat per key.
   */
  readonly nonce?: Uint8Array;
}

export interface OpenAes256GcmInput {
  readonly key: Uint8Array;
  readonly envelope: unknown;
  /** Must exactly match the context supplied while sealing. */
  readonly context?: Uint8Array;
}

function additionalData(domain: string, context: Uint8Array): Uint8Array {
  return frameDomain('aes-256-gcm', domain, [
    new TextEncoder().encode('version=1'),
    new TextEncoder().encode('algorithm=A256GCM'),
    context,
  ]);
}

function parseEnvelope(input: unknown): {
  readonly envelope: SealedEnvelope;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
} {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new CryptoInputError('envelope must be an object.');
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = ['algorithm', 'ciphertext', 'domain', 'nonce', 'version'];
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new CryptoInputError('envelope contains missing or unsupported fields.');
  }
  if (record.version !== 1 || record.algorithm !== 'A256GCM') {
    throw new CryptoInputError('envelope version or algorithm is unsupported.');
  }

  const domain = requireDomain(record.domain);
  const nonce = decodeBase64Url(record.nonce, 'envelope.nonce', { exact: 12 });
  const ciphertext = decodeBase64Url(record.ciphertext, 'envelope.ciphertext', {
    minimum: 16,
    maximum: MAX_ENVELOPE_PLAINTEXT_BYTES + 16,
  });
  return {
    envelope: {
      version: 1,
      algorithm: 'A256GCM',
      domain,
      nonce: record.nonce as string,
      ciphertext: record.ciphertext as string,
    },
    nonce,
    ciphertext,
  };
}

export async function sealAes256Gcm(input: SealAes256GcmInput): Promise<SealedEnvelope> {
  const keyBytes = requireBytes(input.key, 'key', { exact: 32 });
  const plaintext = requireBytes(input.plaintext, 'plaintext', {
    maximum: MAX_ENVELOPE_PLAINTEXT_BYTES,
  });
  const context = requireBytes(input.context ?? new Uint8Array(), 'context', {
    maximum: MAX_CONTEXT_BYTES,
  });
  const domain = requireDomain(input.domain);
  const nonce = requireBytes(input.nonce ?? secureRandomBytes(12), 'nonce', { exact: 12 });
  const key = await getWebCrypto().subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const encrypted = await getWebCrypto().subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(additionalData(domain, context)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(plaintext),
  );

  return {
    version: 1,
    algorithm: 'A256GCM',
    domain,
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(encrypted)),
  };
}

export async function openAes256Gcm(input: OpenAes256GcmInput): Promise<Uint8Array> {
  const keyBytes = requireBytes(input.key, 'key', { exact: 32 });
  const context = requireBytes(input.context ?? new Uint8Array(), 'context', {
    maximum: MAX_CONTEXT_BYTES,
  });
  const { ciphertext, envelope, nonce } = parseEnvelope(input.envelope);
  const key = await getWebCrypto().subtle.importKey(
    'raw',
    toArrayBuffer(keyBytes),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );

  try {
    const plaintext = await getWebCrypto().subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(additionalData(envelope.domain, context)),
        tagLength: 128,
      },
      key,
      toArrayBuffer(ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    // Keep all authentication failures indistinguishable to callers.
    throw new CryptoOperationError('Unable to open sealed envelope.');
  }
}
