import {
  assertNoMigrationCredentials,
  assertNodeTlsVerificationPolicy,
  assertPostgresTlsPolicy,
  isLocalOrUnspecifiedHostname,
} from '@wokesocial/config';
import { parseTrustedProxyCidrs } from '@wokesocial/config/trusted-proxy';
import { networkIdSchema, solanaPublicKeySchema } from '@wokesocial/protocol';
import { z } from 'zod';

import { SOCIAL_PROTOCOL_EVENT_LAYOUT } from './anchor-events.js';

export type IndexerConfig = Readonly<{
  allowedOrigins: readonly string[];
  contentStoragePath: string;
  databaseUrl: string;
  host: string;
  port: number;
  profileSchemaV2ActivationSlot: bigint;
  trustedProxyCidrs: readonly string[];
  sync?: Readonly<{
    networkId: string;
    programId: string;
    rpcUrls: readonly string[];
    deploymentSlot: bigint;
    batchSize: number;
    pollIntervalMilliseconds: number;
    retryAttempts: number;
    retryBaseMilliseconds: number;
    retryMaximumMilliseconds: number;
    staleAfterMilliseconds: number;
  }>;
}>;

export const INDEXER_FORBIDDEN_RUNTIME_VARIABLES = [
  'DATABASE_MIGRATION_URL',
  'SESSION_SECRET',
  'SPONSOR_SIGNER_URI',
] as const;

export function removeIndexerSetupOnlyVariables(environment: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(environment)) {
    if (
      INDEXER_FORBIDDEN_RUNTIME_VARIABLES.includes(
        name as (typeof INDEXER_FORBIDDEN_RUNTIME_VARIABLES)[number],
      ) ||
      ['PGPASSWORD', 'PGPASSFILE', 'POSTGRES_PASSWORD', 'POSTGRES_PASSWORD_FILE'].includes(name) ||
      /(?:^|_)DATABASE_(?:MIGRATION|RUNTIME)_(?:PASSWORD|URL)$/u.test(name) ||
      (/(?:^|_)DATABASE_URL$/u.test(name) && name !== 'DATABASE_URL')
    ) {
      Reflect.deleteProperty(environment, name);
    }
  }
}

const INDEXER_NONLOCAL_FORBIDDEN_RUNTIME_VARIABLES = [
  'AUTH_DATABASE_URL',
  'MEDIA_WORKER_STATIC_BEARER_TOKEN',
  'MODERATION_DATABASE_URL',
  'MODERATION_DATA_KEYS',
  'PGPASSWORD',
  'POSTGRES_PASSWORD',
  'RELAY_KEY_AUTHORIZER_BEARER_TOKEN',
  'RELAY_SUBSCRIPTION_AUTHORIZER_BEARER_TOKEN',
] as const;

export function readIndexerConfig(environment: NodeJS.ProcessEnv = process.env): IndexerConfig {
  assertNoMigrationCredentials(environment, { allowedRuntimeUrls: ['DATABASE_URL'] });
  for (const [retiredName, replacementName] of [
    ['WOKENET_COMMITMENT', 'SOLANA_COMMITMENT'],
    ['WOKENET_RPC_URLS', 'SOLANA_RPC_URLS'],
  ] as const) {
    if (nonEmpty(environment[retiredName]) !== undefined) {
      throw new Error(`${retiredName} has been retired; use ${replacementName}.`);
    }
  }
  for (const name of INDEXER_FORBIDDEN_RUNTIME_VARIABLES.slice(1)) {
    if (nonEmpty(environment[name]) !== undefined) {
      throw new Error(`${name} must not be injected into the long-running indexer runtime.`);
    }
  }
  const parsed = indexerEnvironmentSchema.parse(environment);
  const nonlocalDeployment = parsed.APP_ENV === 'staging' || parsed.APP_ENV === 'production';
  if (nonlocalDeployment) {
    for (const [name, value] of Object.entries(environment)) {
      if (
        nonEmpty(value) !== undefined &&
        (INDEXER_NONLOCAL_FORBIDDEN_RUNTIME_VARIABLES.includes(
          name as (typeof INDEXER_NONLOCAL_FORBIDDEN_RUNTIME_VARIABLES)[number],
        ) ||
          /(?:^|_)DATABASE_RUNTIME_PASSWORD$/u.test(name))
      ) {
        throw new Error(
          `${name} must not be injected into a nonlocal long-running indexer runtime.`,
        );
      }
    }
  }
  if (nonlocalDeployment !== (parsed.NODE_ENV === 'production')) {
    throw new Error(
      'Indexer NODE_ENV must be production exactly when APP_ENV selects staging or production.',
    );
  }
  assertNodeTlsVerificationPolicy(parsed.NODE_TLS_REJECT_UNAUTHORIZED, {
    tlsRequired: nonlocalDeployment,
  });
  assertPostgresTlsPolicy(parsed.DATABASE_URL, {
    tlsRequired: nonlocalDeployment,
    variableName: 'DATABASE_URL',
  });

  const allowedOrigins = parseUrlList(parsed.ALLOWED_ORIGINS, 'ALLOWED_ORIGINS');
  const rpcUrls = parseUrlList(parsed.SOLANA_RPC_URLS, 'SOLANA_RPC_URLS');
  if (nonlocalDeployment) {
    if (isLocalOrUnspecifiedHostname(new URL(parsed.DATABASE_URL).hostname)) {
      throw new Error('Nonlocal indexer DATABASE_URL must not target a local endpoint.');
    }
    for (const origin of allowedOrigins) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || isLocalOrUnspecifiedHostname(url.hostname)) {
        throw new Error(
          'Nonlocal indexer ALLOWED_ORIGINS must contain only nonlocal HTTPS origins.',
        );
      }
    }
    for (const rpcUrl of rpcUrls) {
      const url = new URL(rpcUrl);
      if (url.protocol !== 'https:' || isLocalOrUnspecifiedHostname(url.hostname)) {
        throw new Error(
          'Nonlocal indexer SOLANA_RPC_URLS must contain only nonlocal HTTPS endpoints.',
        );
      }
    }
  }

  const networkId = nonEmpty(parsed.INDEXER_NETWORK_ID);
  const explicitProgramId = nonEmpty(parsed.NEXT_PUBLIC_PROGRAM_ID);
  if ((networkId === undefined) !== (explicitProgramId === undefined)) {
    throw new Error('INDEXER_NETWORK_ID and NEXT_PUBLIC_PROGRAM_ID must be configured together.');
  }
  if (nonlocalDeployment && networkId === undefined) {
    throw new Error(
      'INDEXER_NETWORK_ID and NEXT_PUBLIC_PROGRAM_ID are required in staging and production.',
    );
  }
  const sync =
    networkId === undefined || explicitProgramId === undefined
      ? undefined
      : syncEnvironmentSchema.parse({
          networkId,
          programId: explicitProgramId,
          rpcUrls,
          deploymentSlot: parsed.INDEXER_DEPLOYMENT_SLOT,
          batchSize: parsed.INDEXER_BATCH_SIZE,
          commitment: parsed.SOLANA_COMMITMENT,
          pollIntervalMilliseconds: parsed.INDEXER_POLL_INTERVAL_MS,
          retryAttempts: parsed.INDEXER_RETRY_ATTEMPTS,
          retryBaseMilliseconds: parsed.INDEXER_RETRY_BASE_MS,
          retryMaximumMilliseconds: parsed.INDEXER_RETRY_MAX_MS,
          staleAfterMilliseconds: parsed.INDEXER_SYNC_STALE_AFTER_MS,
        });
  return {
    allowedOrigins,
    contentStoragePath: parsed.CONTENT_STORAGE_PATH,
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.INDEXER_HOST,
    port: parsed.INDEXER_PORT,
    profileSchemaV2ActivationSlot: BigInt(parsed.INDEXER_PROFILE_V2_ACTIVATION_SLOT),
    trustedProxyCidrs: parseTrustedProxyCidrs(environment['TRUSTED_PROXY_CIDRS']),
    ...(sync === undefined
      ? {}
      : {
          sync: {
            ...sync,
            deploymentSlot: BigInt(sync.deploymentSlot),
          },
        }),
  };
}

const postgresUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'postgres:' || protocol === 'postgresql:';
}, 'DATABASE_URL must use PostgreSQL.');

const indexerEnvironmentSchema = z.object({
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  CONTENT_STORAGE_PATH: z.string().min(1).default('.local/content'),
  DATABASE_URL: postgresUrlSchema.default(
    'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial',
  ),
  INDEXER_BATCH_SIZE: z.coerce.number().int().min(1).max(1_000).default(100),
  INDEXER_DEPLOYMENT_SLOT: z.coerce.number().int().nonnegative().default(0),
  INDEXER_HOST: z.string().min(1).default('127.0.0.1'),
  INDEXER_NETWORK_ID: z.string().optional(),
  INDEXER_PROFILE_V2_ACTIVATION_SLOT: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(Number.MAX_SAFE_INTEGER)
    .default(0),
  INDEXER_POLL_INTERVAL_MS: z.string().optional(),
  INDEXER_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  INDEXER_RETRY_ATTEMPTS: z.string().optional(),
  INDEXER_RETRY_BASE_MS: z.string().optional(),
  INDEXER_RETRY_MAX_MS: z.string().optional(),
  INDEXER_SYNC_STALE_AFTER_MS: z.string().optional(),
  NEXT_PUBLIC_PROGRAM_ID: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  NODE_TLS_REJECT_UNAUTHORIZED: z.string().optional(),
  SOLANA_COMMITMENT: z.literal('finalized').default('finalized'),
  SOLANA_RPC_URLS: z.string().default('http://127.0.0.1:8899'),
});

const syncEnvironmentSchema = z
  .object({
    networkId: networkIdSchema,
    programId: solanaPublicKeySchema,
    rpcUrls: z.array(z.url()).min(1),
    deploymentSlot: z.number().int().nonnegative(),
    batchSize: z.number().int().min(1).max(1_000),
    commitment: z.literal('finalized'),
    pollIntervalMilliseconds: z.coerce.number().int().min(100).max(300_000).default(2_000),
    retryAttempts: z.coerce.number().int().min(1).max(10).default(3),
    retryBaseMilliseconds: z.coerce.number().int().min(1).max(60_000).default(250),
    retryMaximumMilliseconds: z.coerce.number().int().min(1).max(3_600_000).default(60_000),
    staleAfterMilliseconds: z.coerce.number().int().min(1_000).max(3_600_000).default(30_000),
  })
  .superRefine((value, context) => {
    const programId = value.networkId.split(':').at(-1);
    if (programId !== value.programId) {
      context.addIssue({
        code: 'custom',
        path: ['networkId'],
        message: 'network program ID must match NEXT_PUBLIC_PROGRAM_ID',
      });
    }
    if (value.programId !== SOCIAL_PROTOCOL_EVENT_LAYOUT.programId) {
      context.addIssue({
        code: 'custom',
        path: ['programId'],
        message: 'must match the program ID in the checked-in Anchor event layout',
      });
    }
    if (value.retryBaseMilliseconds > value.retryMaximumMilliseconds) {
      context.addIssue({
        code: 'custom',
        path: ['retryMaximumMilliseconds'],
        message: 'must be greater than or equal to INDEXER_RETRY_BASE_MS',
      });
    }
    if (value.staleAfterMilliseconds <= value.pollIntervalMilliseconds) {
      context.addIssue({
        code: 'custom',
        path: ['staleAfterMilliseconds'],
        message: 'must be greater than INDEXER_POLL_INTERVAL_MS',
      });
    }
  });

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}

function parseUrlList(value: string, variableName: 'ALLOWED_ORIGINS' | 'SOLANA_RPC_URLS') {
  const values = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (values.length === 0) {
    throw new Error(`${variableName} must contain at least one URL.`);
  }
  return values.map((item) => {
    let url: URL;
    try {
      url = new URL(item);
    } catch {
      throw new Error(`${variableName} must contain only valid URLs.`);
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error(`${variableName} must contain only HTTP(S) URLs.`);
    }
    if (url.username || url.password) {
      throw new Error(`${variableName} must not contain URL credentials.`);
    }
    if (variableName === 'ALLOWED_ORIGINS' && (url.pathname !== '/' || url.search || url.hash)) {
      throw new Error('ALLOWED_ORIGINS must contain origins without paths, queries, or fragments.');
    }
    return variableName === 'ALLOWED_ORIGINS' ? url.origin : item;
  });
}
