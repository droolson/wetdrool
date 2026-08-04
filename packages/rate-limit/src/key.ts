import { createHmac } from 'node:crypto';

import { requireBoundedString } from './validation.js';

const MINIMUM_SECRET_BYTES = 32;
const MAXIMUM_SECRET_BYTES = 1_024;
const DEFAULT_REDIS_PREFIX = 'wetdrool:rate-limit:v1';
const PREFIX_PATTERN = /^[A-Za-z0-9:_-]+$/u;

export interface DeriveRateLimitRedisKeyOptions {
  readonly secret: Uint8Array;
  readonly namespace: string;
  readonly key: string;
  readonly prefix?: string;
}

function requireSecret(secret: Uint8Array): Buffer {
  if (!(secret instanceof Uint8Array)) {
    throw new TypeError('secret must be a Uint8Array.');
  }
  if (secret.byteLength < MINIMUM_SECRET_BYTES || secret.byteLength > MAXIMUM_SECRET_BYTES) {
    throw new RangeError(
      `secret must contain between ${MINIMUM_SECRET_BYTES} and ${MAXIMUM_SECRET_BYTES} bytes.`,
    );
  }
  return Buffer.from(secret);
}

function requirePrefix(prefix: string): string {
  requireBoundedString(prefix, 'prefix', 192);
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new RangeError(
      'prefix may contain only ASCII letters, digits, colons, underscores, and hyphens.',
    );
  }
  return prefix;
}

function updateFramed(hmac: ReturnType<typeof createHmac>, value: string): void {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.allocUnsafe(4);
  length.writeUInt32BE(bytes.byteLength);
  hmac.update(length);
  hmac.update(bytes);
}

function digest(secret: Uint8Array, domain: string, values: readonly string[]): string {
  const hmac = createHmac('sha256', secret);
  hmac.update(domain, 'utf8');
  for (const value of values) {
    updateFramed(hmac, value);
  }
  return hmac.digest('base64url');
}

/**
 * Derives a Redis-safe, non-reversible key. Neither the raw namespace nor the
 * raw client key is embedded in the result.
 */
export function deriveRateLimitRedisKey(options: DeriveRateLimitRedisKeyOptions): string {
  const secret = requireSecret(options.secret);
  try {
    const namespace = requireBoundedString(options.namespace, 'namespace', 512);
    const key = requireBoundedString(options.key, 'key', 4_096);
    const prefix = requirePrefix(options.prefix ?? DEFAULT_REDIS_PREFIX);
    const namespaceDigest = digest(secret, 'wetdrool-rate-limit-namespace-v1', [namespace]);
    const keyDigest = digest(secret, 'wetdrool-rate-limit-key-v1', [namespace, key]);
    return `${prefix}:${namespaceDigest}:${keyDigest}`;
  } finally {
    secret.fill(0);
  }
}

export function copyRateLimitHmacSecret(secret: Uint8Array): Uint8Array {
  const validated = requireSecret(secret);
  try {
    return new Uint8Array(validated);
  } finally {
    validated.fill(0);
  }
}
