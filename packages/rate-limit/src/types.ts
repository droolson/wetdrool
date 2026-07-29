export interface RateLimitRequest {
  /**
   * A logical bucket family such as `http:auth` or `relay:publish`.
   *
   * Redis receives only an HMAC-derived representation of this value.
   */
  readonly namespace: string;
  /**
   * The raw client identity (for example an IP address or account identifier).
   *
   * Redis receives only an HMAC-derived representation of this value.
   */
  readonly key: string;
  readonly limit: number;
  readonly windowMs: number;
}

export type RateLimitDecisionReason = 'allowed' | 'limit-exceeded';

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly reason: RateLimitDecisionReason;
  readonly count: number;
  readonly limit: number;
  readonly remaining: number;
  /** Epoch milliseconds at which the current first-hit-anchored window resets. */
  readonly resetAt: number;
}

export type RateLimiterMode = 'redis' | 'memory';
export type RateLimiterStatus = 'unverified' | 'ready' | 'not-ready' | 'closed';

export interface RateLimiterHealth {
  readonly mode: RateLimiterMode;
  readonly status: RateLimiterStatus;
  readonly ready: boolean;
  readonly consecutiveFailures: number;
  readonly checkedAt: number | null;
  readonly lastSuccessAt: number | null;
  readonly lastFailureAt: number | null;
  readonly errorCode: string | null;
}

/**
 * A process-level limiter. Create one instance and share it across request
 * handlers so connection health and lifecycle are coordinated.
 */
export interface RateLimiter {
  consume(request: RateLimitRequest): Promise<RateLimitDecision>;
  /** Reads a bucket without incrementing it. Backend failures remain fail-closed. */
  read(request: RateLimitRequest): Promise<RateLimitDecision>;
  /** Actively probes the configured backend and returns a non-throwing health snapshot. */
  readiness(): Promise<RateLimiterHealth>;
  health(): RateLimiterHealth;
  close(): Promise<void>;
}
