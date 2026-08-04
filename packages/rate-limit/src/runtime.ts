import { createClient } from 'redis';

import { RateLimitBackendUnavailableError, type RateLimitBackendOperation } from './errors.js';
import { createExplicitMemoryRateLimiter } from './memory-limiter.js';
import { RedisFixedWindowRateLimiter } from './redis-limiter.js';
import type { RateLimitRedisTransport } from './redis-transport.js';
import type {
  RateLimitDecision,
  RateLimiter,
  RateLimiterHealth,
  RateLimitRequest,
} from './types.js';

const CONNECT_TIMEOUT_MS = 2_000;
const STARTUP_TIMEOUT_MS = 5_000;
const COMMAND_TIMEOUT_MS = 500;
const MAX_QUEUED_COMMANDS = 128;
const SOCKET_TIMEOUT_MS = 5_000;
const PING_INTERVAL_MS = 2_000;
const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;

export type RuntimeRateLimiterConfig =
  | Readonly<{
      backend: 'memory';
      deploymentId: string;
      keySecret: string;
    }>
  | Readonly<{
      backend: 'redis';
      deploymentId: string;
      keySecret: string;
      redisUrl: string;
    }>;

export interface RuntimeRateLimiterOptions {
  readonly config: RuntimeRateLimiterConfig;
  readonly serviceId: string;
  /**
   * Privacy-safe signal only. Raw Redis errors and connection URLs are never
   * passed to application loggers.
   */
  readonly onBackendError?: (
    event: Readonly<{
      code: string;
      operation: RateLimitBackendOperation;
      attempts: number;
    }>,
  ) => void;
}

export async function createRuntimeRateLimiter(
  options: RuntimeRateLimiterOptions,
): Promise<RateLimiter> {
  const config = options.config;
  requireIdentifier(config.deploymentId, 'deploymentId');
  requireIdentifier(options.serviceId, 'serviceId');
  requireCanonicalSecret(config.keySecret);
  const baseLimiter =
    config.backend === 'memory'
      ? createExplicitMemoryRateLimiter({ unsafeAllowMemory: true })
      : await createRedisLimiter(config, options.serviceId, options.onBackendError);
  return new DeploymentRateLimiter(baseLimiter, config.deploymentId);
}

class DeploymentRateLimiter implements RateLimiter {
  readonly #delegate: RateLimiter;
  readonly #namespacePrefix: string;

  constructor(delegate: RateLimiter, deploymentId: string) {
    this.#delegate = delegate;
    this.#namespacePrefix = `deployment:${deploymentId}:`;
  }

  consume(request: RateLimitRequest): Promise<RateLimitDecision> {
    return this.#delegate.consume(this.#request(request));
  }

  read(request: RateLimitRequest): Promise<RateLimitDecision> {
    return this.#delegate.read(this.#request(request));
  }

  readiness(): Promise<RateLimiterHealth> {
    return this.#delegate.readiness();
  }

  health(): RateLimiterHealth {
    return this.#delegate.health();
  }

  close(): Promise<void> {
    return this.#delegate.close();
  }

  #request(request: RateLimitRequest): RateLimitRequest {
    return {
      ...request,
      namespace: `${this.#namespacePrefix}${request.namespace}`,
    };
  }
}

async function createRedisLimiter(
  config: Extract<RuntimeRateLimiterConfig, { backend: 'redis' }>,
  serviceId: string,
  onBackendError: RuntimeRateLimiterOptions['onBackendError'],
): Promise<RateLimiter> {
  const client = createClient({
    url: config.redisUrl,
    name: `wetdrool-rate-limit:${config.deploymentId}:${serviceId}`,
    commandsQueueMaxLength: MAX_QUEUED_COMMANDS,
    disableOfflineQueue: true,
    pingInterval: PING_INTERVAL_MS,
    socket: {
      connectTimeout: CONNECT_TIMEOUT_MS,
      reconnectStrategy: (retries) => Math.min(50 * 2 ** Math.min(retries, 5), 1_000),
      socketTimeout: SOCKET_TIMEOUT_MS,
    },
  });
  client.on('error', () => {
    // node-redis requires an error listener. Request/readiness paths report a
    // stable sanitized error once admission has failed closed.
  });

  try {
    await connectWithinStartupWindow(client);
  } catch {
    if (client.isOpen) {
      client.destroy();
    }
    const unavailable = new RateLimitBackendUnavailableError('readiness', 1);
    reportBackendError(onBackendError, unavailable);
    throw unavailable;
  }

  const transport: RateLimitRedisTransport = {
    eval: (request, signal) => {
      if (!client.isReady) {
        return Promise.reject(new Error('The Redis client is not ready.'));
      }
      return client
        .withCommandOptions({
          abortSignal: signal,
          timeout: COMMAND_TIMEOUT_MS,
        })
        .eval(request.script, {
          keys: [...request.keys],
          arguments: [...request.arguments],
        });
    },
    close: async () => {
      if (client.isOpen) {
        client.destroy();
      }
    },
  };
  const secret = Buffer.from(config.keySecret, 'base64url');
  const limiter = (() => {
    try {
      return new RedisFixedWindowRateLimiter({
        transport,
        hmacSecret: secret,
        redisKeyPrefix: `wetdrool:rate-limit:v1:${config.deploymentId}:${serviceId}`,
        commandTimeoutMs: COMMAND_TIMEOUT_MS,
        maxRetries: 1,
        retryDelayMs: 25,
        onBackendError: (error) => reportBackendError(onBackendError, error),
      });
    } finally {
      secret.fill(0);
    }
  })();

  const health = await limiter.readiness();
  if (!health.ready) {
    await limiter.close().catch(() => undefined);
    throw new RateLimitBackendUnavailableError('readiness', 1);
  }
  return limiter;
}

async function connectWithinStartupWindow(
  client: Readonly<{
    connect(): Promise<unknown>;
    readonly isOpen: boolean;
    destroy(): void;
  }>,
): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.connect().then(() => undefined),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          if (client.isOpen) {
            client.destroy();
          }
          reject(new Error('Redis startup connection timed out.'));
        }, STARTUP_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function reportBackendError(
  reporter: RuntimeRateLimiterOptions['onBackendError'],
  error: RateLimitBackendUnavailableError,
): void {
  try {
    reporter?.({
      code: error.code,
      operation: error.operation,
      attempts: error.attempts,
    });
  } catch {
    // Observability cannot affect admission or lifecycle behavior.
  }
}

function requireIdentifier(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new TypeError(`${label} must be a bounded lowercase deployment identifier.`);
  }
}

function requireCanonicalSecret(value: string): void {
  const decoded = Buffer.from(value, 'base64url');
  try {
    if (decoded.byteLength !== 32 || decoded.toString('base64url') !== value) {
      throw new TypeError('keySecret must be canonical unpadded base64url for exactly 32 bytes.');
    }
  } finally {
    decoded.fill(0);
  }
}
