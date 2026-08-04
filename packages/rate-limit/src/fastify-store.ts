import { createHash } from 'node:crypto';

import type { RateLimiter } from './types.js';
import { requireBoundedString, requireClockValue, requireIntegerInRange } from './validation.js';

export interface FastifyRateLimitStoreResult {
  readonly current: number;
  readonly ttl: number;
}

export type FastifyRateLimitStoreCallback = (
  error: Error | null,
  result?: FastifyRateLimitStoreResult,
) => void;

/**
 * Structurally compatible with the @fastify/rate-limit 10.3+ custom-store
 * contract, including the 11.1 runtime's optional non-mutating `read` extension.
 */
export interface WetDroolFastifyRateLimitStore {
  incr(
    key: string,
    callback: FastifyRateLimitStoreCallback,
    timeWindow?: number,
    max?: number,
  ): void;
  read(
    key: string,
    callback: FastifyRateLimitStoreCallback,
    timeWindow?: number,
    max?: number,
  ): void;
  child(routeOptions: unknown): WetDroolFastifyRateLimitStore;
}

export type WetDroolFastifyRateLimitStoreConstructor = new (
  options: unknown,
) => WetDroolFastifyRateLimitStore;

export interface FastifyRateLimitStoreFactoryOptions {
  readonly limiter: RateLimiter;
  readonly namespace: string;
  readonly clock?: () => number;
}

function scalar(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => scalar(item)).join(',');
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return String(value);
  }
  return '';
}

function property(record: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

function routeFingerprint(routeOptions: unknown): string {
  const top =
    typeof routeOptions === 'object' && routeOptions !== null
      ? (routeOptions as Record<string, unknown>)
      : {};
  const routeInfoValue = property(top, 'routeInfo');
  const routeInfo =
    typeof routeInfoValue === 'object' && routeInfoValue !== null
      ? (routeInfoValue as Record<string, unknown>)
      : {};
  const fields = [
    scalar(property(routeInfo, 'method') ?? property(top, 'method')),
    scalar(
      property(routeInfo, 'url') ??
        property(routeInfo, 'path') ??
        property(top, 'url') ??
        property(top, 'path'),
    ),
    scalar(property(routeInfo, 'prefix') ?? property(top, 'prefix')),
    scalar(property(top, 'groupId')),
  ];
  return createHash('sha256').update(JSON.stringify(fields)).digest('base64url');
}

/**
 * Returns the constructor shape expected by Fastify's `store` option.
 *
 * Keep `skipOnError` false (the plugin default): typed backend failures then
 * preserve their 503 status, while a real `current > max` remains a 429.
 */
export function createFastifyRateLimitStore(
  options: FastifyRateLimitStoreFactoryOptions,
): WetDroolFastifyRateLimitStoreConstructor {
  const limiter = options.limiter;
  const baseNamespace = requireBoundedString(options.namespace, 'namespace', 384);
  const clock = options.clock ?? Date.now;

  class SharedRateLimitStore implements WetDroolFastifyRateLimitStore {
    readonly #namespace: string;

    constructor(_pluginOptions: unknown, namespace = baseNamespace) {
      this.#namespace = namespace;
    }

    incr(
      key: string,
      callback: FastifyRateLimitStoreCallback,
      timeWindow?: number,
      max?: number,
    ): void {
      this.#run('consume', key, callback, timeWindow, max);
    }

    read(
      key: string,
      callback: FastifyRateLimitStoreCallback,
      timeWindow?: number,
      max?: number,
    ): void {
      this.#run('read', key, callback, timeWindow, max);
    }

    child(routeOptions: unknown): WetDroolFastifyRateLimitStore {
      const childNamespace = `${this.#namespace}:route:${routeFingerprint(routeOptions)}`;
      return new SharedRateLimitStore(undefined, childNamespace);
    }

    #run(
      operation: 'consume' | 'read',
      key: string,
      callback: FastifyRateLimitStoreCallback,
      timeWindow?: number,
      max?: number,
    ): void {
      let settled = false;
      const finish = (error: Error | null, result?: FastifyRateLimitStoreResult): void => {
        if (settled) {
          return;
        }
        settled = true;
        callback(error, result);
      };
      const asError = (error: unknown): Error =>
        error instanceof Error ? error : new Error('Rate-limit store failure.');

      try {
        if (timeWindow === undefined || max === undefined) {
          throw new TypeError('Fastify must supply timeWindow and max to the rate-limit store.');
        }
        const promise = limiter[operation]({
          namespace: this.#namespace,
          key,
          limit: max,
          windowMs: timeWindow,
        });
        void promise
          .then(
            (decision) => {
              try {
                const now = requireClockValue(clock());
                const resetAt = requireIntegerInRange(
                  decision.resetAt,
                  'resetAt',
                  0,
                  Number.MAX_SAFE_INTEGER,
                );
                const ttl = requireIntegerInRange(
                  Math.max(0, resetAt - now),
                  'ttl',
                  0,
                  Number.MAX_SAFE_INTEGER,
                );
                finish(null, {
                  current: decision.count,
                  ttl,
                });
              } catch (error) {
                finish(asError(error));
              }
            },
            (error: unknown) => {
              finish(asError(error));
            },
          )
          .catch(() => {
            // A Fastify callback exception cannot trigger a second callback.
          });
      } catch (error) {
        finish(asError(error));
      }
    }
  }

  return SharedRateLimitStore;
}
