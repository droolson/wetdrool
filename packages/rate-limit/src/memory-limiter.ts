import {
  RATE_LIMIT_BACKEND_UNAVAILABLE,
  RateLimitBackendUnavailableError,
  RateLimiterClosedError,
} from './errors.js';
import type {
  RateLimitDecision,
  RateLimiter,
  RateLimiterHealth,
  RateLimitRequest,
} from './types.js';
import { requireClockValue, requireIntegerInRange, requireRateLimitRequest } from './validation.js';

const DEFAULT_MAXIMUM_KEYS = 10_000;
const MAXIMUM_MEMORY_KEYS = 1_000_000;

interface MemoryBucket {
  count: number;
  resetAt: number;
}

export interface ExplicitMemoryRateLimiterOptions {
  /**
   * Required acknowledgement that this process-local implementation is only
   * suitable for deterministic tests or single-process loopback development.
   */
  readonly unsafeAllowMemory: true;
  readonly maximumKeys?: number;
  readonly clock?: () => number;
}

class ExplicitMemoryFixedWindowRateLimiter implements RateLimiter {
  readonly #buckets = new Map<string, MemoryBucket>();
  readonly #maximumKeys: number;
  readonly #clock: () => number;
  #status: RateLimiterHealth['status'] = 'ready';
  #consecutiveFailures = 0;
  #checkedAt: number | null = null;
  #lastSuccessAt: number | null = null;
  #lastFailureAt: number | null = null;
  #errorCode: string | null = null;
  #closed = false;

  constructor(options: ExplicitMemoryRateLimiterOptions) {
    if (options.unsafeAllowMemory !== true) {
      throw new TypeError('The memory limiter requires unsafeAllowMemory: true.');
    }
    this.#maximumKeys = requireIntegerInRange(
      options.maximumKeys ?? DEFAULT_MAXIMUM_KEYS,
      'maximumKeys',
      1,
      MAXIMUM_MEMORY_KEYS,
    );
    this.#clock = options.clock ?? Date.now;
  }

  async consume(untrustedRequest: RateLimitRequest): Promise<RateLimitDecision> {
    this.#requireOpen();
    const request = requireRateLimitRequest(untrustedRequest);
    const now = requireClockValue(this.#clock());
    const mapKey = this.#mapKey(request);
    const existing = this.#buckets.get(mapKey);

    let bucket: MemoryBucket;
    if (existing === undefined || existing.resetAt <= now) {
      if (existing === undefined && this.#buckets.size >= this.#maximumKeys) {
        this.#pruneExpired(now);
      }
      if (existing === undefined && this.#buckets.size >= this.#maximumKeys) {
        const error = new RateLimitBackendUnavailableError('consume', 1);
        this.#markFailure(error.code, now);
        throw error;
      }
      const resetAt = now + request.windowMs;
      if (!Number.isSafeInteger(resetAt)) {
        const error = new RateLimitBackendUnavailableError('consume', 1);
        this.#markFailure(error.code, now);
        throw error;
      }
      bucket = {
        count: 1,
        resetAt,
      };
      this.#buckets.set(mapKey, bucket);
    } else {
      bucket = {
        count: existing.count + 1,
        resetAt: existing.resetAt,
      };
      this.#buckets.set(mapKey, bucket);
    }

    this.#markAvailableCapacity(now);
    return this.#decision(bucket.count, bucket.resetAt, request.limit);
  }

  async read(untrustedRequest: RateLimitRequest): Promise<RateLimitDecision> {
    this.#requireOpen();
    const request = requireRateLimitRequest(untrustedRequest);
    const now = requireClockValue(this.#clock());
    const existing = this.#buckets.get(this.#mapKey(request));
    this.#markAvailableCapacity(now);
    if (existing === undefined || existing.resetAt <= now) {
      return this.#decision(0, now, request.limit);
    }
    return this.#decision(existing.count, existing.resetAt, request.limit);
  }

  health(): RateLimiterHealth {
    return {
      mode: 'memory',
      status: this.#status,
      ready: this.#status === 'ready',
      consecutiveFailures: this.#consecutiveFailures,
      checkedAt: this.#checkedAt,
      lastSuccessAt: this.#lastSuccessAt,
      lastFailureAt: this.#lastFailureAt,
      errorCode: this.#errorCode,
    };
  }

  async readiness(): Promise<RateLimiterHealth> {
    if (this.#closed) {
      return this.health();
    }
    const now = requireClockValue(this.#clock());
    this.#pruneExpired(now);
    this.#markAvailableCapacity(now);
    return this.health();
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#buckets.clear();
    this.#status = 'closed';
    this.#errorCode = null;
  }

  #requireOpen(): void {
    if (this.#closed) {
      throw new RateLimiterClosedError();
    }
  }

  #mapKey(request: RateLimitRequest): string {
    return `${request.namespace.length}:${request.namespace}${request.key}`;
  }

  #decision(count: number, resetAt: number, limit: number): RateLimitDecision {
    const allowed = count <= limit;
    return {
      allowed,
      reason: allowed ? 'allowed' : 'limit-exceeded',
      count,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  }

  #pruneExpired(now: number): void {
    for (const [key, bucket] of this.#buckets) {
      if (bucket.resetAt <= now) {
        this.#buckets.delete(key);
      }
    }
  }

  #markSuccess(now: number): void {
    this.#status = 'ready';
    this.#consecutiveFailures = 0;
    this.#checkedAt = now;
    this.#lastSuccessAt = now;
    this.#errorCode = null;
  }

  #markAvailableCapacity(now: number): void {
    if (this.#buckets.size < this.#maximumKeys) {
      this.#markSuccess(now);
    } else {
      this.#markFailure(RATE_LIMIT_BACKEND_UNAVAILABLE, now);
    }
  }

  #markFailure(code: string, now: number): void {
    this.#status = 'not-ready';
    this.#consecutiveFailures += 1;
    this.#checkedAt = now;
    this.#lastFailureAt = now;
    this.#errorCode = code;
  }
}

/**
 * There is deliberately no automatic Redis-to-memory fallback. Callers must
 * opt into this separate implementation at both the type and runtime levels.
 */
export function createExplicitMemoryRateLimiter(
  options: ExplicitMemoryRateLimiterOptions,
): RateLimiter {
  return new ExplicitMemoryFixedWindowRateLimiter(options);
}
