import { sha256 } from '@noble/hashes/sha2.js';
import { base64url } from 'multiformats/bases/base64';

export class ProtocolEncodingError extends Error {
  override readonly name = 'ProtocolEncodingError';
}

export function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function utf8Length(value: string): number {
  return utf8(value).byteLength;
}

export function encodeMultibaseBase64Url(bytes: Uint8Array): string {
  return base64url.encode(bytes);
}

export function decodeMultibaseBase64Url(value: string, expectedLength?: number): Uint8Array {
  let decoded: Uint8Array;

  try {
    decoded = base64url.decode(value);
  } catch {
    throw new ProtocolEncodingError('Invalid multibase base64url value.');
  }

  if (expectedLength !== undefined && decoded.byteLength !== expectedLength) {
    throw new ProtocolEncodingError(
      `Expected ${expectedLength} bytes, received ${decoded.byteLength}.`,
    );
  }

  return decoded;
}

export function digestSha256(bytes: Uint8Array): Uint8Array {
  return sha256(bytes);
}

export function digestSha256Multibase(bytes: Uint8Array): string {
  return encodeMultibaseBase64Url(digestSha256(bytes));
}

export function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}
