import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { ModerationServiceError } from './errors.js';

const KEY_ID_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/u;
const ENCRYPTION_DOMAIN = 'wetdrool.com/moderation/aes-256-gcm/v1';
const encryptedPayloadSchema = z
  .object({
    version: z.literal(1),
    keyId: z.string().regex(KEY_ID_PATTERN),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16}$/u),
    ciphertext: z.string().regex(/^[A-Za-z0-9_-]+$/u),
    tag: z.string().regex(/^[A-Za-z0-9_-]{22}$/u),
  })
  .strict();

export type EncryptedPayload = z.infer<typeof encryptedPayloadSchema>;

export interface ModerationKeyRingInput {
  readonly activeKeyId: string;
  readonly keys: Readonly<Record<string, Uint8Array>>;
  readonly random?: (size: number) => Uint8Array;
}

export class ModerationKeyRing {
  readonly activeKeyId: string;
  readonly #keys: ReadonlyMap<string, Uint8Array>;
  readonly #random: (size: number) => Uint8Array;

  constructor(input: ModerationKeyRingInput) {
    if (!KEY_ID_PATTERN.test(input.activeKeyId)) {
      throw new TypeError('The active moderation data-key ID is invalid.');
    }
    const keys = new Map<string, Uint8Array>();
    for (const [keyId, key] of Object.entries(input.keys)) {
      if (!KEY_ID_PATTERN.test(keyId)) {
        throw new TypeError('A moderation data-key ID is invalid.');
      }
      if (key.byteLength !== 32) {
        throw new TypeError('Moderation data keys must contain exactly 32 bytes.');
      }
      keys.set(keyId, key.slice());
    }
    if (keys.size < 1 || keys.size > 16) {
      throw new TypeError('Moderation data-key rings must contain between 1 and 16 keys.');
    }
    if (!keys.has(input.activeKeyId)) {
      throw new TypeError('The active moderation data key is missing from the key ring.');
    }
    this.activeKeyId = input.activeKeyId;
    this.#keys = keys;
    this.#random = input.random ?? ((size) => randomBytes(size));
  }

  encryptBytes(recordType: string, recordId: string, plaintext: Uint8Array): EncryptedPayload {
    assertContext(recordType, recordId);
    const key = this.#keys.get(this.activeKeyId);
    if (key === undefined) {
      throw new ModerationServiceError(
        'The active moderation data key is unavailable.',
        'encryption-unavailable',
      );
    }
    const nonce = this.#random(12);
    if (nonce.byteLength !== 12) {
      throw new TypeError('The moderation encryption nonce source must return exactly 12 bytes.');
    }
    const ownedPlaintext = Buffer.from(plaintext);
    try {
      const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
      cipher.setAAD(aad(recordType, recordId), { plaintextLength: ownedPlaintext.byteLength });
      const ciphertext = Buffer.concat([cipher.update(ownedPlaintext), cipher.final()]);
      const tag = cipher.getAuthTag();
      return {
        version: 1,
        keyId: this.activeKeyId,
        nonce: Buffer.from(nonce).toString('base64url'),
        ciphertext: ciphertext.toString('base64url'),
        tag: tag.toString('base64url'),
      };
    } catch (error) {
      throw new ModerationServiceError(
        'Restricted moderation data could not be encrypted.',
        'encryption-failed',
        { cause: error },
      );
    } finally {
      ownedPlaintext.fill(0);
    }
  }

  decryptBytes(recordType: string, recordId: string, input: unknown): Uint8Array {
    assertContext(recordType, recordId);
    const payload = encryptedPayloadSchema.safeParse(input);
    if (!payload.success) {
      throw new ModerationServiceError(
        'Restricted moderation ciphertext is malformed.',
        'corrupt-storage',
        { cause: payload.error },
      );
    }
    const key = this.#keys.get(payload.data.keyId);
    if (key === undefined) {
      throw new ModerationServiceError(
        'The required moderation data-key version is unavailable.',
        'encryption-unavailable',
      );
    }
    let nonce: Buffer;
    let tag: Buffer;
    let ciphertext: Buffer;
    try {
      nonce = decodeExact(payload.data.nonce, 12, 'nonce');
      tag = decodeExact(payload.data.tag, 16, 'authentication tag');
      ciphertext = decodeBase64Url(payload.data.ciphertext, 'ciphertext');
    } catch (error) {
      throw new ModerationServiceError(
        'Restricted moderation ciphertext is malformed.',
        'corrupt-storage',
        { cause: error },
      );
    }
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
      decipher.setAAD(aad(recordType, recordId), { plaintextLength: ciphertext.byteLength });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch (error) {
      throw new ModerationServiceError(
        'Restricted moderation ciphertext failed authentication.',
        'corrupt-storage',
        { cause: error },
      );
    }
  }

  encryptJson(recordType: string, recordId: string, value: unknown): EncryptedPayload {
    const encoded = new TextEncoder().encode(JSON.stringify(value));
    try {
      return this.encryptBytes(recordType, recordId, encoded);
    } finally {
      encoded.fill(0);
    }
  }

  decryptJson(recordType: string, recordId: string, input: unknown): unknown {
    const plaintext = this.decryptBytes(recordType, recordId, input);
    try {
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)) as unknown;
    } catch (error) {
      throw new ModerationServiceError(
        'Restricted moderation plaintext is not valid UTF-8 JSON.',
        'corrupt-storage',
        { cause: error },
      );
    } finally {
      plaintext.fill(0);
    }
  }
}

export interface ParseModerationKeyRingOptions {
  readonly forbiddenKeys?: readonly Uint8Array[];
}

export function parseModerationKeyRingJson(
  source: string,
  options: ParseModerationKeyRingOptions = {},
): ModerationKeyRing {
  let input: unknown;
  try {
    input = JSON.parse(source) as unknown;
  } catch {
    throw new TypeError('MODERATION_DATA_KEYS must be valid JSON.');
  }
  const parsed = z
    .object({
      activeKeyId: z.string().regex(KEY_ID_PATTERN),
      keys: z
        .record(z.string().regex(KEY_ID_PATTERN), z.string().min(1))
        .refine(
          (keys) => Object.keys(keys).length >= 1 && Object.keys(keys).length <= 16,
          'Moderation data-key rings must contain between 1 and 16 keys.',
        ),
    })
    .strict()
    .parse(input);
  const keys: Record<string, Uint8Array> = {};
  for (const [keyId, encoded] of Object.entries(parsed.keys)) {
    const key = decodeExact(encoded, 32, `data key ${keyId}`);
    if (
      options.forbiddenKeys?.some(
        (forbiddenKey) =>
          forbiddenKey.byteLength === key.byteLength &&
          timingSafeEqual(Buffer.from(forbiddenKey), key),
      )
    ) {
      key.fill(0);
      throw new TypeError('MODERATION_DATA_KEYS contains the public local-development data key.');
    }
    keys[keyId] = key;
  }
  return new ModerationKeyRing({ activeKeyId: parsed.activeKeyId, keys });
}

function aad(recordType: string, recordId: string): Buffer {
  return Buffer.from(`${ENCRYPTION_DOMAIN}\0${recordType}\0${recordId}`, 'utf8');
}

function assertContext(recordType: string, recordId: string): void {
  if (
    recordType.length < 1 ||
    recordType.length > 96 ||
    recordId.length < 1 ||
    recordId.length > 256 ||
    recordType.includes('\0') ||
    recordId.includes('\0')
  ) {
    throw new TypeError('Moderation encryption context is invalid.');
  }
}

function decodeExact(value: string, bytes: number, label: string): Buffer {
  const decoded = decodeBase64Url(value, label);
  if (decoded.byteLength !== bytes || decoded.toString('base64url') !== value) {
    throw new TypeError(
      `The moderation ${label} must be canonical base64url for ${String(bytes)} bytes.`,
    );
  }
  return decoded;
}

function decodeBase64Url(value: string, label: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) {
    throw new TypeError(`The moderation ${label} must use unpadded base64url.`);
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) {
    throw new TypeError(`The moderation ${label} must use canonical unpadded base64url.`);
  }
  return decoded;
}
