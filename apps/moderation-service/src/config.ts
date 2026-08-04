import { z } from 'zod';

import {
  assertNodeTlsVerificationPolicy,
  assertNoMigrationCredentials,
  assertPostgresTlsPolicy,
  isLocalOrUnspecifiedHostname,
  isLoopbackHostname,
} from '@wetdrool/config';
import { parseTrustedProxyCidrs } from '@wetdrool/config/trusted-proxy';

import { parseModerationKeyRingJson } from './encryption.js';

const LEGACY_REDIRECT_HOSTS = new Set(['droolhouse.com', 'www.droolhouse.com']);
const PUBLIC_LOCAL_MODERATION_DATA_KEY = new Uint8Array(32).fill(1);
const originSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
  const hostname = url.hostname.toLowerCase().replace(/\.+$/u, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Allowed origins must be credential-free HTTP(S) origins without a path.',
    });
  }
  if (LEGACY_REDIRECT_HOSTS.has(hostname)) {
    context.addIssue({
      code: 'custom',
      message: 'The legacy redirect hostname cannot be an application origin.',
    });
  }
});
const databaseUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'postgres:' || protocol === 'postgresql:';
}, 'Database URL must use PostgreSQL.');

export function parseModerationConfig(input: NodeJS.ProcessEnv = process.env) {
  assertNoMigrationCredentials(input, {
    allowedRuntimeUrls: ['MODERATION_DATABASE_URL'],
  });
  const environment = z
    .object({
      APP_ENV: z.enum(['development', 'test', 'staging', 'production']).optional(),
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      NODE_TLS_REJECT_UNAUTHORIZED: z.string().optional(),
      MODERATION_HOST: z.string().min(1).default('127.0.0.1'),
      MODERATION_PORT: z.coerce.number().int().min(1).max(65_535).default(4400),
      MODERATION_ALLOWED_ORIGINS: z.string().default(''),
      MODERATION_DATABASE_URL: databaseUrlSchema.optional(),
      MODERATION_DATA_KEYS: z.string().min(1).optional(),
      MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: z.enum(['0', '1']).default('0'),
      MODERATION_MAINTENANCE_INTERVAL_MS: z.coerce
        .number()
        .int()
        .min(60_000)
        .max(86_400_000)
        .default(300_000),
      MODERATION_DUE_ACTION_BATCH_SIZE: z.coerce.number().int().min(1).max(5_000).default(500),
      MODERATION_RETENTION_BATCH_SIZE: z.coerce.number().int().min(1).max(5_000).default(100),
      MODERATION_CLOSED_CASE_RETENTION_MS: z.coerce
        .number()
        .int()
        .min(86_400_000)
        .max(10 * 365 * 86_400_000)
        .default(365 * 86_400_000),
      MODERATION_TRANSPARENCY_MINIMUM_CELL_SIZE: z.coerce.number().int().min(3).max(100).default(5),
      TRUSTED_PROXY_CIDRS: z.string().optional(),
    })
    .parse(input);
  const deploymentPolicy =
    environment.APP_ENV === 'staging' ||
    environment.APP_ENV === 'production' ||
    environment.NODE_ENV === 'production'
      ? 'nonlocal'
      : 'local';
  const databaseTlsRequired = deploymentPolicy === 'nonlocal';
  assertNodeTlsVerificationPolicy(environment.NODE_TLS_REJECT_UNAUTHORIZED, {
    tlsRequired: databaseTlsRequired,
  });
  const allowedOrigins = environment.MODERATION_ALLOWED_ORIGINS.split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => new URL(originSchema.parse(value)).origin);
  if (new Set(allowedOrigins).size !== allowedOrigins.length) {
    throw new Error('Moderation allowed origins must be unique.');
  }
  if (
    deploymentPolicy === 'nonlocal' &&
    allowedOrigins.some((value) => {
      const url = new URL(value);
      return url.protocol !== 'https:' || isLocalOrUnspecifiedHostname(url.hostname);
    })
  ) {
    throw new Error('Staging and production moderation origins must use nonlocal HTTPS endpoints.');
  }
  const dangerouslyAllowUnverifiedLocalMode =
    environment.MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE === '1';
  if (databaseTlsRequired && dangerouslyAllowUnverifiedLocalMode) {
    throw new Error('Unverified moderation authorization is forbidden in production and staging.');
  }
  if (dangerouslyAllowUnverifiedLocalMode && !isLoopbackHostname(environment.MODERATION_HOST)) {
    throw new Error('Unverified moderation authorization is restricted to loopback.');
  }
  if (
    (environment.MODERATION_DATABASE_URL === undefined) !==
    (environment.MODERATION_DATA_KEYS === undefined)
  ) {
    throw new Error(
      'MODERATION_DATABASE_URL and MODERATION_DATA_KEYS must be configured together.',
    );
  }
  if (environment.MODERATION_DATABASE_URL !== undefined) {
    assertPostgresTlsPolicy(environment.MODERATION_DATABASE_URL, {
      tlsRequired: databaseTlsRequired,
      variableName: 'MODERATION_DATABASE_URL',
    });
  }
  const keyRing =
    environment.MODERATION_DATA_KEYS === undefined
      ? undefined
      : parseModerationKeyRingJson(
          environment.MODERATION_DATA_KEYS,
          deploymentPolicy === 'nonlocal'
            ? { forbiddenKeys: [PUBLIC_LOCAL_MODERATION_DATA_KEY] }
            : {},
        );

  return {
    deploymentPolicy,
    host: environment.MODERATION_HOST,
    port: environment.MODERATION_PORT,
    allowedOrigins,
    databaseUrl: environment.MODERATION_DATABASE_URL,
    keyRing,
    dangerouslyAllowUnverifiedLocalMode,
    maintenanceIntervalMs: environment.MODERATION_MAINTENANCE_INTERVAL_MS,
    maintenance: {
      dueActionLimit: environment.MODERATION_DUE_ACTION_BATCH_SIZE,
      retentionLimit: environment.MODERATION_RETENTION_BATCH_SIZE,
      closedCaseRetentionMs: environment.MODERATION_CLOSED_CASE_RETENTION_MS,
    },
    transparencyMinimumCellSize: environment.MODERATION_TRANSPARENCY_MINIMUM_CELL_SIZE,
    trustedProxyCidrs: parseTrustedProxyCidrs(environment.TRUSTED_PROXY_CIDRS),
  } as const;
}
