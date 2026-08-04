import { createHash, timingSafeEqual } from 'node:crypto';

import { secureRandomBytes, secureRandomId } from '@wetdrool/crypto';

const HASH_DOMAIN = Buffer.from('wetdrool/auth-service/hash/v1\u0000', 'utf8');
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const SENSITIVE_FIELD_NAMES = new Set([
  'accountkeyseed',
  'plaintextkey',
  'privatekey',
  'prf',
  'prfoutput',
  'prfresults',
  'seed',
]);

export const SESSION_COOKIE_NAME = '__Host-wetdrool-session';
export const CSRF_COOKIE_NAME = '__Host-wetdrool-csrf';

export function randomAccountId(): string {
  return secureRandomId({ prefix: 'acct' });
}

export function randomCeremonyId(): string {
  return secureRandomId({ prefix: 'cer' });
}

export function randomSessionId(): string {
  return secureRandomId({ prefix: 'ses' });
}

export function randomToken(bytes = 32): string {
  return Buffer.from(secureRandomBytes(bytes)).toString('base64url');
}

export function hashSecret(secret: string): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(HASH_DOMAIN).update(secret, 'utf8').digest());
}

export function hashChallenge(challenge: string): Uint8Array {
  return hashSecret(`challenge:${challenge}`);
}

export function equalHash(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left.byteLength === right.byteLength && timingSafeEqual(Buffer.from(left), Buffer.from(right))
  );
}

export function isBase64Url(value: string, maximumLength = 1368): boolean {
  return value.length > 0 && value.length <= maximumLength && BASE64URL_PATTERN.test(value);
}

export function decodeBase64Url(value: string, maximumBytes: number): Uint8Array | undefined {
  if (!isBase64Url(value, Math.ceil((maximumBytes * 4) / 3))) {
    return undefined;
  }
  const decoded = Uint8Array.from(Buffer.from(value, 'base64url'));
  return decoded.byteLength > 0 &&
    decoded.byteLength <= maximumBytes &&
    encodeBase64Url(decoded) === value
    ? decoded
    : undefined;
}

export function encodeBase64Url(value: Uint8Array): string {
  return Buffer.from(value).toString('base64url');
}

export function sessionCookieValue(sessionId: string, secret: string): string {
  return `${sessionId}.${secret}`;
}

export function parseSessionCookie(
  value: string | undefined,
): { readonly sessionId: string; readonly secret: string } | undefined {
  if (value === undefined) return undefined;
  const separator = value.indexOf('.');
  if (separator < 1 || value.indexOf('.', separator + 1) !== -1) return undefined;
  const sessionId = value.slice(0, separator);
  const secret = value.slice(separator + 1);
  if (!/^ses_[A-Za-z0-9_-]{22}$/u.test(sessionId) || !isBase64Url(secret, 86)) {
    return undefined;
  }
  return { sessionId, secret };
}

export function assertNoClientKeyMaterial(input: unknown): void {
  visit(input, 0);
}

function visit(value: unknown, depth: number): void {
  if (depth > 16) {
    throw new TypeError('Request nesting exceeds the supported limit.');
  }
  if (Array.isArray(value)) {
    if (value.length > 256) throw new TypeError('Request array exceeds the supported limit.');
    for (const item of value) visit(item, depth + 1);
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_FIELD_NAMES.has(key.replace(/[-_]/gu, '').toLowerCase())) {
      throw new TypeError('Client key material and WebAuthn PRF results are not accepted.');
    }
    visit(item, depth + 1);
  }
}
