import { z } from 'zod';

import { assertNoMigrationCredentials, isLocalOrUnspecifiedHostname } from '@wetdrool/config';
import { parseTrustedProxyCidrs } from '@wetdrool/config/trusted-proxy';

const legacyRedirectHostnames = new Set(['droolhouse.com', 'www.droolhouse.com']);

function isLegacyRedirectHostname(hostname: string): boolean {
  return legacyRedirectHostnames.has(hostname.toLowerCase().replace(/\.+$/u, ''));
}

const originSchema = z
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return (
      ['http:', 'https:'].includes(parsed.protocol) &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === '' &&
      !isLegacyRedirectHostname(parsed.hostname)
    );
  }, 'Feed CORS origins must be credential-free HTTP(S) origins and cannot use the legacy redirect host.')
  .transform((value) => new URL(value).origin);

const environmentSchema = z.strictObject({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  FEED_SERVICE_HOST: z.string().trim().min(1).default('127.0.0.1'),
  FEED_SERVICE_PORT: z.coerce.number().int().min(1).max(65_535).default(4100),
  FEED_SERVICE_CORS_ORIGINS: z.string().default(''),
  TRUSTED_PROXY_CIDRS: z.string().optional(),
});

export interface FeedServiceConfig {
  readonly host: string;
  readonly port: number;
  readonly allowedOrigins: readonly string[];
  readonly trustedProxyCidrs: readonly string[];
}

export function parseFeedServiceConfig(
  environment: Readonly<Record<string, string | undefined>>,
): FeedServiceConfig {
  assertNoMigrationCredentials(environment);
  const parsed = environmentSchema.parse({
    APP_ENV: environment.APP_ENV,
    NODE_ENV: environment.NODE_ENV,
    FEED_SERVICE_HOST: environment.FEED_SERVICE_HOST,
    FEED_SERVICE_PORT: environment.FEED_SERVICE_PORT,
    FEED_SERVICE_CORS_ORIGINS: environment.FEED_SERVICE_CORS_ORIGINS,
    TRUSTED_PROXY_CIDRS: environment.TRUSTED_PROXY_CIDRS,
  });
  const nonLocalEnvironment =
    parsed.APP_ENV === 'staging' ||
    parsed.APP_ENV === 'production' ||
    parsed.NODE_ENV === 'production';
  const allowedOrigins = [
    ...new Set(
      parsed.FEED_SERVICE_CORS_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
        .map((origin) => originSchema.parse(origin)),
    ),
  ];
  if (
    nonLocalEnvironment &&
    allowedOrigins.some((origin) => {
      const url = new URL(origin);
      return url.protocol !== 'https:' || isLocalOrUnspecifiedHostname(url.hostname);
    })
  ) {
    throw new Error('Feed CORS origins must use non-local HTTPS outside local development.');
  }
  return {
    host: parsed.FEED_SERVICE_HOST,
    port: parsed.FEED_SERVICE_PORT,
    allowedOrigins,
    trustedProxyCidrs: parseTrustedProxyCidrs(parsed.TRUSTED_PROXY_CIDRS),
  };
}
