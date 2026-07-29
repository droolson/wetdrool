import type { RateLimitRequest } from './types.js';

export const MAX_RATE_LIMIT = Number.MAX_SAFE_INTEGER - 1;
export const MAX_WINDOW_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_NAMESPACE_LENGTH = 512;
const MAX_KEY_LENGTH = 4_096;

export function requireRateLimitRequest(request: RateLimitRequest): RateLimitRequest {
  requireBoundedString(request.namespace, 'namespace', MAX_NAMESPACE_LENGTH);
  requireBoundedString(request.key, 'key', MAX_KEY_LENGTH);
  requireIntegerInRange(request.limit, 'limit', 0, MAX_RATE_LIMIT);
  requireIntegerInRange(request.windowMs, 'windowMs', 1, MAX_WINDOW_MS);
  return request;
}

export function requireIntegerInRange(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${label} must be a safe integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

export function requireBoundedString(value: string, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new RangeError(`${label} must contain between 1 and ${maximum} characters.`);
  }
  return value;
}

export function requireClockValue(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError('The rate-limit clock must return a non-negative epoch millisecond.');
  }
  return value;
}
