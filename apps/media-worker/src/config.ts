import { resolve } from 'node:path';

import { z } from 'zod';

import { assertNoMigrationCredentials, isLocalOrUnspecifiedHostname } from '@wetdrool/config';
import { parseTrustedProxyCidrs } from '@wetdrool/config/trusted-proxy';

import { maximumUploadBytes } from './schemas.js';
import { assertStrongEncodedToken } from './static-bearer-authorization.js';

const legacyRedirectHostnames = new Set(['droolhouse.com', 'www.droolhouse.com']);
const localExampleBearerToken = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

function isLegacyRedirectHostname(hostname: string): boolean {
  return legacyRedirectHostnames.has(hostname.toLowerCase().replace(/\.+$/u, ''));
}

export const mediaWorkerOriginSchema = z
  .url()
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol))
  .refine((value) => {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !isLegacyRedirectHostname(url.hostname)
    );
  }, 'Allowed origins must be credential-free HTTP(S) origins and cannot use the legacy redirect host.')
  .transform((value) => new URL(value).origin);

export function parseMediaWorkerConfig(input: NodeJS.ProcessEnv = process.env) {
  assertNoMigrationCredentials(input);
  const environment = z
    .object({
      APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      MEDIA_WORKER_HOST: z.string().min(1).default('127.0.0.1'),
      MEDIA_WORKER_PORT: z.coerce.number().int().min(1).max(65_535).default(4500),
      MEDIA_WORKER_ALLOWED_ORIGINS: z.string().default(''),
      MEDIA_WORKER_STAGING_ROOT: z.string().min(1).default('.local/media-worker/staging'),
      MEDIA_WORKER_TEMPORARY_ROOT: z.string().min(1).default('.local/media-worker/temporary'),
      MEDIA_WORKER_STORAGE_ROOT: z.string().min(1).default('.local/media-worker/cas'),
      MEDIA_WORKER_CLAMD_HOST: z.string().min(1),
      MEDIA_WORKER_CLAMD_PORT: z.coerce.number().int().min(1).max(65_535).default(3310),
      MEDIA_WORKER_CLAMD_CONNECT_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(1)
        .max(60_000)
        .default(5_000),
      MEDIA_WORKER_CLAMD_SCAN_TIMEOUT_MS: z.coerce
        .number()
        .int()
        .min(1)
        .max(299_000)
        .default(120_000),
      MEDIA_WORKER_CLAMD_STREAM_MAX_BYTES: z.coerce
        .number()
        .int()
        .min(maximumUploadBytes)
        .max(2_000_000_000)
        .default(maximumUploadBytes),
      MEDIA_WORKER_CLAMD_MAX_DATABASE_AGE_MS: z.coerce
        .number()
        .int()
        .min(60 * 60 * 1_000)
        .max(30 * 24 * 60 * 60 * 1_000)
        .default(3 * 24 * 60 * 60 * 1_000),
      MEDIA_WORKER_STATIC_BEARER_TOKEN: z.string().min(1).max(171),
      MEDIA_WORKER_CLEANUP_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(60_000)
        .max(24 * 60 * 60 * 1_000)
        .default(15 * 60 * 1_000),
      TRUSTED_PROXY_CIDRS: z.string().optional(),
    })
    .parse(input);
  assertStrongEncodedToken(environment.MEDIA_WORKER_STATIC_BEARER_TOKEN);
  const allowedOrigins = environment.MEDIA_WORKER_ALLOWED_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => mediaWorkerOriginSchema.parse(value));
  const nonLocalEnvironment =
    environment.APP_ENV === 'staging' ||
    environment.APP_ENV === 'production' ||
    environment.NODE_ENV === 'production';
  if (
    nonLocalEnvironment &&
    environment.MEDIA_WORKER_STATIC_BEARER_TOKEN === localExampleBearerToken
  ) {
    throw new Error('The public local media token is forbidden outside local development.');
  }
  if (
    nonLocalEnvironment &&
    allowedOrigins.some((value) => {
      const url = new URL(value);
      return url.protocol !== 'https:' || isLocalOrUnspecifiedHostname(url.hostname);
    })
  ) {
    throw new Error('Nonlocal media-worker origins must use non-local HTTPS.');
  }
  return {
    host: environment.MEDIA_WORKER_HOST,
    port: environment.MEDIA_WORKER_PORT,
    allowedOrigins,
    stagingRoot: resolve(environment.MEDIA_WORKER_STAGING_ROOT),
    temporaryRoot: resolve(environment.MEDIA_WORKER_TEMPORARY_ROOT),
    storageRoot: resolve(environment.MEDIA_WORKER_STORAGE_ROOT),
    clamdHost: environment.MEDIA_WORKER_CLAMD_HOST,
    clamdPort: environment.MEDIA_WORKER_CLAMD_PORT,
    clamdConnectTimeoutMilliseconds: environment.MEDIA_WORKER_CLAMD_CONNECT_TIMEOUT_MS,
    clamdScanTimeoutMilliseconds: environment.MEDIA_WORKER_CLAMD_SCAN_TIMEOUT_MS,
    clamdStreamMaximumBytes: environment.MEDIA_WORKER_CLAMD_STREAM_MAX_BYTES,
    clamdMaximumDatabaseAgeMilliseconds: environment.MEDIA_WORKER_CLAMD_MAX_DATABASE_AGE_MS,
    staticBearerToken: environment.MEDIA_WORKER_STATIC_BEARER_TOKEN,
    cleanupIntervalMilliseconds: environment.MEDIA_WORKER_CLEANUP_INTERVAL_MS,
    trustedProxyCidrs: parseTrustedProxyCidrs(environment.TRUSTED_PROXY_CIDRS),
  } as const;
}
