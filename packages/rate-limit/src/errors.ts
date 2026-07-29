export const RATE_LIMIT_BACKEND_UNAVAILABLE = 'RATE_LIMIT_BACKEND_UNAVAILABLE';
export const RATE_LIMITER_CLOSED = 'RATE_LIMITER_CLOSED';

export type RateLimitBackendOperation = 'consume' | 'read' | 'readiness' | 'close';

/**
 * Stable, public dependency-failure error. HTTP integrations should preserve
 * `statusCode` so an unavailable limiter is a fail-closed 503, never a 429.
 */
export class RateLimitBackendUnavailableError extends Error {
  readonly code = RATE_LIMIT_BACKEND_UNAVAILABLE;
  readonly statusCode = 503;
  readonly operation: RateLimitBackendOperation;
  readonly attempts: number;

  constructor(operation: RateLimitBackendOperation, attempts: number) {
    super('The rate-limit backend is unavailable.');
    this.name = 'RateLimitBackendUnavailableError';
    this.operation = operation;
    this.attempts = attempts;
  }
}

/** Raised when a request attempts to use a limiter after lifecycle shutdown. */
export class RateLimiterClosedError extends Error {
  readonly code = RATE_LIMITER_CLOSED;
  readonly statusCode = 503;

  constructor() {
    super('The rate limiter is closed.');
    this.name = 'RateLimiterClosedError';
  }
}
