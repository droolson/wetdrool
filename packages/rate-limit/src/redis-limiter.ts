import {
  RateLimitBackendUnavailableError,
  RateLimiterClosedError,
  type RateLimitBackendOperation,
} from './errors.js';
import { copyRateLimitHmacSecret, deriveRateLimitRedisKey } from './key.js';
import {
  REDIS_FIXED_WINDOW_CONSUME_LUA,
  REDIS_FIXED_WINDOW_READ_LUA,
  REDIS_RATE_LIMIT_READINESS_LUA,
} from './redis-script.js';
import type { RateLimitRedisTransport } from './redis-transport.js';
import type {
  RateLimitDecision,
  RateLimiter,
  RateLimiterHealth,
  RateLimitRequest,
} from './types.js';
import {
  MAX_WINDOW_MS,
  requireClockValue,
  requireIntegerInRange,
  requireRateLimitRequest,
} from './validation.js';

const DEFAULT_COMMAND_TIMEOUT_MS = 150;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 25;
const MAX_COMMAND_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 5_000;

export interface RedisFixedWindowRateLimiterOptions {
  readonly transport: RateLimitRedisTransport;
  readonly hmacSecret: Uint8Array;
  readonly redisKeyPrefix?: string;
  readonly commandTimeoutMs?: number;
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  readonly clock?: () => number;
  readonly onBackendError?: (error: RateLimitBackendUnavailableError) => void;
}

type DecisionOperation = 'consume' | 'read';

interface MutableHealth {
  status: RateLimiterHealth['status'];
  consecutiveFailures: number;
  checkedAt: number | null;
  lastSuccessAt: number | null;
  lastFailureAt: number | null;
  errorCode: string | null;
}

class CommandTimeoutError extends Error {
  constructor() {
    super('The rate-limit backend command timed out.');
    this.name = 'CommandTimeoutError';
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new CommandTimeoutError());
    }, timeoutMs);
  });

  try {
    return await Promise.race([operation(controller.signal), timeoutPromise]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function parseInteger(value: unknown, label: string): number {
  let normalized = value;
  if (typeof value === 'bigint') {
    normalized = value.toString();
  } else if (value instanceof Uint8Array) {
    normalized = new TextDecoder().decode(value);
  }

  const parsed =
    typeof normalized === 'number'
      ? normalized
      : typeof normalized === 'string' && /^-?\d+$/u.test(normalized)
        ? Number(normalized)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw new TypeError(`Redis returned an invalid ${label}.`);
  }
  return parsed;
}

function parseDecision(
  result: unknown,
  request: RateLimitRequest,
  operation: DecisionOperation,
  commandNow: number,
): RateLimitDecision {
  if (!Array.isArray(result) || result.length !== 4) {
    throw new TypeError('Redis returned an invalid rate-limit result.');
  }

  const allowedInteger = parseInteger(result[0], 'allowed flag');
  const count = parseInteger(result[1], 'count');
  const resetAt = parseInteger(result[2], 'reset timestamp');
  const remaining = parseInteger(result[3], 'remaining count');
  const minimumCount = operation === 'consume' ? 1 : 0;
  if (allowedInteger !== 0 && allowedInteger !== 1) {
    throw new TypeError('Redis returned an invalid allowed flag.');
  }
  if (
    count < minimumCount ||
    resetAt < commandNow ||
    resetAt - commandNow > MAX_WINDOW_MS ||
    remaining < 0
  ) {
    throw new TypeError('Redis returned an out-of-range rate-limit result.');
  }

  const expectedAllowed = count <= request.limit;
  const expectedRemaining = Math.max(0, request.limit - count);
  if (Boolean(allowedInteger) !== expectedAllowed || remaining !== expectedRemaining) {
    throw new TypeError('Redis returned an inconsistent rate-limit result.');
  }

  return {
    allowed: expectedAllowed,
    reason: expectedAllowed ? 'allowed' : 'limit-exceeded',
    count,
    limit: request.limit,
    remaining,
    resetAt,
  };
}

function requireReadinessResult(result: unknown): void {
  if (!Array.isArray(result) || result.length !== 5) {
    throw new TypeError('Redis returned an invalid rate-limit readiness result.');
  }
  const count = parseInteger(result[0], 'readiness count');
  const expirySet = parseInteger(result[1], 'readiness expiry result');
  const ttl = parseInteger(result[2], 'readiness TTL');
  const stored = parseInteger(result[3], 'readiness stored count');
  const deleted = parseInteger(result[4], 'readiness delete result');
  if (count !== 1 || expirySet !== 1 || ttl < 0 || ttl > 1_000 || stored !== 1 || deleted !== 1) {
    throw new TypeError('Redis failed the rate-limit readiness capability probe.');
  }
}

export class RedisFixedWindowRateLimiter implements RateLimiter {
  readonly #transport: RateLimitRedisTransport;
  readonly #secret: Uint8Array;
  readonly #redisKeyPrefix: string | undefined;
  readonly #commandTimeoutMs: number;
  readonly #maxRetries: number;
  readonly #retryDelayMs: number;
  readonly #clock: () => number;
  readonly #onBackendError: ((error: RateLimitBackendUnavailableError) => void) | undefined;
  readonly #state: MutableHealth = {
    status: 'unverified',
    consecutiveFailures: 0,
    checkedAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    errorCode: null,
  };
  #closed = false;
  #closePromise: Promise<void> | undefined;

  constructor(options: RedisFixedWindowRateLimiterOptions) {
    this.#transport = options.transport;
    this.#secret = copyRateLimitHmacSecret(options.hmacSecret);
    this.#redisKeyPrefix = options.redisKeyPrefix;
    this.#commandTimeoutMs = requireIntegerInRange(
      options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      'commandTimeoutMs',
      1,
      MAX_COMMAND_TIMEOUT_MS,
    );
    this.#maxRetries = requireIntegerInRange(
      options.maxRetries ?? DEFAULT_MAX_RETRIES,
      'maxRetries',
      0,
      MAX_RETRIES,
    );
    this.#retryDelayMs = requireIntegerInRange(
      options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
      'retryDelayMs',
      0,
      MAX_RETRY_DELAY_MS,
    );
    this.#clock = options.clock ?? Date.now;
    this.#onBackendError = options.onBackendError;
  }

  async consume(request: RateLimitRequest): Promise<RateLimitDecision> {
    return this.#decision('consume', request);
  }

  async read(request: RateLimitRequest): Promise<RateLimitDecision> {
    return this.#decision('read', request);
  }

  health(): RateLimiterHealth {
    return {
      mode: 'redis',
      status: this.#state.status,
      ready: this.#state.status === 'ready',
      consecutiveFailures: this.#state.consecutiveFailures,
      checkedAt: this.#state.checkedAt,
      lastSuccessAt: this.#state.lastSuccessAt,
      lastFailureAt: this.#state.lastFailureAt,
      errorCode: this.#state.errorCode,
    };
  }

  async readiness(): Promise<RateLimiterHealth> {
    if (this.#closed) {
      return this.health();
    }

    try {
      const redisKey = deriveRateLimitRedisKey({
        secret: this.#secret,
        namespace: 'internal:readiness',
        key: 'capability-probe',
        ...(this.#redisKeyPrefix === undefined ? {} : { prefix: this.#redisKeyPrefix }),
      });
      await this.#execute('readiness', async (signal) => {
        const result = await this.#transport.eval(
          {
            script: REDIS_RATE_LIMIT_READINESS_LUA,
            keys: [redisKey],
            arguments: ['1000'],
          },
          signal,
        );
        requireReadinessResult(result);
      });
      this.#markSuccess();
    } catch (error) {
      const unavailable = this.#asUnavailable(error, 'readiness');
      this.#markFailure(unavailable);
      this.#report(unavailable);
    }
    return this.health();
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) {
      return this.#closePromise;
    }

    this.#closed = true;
    this.#state.status = 'closed';
    this.#state.errorCode = null;
    this.#secret.fill(0);
    this.#closePromise = (async () => {
      try {
        await withTimeout(this.#commandTimeoutMs, async (signal) => {
          await this.#transport.close(signal);
        });
      } catch {
        const unavailable = new RateLimitBackendUnavailableError('close', 1);
        this.#markClosedFailure(unavailable);
        this.#report(unavailable);
        throw unavailable;
      }
    })();
    return this.#closePromise;
  }

  async #decision(
    operation: DecisionOperation,
    untrustedRequest: RateLimitRequest,
  ): Promise<RateLimitDecision> {
    if (this.#closed) {
      throw new RateLimiterClosedError();
    }
    const request = requireRateLimitRequest(untrustedRequest);
    const now = requireClockValue(this.#clock());
    const redisKey = deriveRateLimitRedisKey({
      secret: this.#secret,
      namespace: request.namespace,
      key: request.key,
      ...(this.#redisKeyPrefix === undefined ? {} : { prefix: this.#redisKeyPrefix }),
    });

    try {
      const decision = await this.#execute(operation, async (signal) => {
        const result =
          operation === 'consume'
            ? await this.#transport.eval(
                {
                  script: REDIS_FIXED_WINDOW_CONSUME_LUA,
                  keys: [redisKey],
                  arguments: [
                    request.windowMs.toString(),
                    request.limit.toString(),
                    now.toString(),
                  ],
                },
                signal,
              )
            : await this.#transport.eval(
                {
                  script: REDIS_FIXED_WINDOW_READ_LUA,
                  keys: [redisKey],
                  arguments: [
                    request.windowMs.toString(),
                    request.limit.toString(),
                    now.toString(),
                  ],
                },
                signal,
              );
        return parseDecision(result, request, operation, now);
      });
      if (this.#closed) {
        throw new RateLimiterClosedError();
      }
      this.#markSuccess();
      return decision;
    } catch (error) {
      const unavailable = this.#asUnavailable(error, operation);
      this.#markFailure(unavailable);
      this.#report(unavailable);
      throw unavailable;
    }
  }

  async #execute<T>(
    operation: RateLimitBackendOperation,
    action: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const attempts = this.#maxRetries + 1;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (this.#closed) {
        throw new RateLimiterClosedError();
      }
      try {
        return await withTimeout(this.#commandTimeoutMs, action);
      } catch {
        if (attempt < attempts && this.#retryDelayMs > 0) {
          await sleep(this.#retryDelayMs);
        }
      }
    }
    throw new RateLimitBackendUnavailableError(operation, attempts);
  }

  #asUnavailable(
    error: unknown,
    operation: RateLimitBackendOperation,
  ): RateLimitBackendUnavailableError {
    return error instanceof RateLimitBackendUnavailableError
      ? error
      : new RateLimitBackendUnavailableError(operation, this.#maxRetries + 1);
  }

  #markSuccess(): void {
    const now = requireClockValue(this.#clock());
    if (this.#closed) {
      this.#state.checkedAt = now;
      this.#state.lastSuccessAt = now;
      return;
    }
    this.#state.status = 'ready';
    this.#state.consecutiveFailures = 0;
    this.#state.checkedAt = now;
    this.#state.lastSuccessAt = now;
    this.#state.errorCode = null;
  }

  #markFailure(error: RateLimitBackendUnavailableError): void {
    const now = requireClockValue(this.#clock());
    if (this.#closed) {
      this.#state.status = 'closed';
      this.#state.consecutiveFailures += 1;
      this.#state.checkedAt = now;
      this.#state.lastFailureAt = now;
      this.#state.errorCode = error.code;
      return;
    }
    this.#state.status = 'not-ready';
    this.#state.consecutiveFailures += 1;
    this.#state.checkedAt = now;
    this.#state.lastFailureAt = now;
    this.#state.errorCode = error.code;
  }

  #markClosedFailure(error: RateLimitBackendUnavailableError): void {
    const now = requireClockValue(this.#clock());
    this.#state.status = 'closed';
    this.#state.consecutiveFailures += 1;
    this.#state.checkedAt = now;
    this.#state.lastFailureAt = now;
    this.#state.errorCode = error.code;
  }

  #report(error: RateLimitBackendUnavailableError): void {
    try {
      this.#onBackendError?.(error);
    } catch {
      // Observability hooks cannot change admission or lifecycle behavior.
    }
  }
}
