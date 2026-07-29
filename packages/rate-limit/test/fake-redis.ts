import {
  REDIS_FIXED_WINDOW_CONSUME_LUA,
  REDIS_FIXED_WINDOW_READ_LUA,
  REDIS_RATE_LIMIT_READINESS_LUA,
} from '../src/redis-script.js';
import type { RateLimitRedisTransport, RedisEvalRequest } from '../src/redis-transport.js';

interface FakeBucket {
  count: number;
  expiresAt: number | null;
}

export interface RecordedEval {
  readonly script: string;
  readonly keys: readonly string[];
  readonly arguments: readonly string[];
}

function integer(value: string | undefined, label: string): number {
  if (value === undefined || !/^\d+$/u.test(value)) {
    throw new TypeError(`Fake Redis received invalid ${label}.`);
  }
  return Number(value);
}

function aborted(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const rejectAbort = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    if (signal.aborted) {
      rejectAbort();
    } else {
      signal.addEventListener('abort', rejectAbort, { once: true });
    }
  });
}

export class FakeRedisTransport implements RateLimitRedisTransport {
  readonly evalCalls: RecordedEval[] = [];
  closeCalls = 0;
  evalFailuresRemaining = 0;
  hangEval = false;
  hangClose = false;
  nextEvalResult: unknown | undefined;
  readonly #buckets = new Map<string, FakeBucket>();
  readonly #clock: () => number;

  constructor(clock: () => number) {
    this.#clock = clock;
  }

  seedWithoutExpiry(key: string, count: number): void {
    this.#buckets.set(key, { count, expiresAt: null });
  }

  async eval(request: RedisEvalRequest, signal: AbortSignal): Promise<unknown> {
    this.evalCalls.push({
      script: request.script,
      keys: [...request.keys],
      arguments: [...request.arguments],
    });
    if (this.hangEval) {
      return aborted(signal);
    }
    if (this.evalFailuresRemaining > 0) {
      this.evalFailuresRemaining -= 1;
      throw new Error('deterministic Redis eval failure');
    }
    if (this.nextEvalResult !== undefined) {
      const result = this.nextEvalResult;
      this.nextEvalResult = undefined;
      return result;
    }
    if (request.keys.length !== 1) {
      throw new TypeError('Fake Redis expects exactly one key.');
    }
    const key = request.keys[0];
    if (key === undefined) {
      throw new TypeError('Fake Redis key is missing.');
    }
    this.#expire(key);

    if (request.script === REDIS_RATE_LIMIT_READINESS_LUA) {
      const probeTtl = integer(request.arguments[0], 'readiness TTL');
      return [1, 1, probeTtl, 1, 1];
    }
    if (request.script === REDIS_FIXED_WINDOW_CONSUME_LUA) {
      return this.#consume(key, request.arguments);
    }
    if (request.script === REDIS_FIXED_WINDOW_READ_LUA) {
      return this.#read(key, request.arguments);
    }
    throw new TypeError('Fake Redis received an unknown script.');
  }

  async close(signal: AbortSignal): Promise<void> {
    this.closeCalls += 1;
    if (this.hangClose) {
      await aborted(signal);
    }
  }

  #consume(key: string, arguments_: readonly string[]): readonly number[] {
    const windowMs = integer(arguments_[0], 'window');
    const limit = integer(arguments_[1], 'limit');
    const commandNow = integer(arguments_[2], 'clock');
    const existing = this.#buckets.get(key);
    const bucket =
      existing === undefined
        ? { count: 1, expiresAt: this.#clock() + windowMs }
        : {
            count: existing.count + 1,
            expiresAt: existing.expiresAt ?? this.#clock() + windowMs,
          };
    this.#buckets.set(key, bucket);
    return this.#result(bucket.count, bucket.expiresAt, commandNow, limit);
  }

  #read(key: string, arguments_: readonly string[]): readonly number[] {
    const windowMs = integer(arguments_[0], 'window');
    const limit = integer(arguments_[1], 'limit');
    const commandNow = integer(arguments_[2], 'clock');
    const existing = this.#buckets.get(key);
    if (existing === undefined) {
      return [1, 0, commandNow, limit];
    }
    const expiresAt = existing.expiresAt ?? this.#clock() + windowMs;
    const bucket: FakeBucket = { count: existing.count, expiresAt };
    this.#buckets.set(key, bucket);
    return this.#result(bucket.count, expiresAt, commandNow, limit);
  }

  #result(count: number, expiresAt: number, commandNow: number, limit: number): readonly number[] {
    const ttl = Math.max(0, expiresAt - this.#clock());
    return [count <= limit ? 1 : 0, count, commandNow + ttl, Math.max(0, limit - count)];
  }

  #expire(key: string): void {
    const bucket = this.#buckets.get(key);
    if (bucket !== undefined && bucket.expiresAt !== null && bucket.expiresAt <= this.#clock()) {
      this.#buckets.delete(key);
    }
  }
}
