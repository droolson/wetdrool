import { CryptoInputError, CryptoUnavailableError } from './errors.js';

export const MAX_DIGEST_INPUT_BYTES = 64 * 1024 * 1024;
export const MAX_ENVELOPE_PLAINTEXT_BYTES = 16 * 1024 * 1024;
export const MAX_CONTEXT_BYTES = 64 * 1024;

const DOMAIN_PATTERN = /^[a-z][a-z0-9./:-]{0,127}$/u;
const PURPOSE_PATTERN = /^[a-z][a-z0-9-]{0,63}$/u;
const DOMAIN_SEPARATOR = new TextEncoder().encode('wetdrool.crypto/v1');

export function getWebCrypto(): Crypto {
  const provider = globalThis.crypto;
  if (
    provider === undefined ||
    typeof provider.getRandomValues !== 'function' ||
    provider.subtle === undefined
  ) {
    throw new CryptoUnavailableError('A standards-compliant WebCrypto implementation is required.');
  }
  return provider;
}

export function requireBytes(
  value: unknown,
  name: string,
  options: { readonly minimum?: number; readonly maximum?: number; readonly exact?: number } = {},
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new CryptoInputError(`${name} must be a Uint8Array.`);
  }

  const { exact, maximum = Number.MAX_SAFE_INTEGER, minimum = 0 } = options;
  if (exact !== undefined && value.byteLength !== exact) {
    throw new CryptoInputError(`${name} must contain exactly ${exact} bytes.`);
  }
  if (value.byteLength < minimum || value.byteLength > maximum) {
    throw new CryptoInputError(`${name} must contain between ${minimum} and ${maximum} bytes.`);
  }

  return value;
}

export function requireInteger(
  value: unknown,
  name: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new CryptoInputError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

export function requireDomain(value: unknown): string {
  if (typeof value !== 'string' || !DOMAIN_PATTERN.test(value)) {
    throw new CryptoInputError(
      'domain must be 1-128 lowercase ASCII characters beginning with a letter.',
    );
  }
  return value;
}

function requirePurpose(value: string): string {
  if (!PURPOSE_PATTERN.test(value)) {
    throw new CryptoInputError('Internal cryptographic purpose is invalid.');
  }
  return value;
}

function encodeLength(length: number): Uint8Array {
  if (!Number.isSafeInteger(length) || length < 0 || length > 0xffff_ffff) {
    throw new CryptoInputError('Domain-separated field is too large.');
  }
  const encoded = new Uint8Array(4);
  new DataView(encoded.buffer).setUint32(0, length, false);
  return encoded;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((total, part) => total + part.byteLength, 0);
  if (!Number.isSafeInteger(length) || length > 0xffff_ffff) {
    throw new CryptoInputError('Domain-separated input is too large.');
  }

  const output = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

/**
 * Frames all cryptographic inputs so no domain, purpose, or part boundary can
 * collide with another operation. The format is private to this package and
 * versioned by DOMAIN_SEPARATOR.
 */
export function frameDomain(
  purpose: string,
  domain: string,
  parts: readonly Uint8Array[],
): Uint8Array {
  const encoder = new TextEncoder();
  const fields = [
    DOMAIN_SEPARATOR,
    encoder.encode(requirePurpose(purpose)),
    encoder.encode(requireDomain(domain)),
    encodeLength(parts.length),
    ...parts.map((part) => requireBytes(part, 'domain-separated part')),
  ];
  return concat(fields.flatMap((field) => [encodeLength(field.byteLength), field]));
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]*$/u;

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function decodeBase64Url(
  value: unknown,
  name: string,
  options: { readonly minimum?: number; readonly maximum?: number; readonly exact?: number } = {},
): Uint8Array {
  if (typeof value !== 'string' || value.length % 4 === 1 || !BASE64URL_PATTERN.test(value)) {
    throw new CryptoInputError(`${name} must be canonical unpadded base64url.`);
  }

  let binary: string;
  try {
    const padded = value
      .replaceAll('-', '+')
      .replaceAll('_', '/')
      .padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
    binary = atob(padded);
  } catch {
    throw new CryptoInputError(`${name} must be canonical unpadded base64url.`);
  }

  const bytes = Uint8Array.from(binary, (character) => character.codePointAt(0) ?? 0);
  if (encodeBase64Url(bytes) !== value) {
    throw new CryptoInputError(`${name} must be canonical unpadded base64url.`);
  }
  return requireBytes(bytes, name, options);
}
