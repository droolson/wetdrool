import { z } from 'zod';

import { assertNodeTlsVerificationPolicy } from './database-security.ts';
import { isLocalOrUnspecifiedHostname, isLoopbackHostname } from './network-security.ts';

const PUBLIC_LOCAL_RATE_LIMIT_KEY_SECRET = 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI';
const PUBLIC_LOCAL_REDIS_PASSWORD = 'local-development-only';

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const redisUrlSchema = z.preprocess(
  emptyToUndefined,
  z
    .url()
    .refine((value) => ['redis:', 'rediss:'].includes(new URL(value).protocol), {
      message: 'REDIS_URL must use redis:// or rediss://.',
    })
    .optional(),
);

const hmacSecretSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/u)
  .refine((value) => {
    const decoded = Buffer.from(value, 'base64url');
    return decoded.byteLength === 32 && decoded.toString('base64url') === value;
  }, 'must be canonical unpadded base64url for exactly 32 bytes');

const environmentSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NODE_TLS_REJECT_UNAUTHORIZED: z.string().optional(),
  RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE: z.enum(['0', '1']).default('0'),
  RATE_LIMIT_DEPLOYMENT_ID: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{0,62}$/u)
      .optional(),
  ),
  RATE_LIMIT_KEY_SECRET: z.preprocess(emptyToUndefined, hmacSecretSchema.optional()),
  REDIS_URL: redisUrlSchema,
});

export type RateLimitRuntimeConfig =
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

export function parseRateLimitRuntimeConfig(
  input: Readonly<Record<string, string | undefined>>,
  options: Readonly<{ serviceHost: string }>,
): RateLimitRuntimeConfig {
  const environment = environmentSchema.parse(input);
  const nonLocalEnvironment =
    environment.APP_ENV === 'staging' ||
    environment.APP_ENV === 'production' ||
    environment.NODE_ENV === 'production';
  const useMemoryStore = environment.RATE_LIMIT_DANGEROUSLY_USE_MEMORY_STORE === '1';
  assertNodeTlsVerificationPolicy(environment.NODE_TLS_REJECT_UNAUTHORIZED, {
    tlsRequired: nonLocalEnvironment,
  });

  if (environment.RATE_LIMIT_KEY_SECRET === undefined) {
    throw new Error('RATE_LIMIT_KEY_SECRET is required for privacy-preserving rate-limit keys.');
  }
  if (
    nonLocalEnvironment &&
    environment.RATE_LIMIT_KEY_SECRET === PUBLIC_LOCAL_RATE_LIMIT_KEY_SECRET
  ) {
    throw new Error('The public local rate-limit key secret is forbidden outside development.');
  }
  const deploymentId = environment.RATE_LIMIT_DEPLOYMENT_ID ?? 'local-development';
  if (nonLocalEnvironment && environment.RATE_LIMIT_DEPLOYMENT_ID === undefined) {
    throw new Error('RATE_LIMIT_DEPLOYMENT_ID is required outside local development.');
  }

  if (useMemoryStore) {
    if (environment.REDIS_URL !== undefined) {
      throw new Error('Memory rate limiting and REDIS_URL are mutually exclusive.');
    }
    if (nonLocalEnvironment || !isLoopbackHostname(options.serviceHost)) {
      throw new Error('The memory rate-limit store is restricted to loopback development.');
    }
    return {
      backend: 'memory',
      deploymentId,
      keySecret: environment.RATE_LIMIT_KEY_SECRET,
    };
  }

  if (environment.REDIS_URL === undefined) {
    throw new Error(
      'REDIS_URL is required unless the explicit loopback-only memory-store flag is set.',
    );
  }
  const redisUrl = new URL(environment.REDIS_URL);
  if (redisUrl.password.length === 0) {
    throw new Error('REDIS_URL must include authentication.');
  }
  if (nonLocalEnvironment) {
    if (decodeURIComponent(redisUrl.password) === PUBLIC_LOCAL_REDIS_PASSWORD) {
      throw new Error('The public local Redis password is forbidden outside development.');
    }
    if (redisUrl.protocol !== 'rediss:') {
      throw new Error('REDIS_URL must use rediss:// outside local development.');
    }
    if (isLocalOrUnspecifiedHostname(redisUrl.hostname)) {
      throw new Error('REDIS_URL must target a nonlocal endpoint outside local development.');
    }
  }

  return {
    backend: 'redis',
    deploymentId,
    keySecret: environment.RATE_LIMIT_KEY_SECRET,
    redisUrl: environment.REDIS_URL,
  };
}
