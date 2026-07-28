import { messagingError } from './errors.js';
import type { CurrentDeviceAuthorization, SocialDeviceAddress } from './types.js';

const ADDRESS_MAX_UTF8_BYTES = 256;
const ASSERTION_ID_MAX_UTF8_BYTES = 256;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const CONTENT_TYPE_PATTERN = /^[a-z][a-z0-9.+/-]{0,127}$/u;
const MESSAGE_ID_PATTERN = /^swm_[A-Za-z0-9_-]{22}$/u;
const MAX_CIPHERTEXT_CHARACTERS = 8 * 1024 * 1024;
export const MAX_DIRECTORY_BODY_BYTES = 16 * 1024 * 1024;
export const MAX_PLAINTEXT_BYTES = 1024 * 1024;

const encoder = new TextEncoder();
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

export interface InternalAddress {
  readonly external: SocialDeviceAddress;
  readonly userId: string;
  readonly deviceId: string;
}

export function copyAddress(address: SocialDeviceAddress): SocialDeviceAddress {
  return {
    identityId: address.identityId,
    deviceId: address.deviceId,
  };
}

export function requireAddress(input: unknown): SocialDeviceAddress {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw messagingError('INVALID_INPUT');
  }
  const record = input as Record<string, unknown>;
  if (
    Object.keys(record).length !== 2 ||
    typeof record.identityId !== 'string' ||
    typeof record.deviceId !== 'string'
  ) {
    throw messagingError('INVALID_INPUT');
  }
  requireOpaqueIdentifier(record.identityId);
  requireOpaqueIdentifier(record.deviceId);
  return { identityId: record.identityId, deviceId: record.deviceId };
}

function requireOpaqueIdentifier(value: string): void {
  const bytes = encoder.encode(value);
  if (
    value.length === 0 ||
    !isWellFormedUnicode(value) ||
    value.trim() !== value ||
    bytes.byteLength > ADDRESS_MAX_UTF8_BYTES ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
    })
  ) {
    throw messagingError('INVALID_INPUT');
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

export async function deriveInternalAddress(
  address: SocialDeviceAddress,
): Promise<InternalAddress> {
  const external = requireAddress(address);
  const identityDigest = await digestIdentifier('woke.social/messaging/internal-identity/v1', [
    external.identityId,
  ]);
  const deviceDigest = await digestIdentifier('woke.social/messaging/internal-device/v1', [
    external.identityId,
    external.deviceId,
  ]);
  return {
    external: copyAddress(external),
    userId: `@sw_${encodeBase64Url(identityDigest)}:messaging.invalid`,
    deviceId: `SW_${encodeBase64Url(deviceDigest)}`,
  };
}

async function digestIdentifier(domain: string, values: readonly string[]): Promise<Uint8Array> {
  const cryptoProvider = globalThis.crypto;
  if (cryptoProvider?.subtle === undefined) {
    throw messagingError('ENGINE_UNAVAILABLE');
  }
  const fields = [domain, ...values].map((value) => encoder.encode(value));
  const length = fields.reduce((total, field) => total + 4 + field.byteLength, 0);
  const framed = new Uint8Array(length);
  const view = new DataView(framed.buffer);
  let offset = 0;
  for (const field of fields) {
    view.setUint32(offset, field.byteLength, false);
    offset += 4;
    framed.set(field, offset);
    offset += field.byteLength;
  }
  const digest = await cryptoProvider.subtle.digest('SHA-256', framed);
  return new Uint8Array(digest);
}

export function secureMessageId(): string {
  const cryptoProvider = globalThis.crypto;
  if (typeof cryptoProvider?.getRandomValues !== 'function') {
    throw messagingError('ENGINE_UNAVAILABLE');
  }
  return `swm_${encodeBase64Url(cryptoProvider.getRandomValues(new Uint8Array(16)))}`;
}

export function requireMessageId(input: unknown): string {
  if (typeof input !== 'string' || !MESSAGE_ID_PATTERN.test(input)) {
    throw messagingError('INVALID_ENVELOPE');
  }
  return input;
}

export function requireContentType(input: unknown): string {
  if (typeof input !== 'string' || !CONTENT_TYPE_PATTERN.test(input)) {
    throw messagingError('INVALID_INPUT');
  }
  return input;
}

export function requirePlaintext(input: unknown): Uint8Array {
  if (!(input instanceof Uint8Array) || input.byteLength > MAX_PLAINTEXT_BYTES) {
    throw messagingError('INVALID_INPUT');
  }
  return Uint8Array.from(input);
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function encodeUnpaddedBase64(bytes: Uint8Array): string {
  return encodeBase64Url(bytes).replaceAll('-', '+').replaceAll('_', '/');
}

export function decodeBase64Url(value: unknown, maximumBytes = MAX_PLAINTEXT_BYTES): Uint8Array {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CIPHERTEXT_CHARACTERS ||
    value.length % 4 === 1 ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw messagingError('INVALID_ENVELOPE');
  }
  let binary: string;
  try {
    binary = atob(
      value
        .replaceAll('-', '+')
        .replaceAll('_', '/')
        .padEnd(value.length + ((4 - (value.length % 4)) % 4), '='),
    );
  } catch {
    throw messagingError('INVALID_ENVELOPE');
  }
  if (binary.length > maximumBytes) {
    throw messagingError('INVALID_ENVELOPE');
  }
  const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
  if (encodeBase64Url(bytes) !== value) {
    throw messagingError('INVALID_ENVELOPE');
  }
  return bytes;
}

export function decodeUnpaddedBase64(
  value: unknown,
  maximumBytes = MAX_PLAINTEXT_BYTES,
): Uint8Array {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+$/u.test(value)) {
    throw messagingError('INVALID_ENVELOPE');
  }
  const bytes = decodeBase64Url(value.replaceAll('+', '-').replaceAll('/', '_'), maximumBytes);
  if (encodeUnpaddedBase64(bytes) !== value) {
    throw messagingError('INVALID_ENVELOPE');
  }
  return bytes;
}

export function encodeUtf8(value: string): Uint8Array {
  return encoder.encode(value);
}

export function decodeUtf8(value: Uint8Array): string {
  try {
    return strictDecoder.decode(value);
  } catch {
    throw messagingError('INVALID_ENVELOPE');
  }
}

export function equalAddress(left: SocialDeviceAddress, right: SocialDeviceAddress): boolean {
  return left.identityId === right.identityId && left.deviceId === right.deviceId;
}

export function internalAddressKey(userId: string, deviceId: string): string {
  return `${userId}\u0000${deviceId}`;
}

export function externalAddressKey(address: SocialDeviceAddress): string {
  return `${address.identityId.length}:${address.identityId}${address.deviceId.length}:${address.deviceId}`;
}

export function requireActiveAuthorization(
  input: unknown,
  expectedAddress: SocialDeviceAddress,
  expectedCurve25519Key: string,
  expectedEd25519Key: string,
  nowEpochMs: number,
): CurrentDeviceAuthorization {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw messagingError('DEVICE_UNAUTHORIZED');
  }
  const record = input as Record<string, unknown>;
  if (
    record.version !== 1 ||
    record.status !== 'active' ||
    record.identityId !== expectedAddress.identityId ||
    record.deviceId !== expectedAddress.deviceId ||
    record.curve25519PublicKey !== expectedCurve25519Key ||
    record.ed25519PublicKey !== expectedEd25519Key ||
    typeof record.assertionId !== 'string' ||
    encoder.encode(record.assertionId).byteLength > ASSERTION_ID_MAX_UTF8_BYTES ||
    record.assertionId.length === 0 ||
    !Number.isSafeInteger(record.revision) ||
    (record.revision as number) < 0 ||
    !Number.isSafeInteger(record.issuedAtEpochMs) ||
    !Number.isSafeInteger(record.expiresAtEpochMs) ||
    (record.issuedAtEpochMs as number) > nowEpochMs ||
    (record.expiresAtEpochMs as number) <= nowEpochMs
  ) {
    throw messagingError('DEVICE_UNAUTHORIZED');
  }
  return input as CurrentDeviceAuthorization;
}

export function parseJsonRecord(
  value: string,
  failure:
    'DIRECTORY_PROTOCOL_ERROR' | 'DECRYPTION_FAILED' | 'ENCRYPTION_FAILED' | 'INVALID_ENVELOPE',
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not a record');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw messagingError(failure);
  }
}

export function hasExactlyKeys(
  record: Readonly<Record<string, unknown>>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}
