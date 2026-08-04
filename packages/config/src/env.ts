import { z } from 'zod';

import { assertNodeTlsVerificationPolicy, assertPostgresTlsPolicy } from './database-security.ts';
import { isLocalOrUnspecifiedHostname } from './network-security.ts';

export type EnvironmentInput = Readonly<Record<string, string | undefined>>;

export type EnvironmentIssue = Readonly<{
  message: string;
  path: string;
}>;

export class EnvironmentValidationError extends Error {
  override readonly name = 'EnvironmentValidationError';
  readonly issues: readonly EnvironmentIssue[];

  constructor(issues: readonly EnvironmentIssue[]) {
    super(
      `Invalid environment configuration:\n${issues
        .map(({ message, path }) => `- ${path}: ${message}`)
        .join('\n')}`,
    );
    this.issues = issues;
  }
}

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.url().optional());
const optionalSecret = z.preprocess(emptyToUndefined, z.string().min(32).optional());
const base58PublicKey = z
  .string()
  .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, 'must be a base58-encoded public key');
const optionalPublicKey = z.preprocess(emptyToUndefined, base58PublicKey.optional());
const legacyRedirectHostnames = new Set(['droolhouse.com', 'www.droolhouse.com']);
const retiredNetworkEnvironmentKeys = new Map([
  ['NEXT_PUBLIC_WOKENET', 'NEXT_PUBLIC_SOLANA_CLUSTER'],
  ['NEXT_PUBLIC_WOKENET_RPC_URL', 'NEXT_PUBLIC_SOLANA_RPC_URL'],
  ['WOKENET_COMMITMENT', 'SOLANA_COMMITMENT'],
  ['WOKENET_RPC_URLS', 'SOLANA_RPC_URLS'],
  ['WOKENET_WS_URLS', 'SOLANA_WS_URLS'],
]);

function normalizeDnsHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, '');
}

function isLegacyRedirectHostname(hostname: string): boolean {
  return legacyRedirectHostnames.has(normalizeDnsHostname(hostname));
}

function booleanFromEnvironment(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') {
      return defaultValue;
    }
    if (value === true || value === 'true' || value === '1') {
      return true;
    }
    if (value === false || value === 'false' || value === '0') {
      return false;
    }
    return value;
  }, z.boolean());
}

function urlList(defaultValues: readonly string[]) {
  return z.preprocess((value) => {
    if (value === undefined || value === '') {
      return [...defaultValues];
    }
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return value;
  }, z.array(z.url()).min(1));
}

function originList(defaultValues: readonly string[]) {
  return urlList(defaultValues).refine(
    (values) =>
      values.every((value) => {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          url.username === '' &&
          url.password === '' &&
          url.pathname === '/' &&
          !url.search &&
          !url.hash &&
          !isLegacyRedirectHostname(url.hostname)
        );
      }),
    'must contain credential-free HTTP(S) origins without paths, queries, fragments, or legacy redirect hosts',
  );
}

function protocolUrl(protocols: readonly string[]) {
  return z.url().refine((value) => protocols.includes(new URL(value).protocol), {
    message: `must use one of: ${protocols.join(', ')}`,
  });
}

function credentialFreeProtocolUrl(protocols: readonly string[]) {
  return protocolUrl(protocols)
    .refine((value) => {
      const url = new URL(value);
      return url.username === '' && url.password === '';
    }, 'must not include credentials')
    .refine(
      (value) => !isLegacyRedirectHostname(new URL(value).hostname),
      'must not use a legacy redirect-only hostname',
    );
}

export const publicEnvironmentSchema = z.object({
  NEXT_PUBLIC_APP_ORIGIN: credentialFreeProtocolUrl(['http:', 'https:']).default(
    'http://localhost:3000',
  ),
  NEXT_PUBLIC_AUTH_SERVICE_URL: credentialFreeProtocolUrl(['http:', 'https:']).default(
    'http://localhost:4300',
  ),
  NEXT_PUBLIC_FEED_SERVICE_URL: credentialFreeProtocolUrl(['http:', 'https:']).default(
    'http://localhost:4100',
  ),
  NEXT_PUBLIC_INDEXER_URL: credentialFreeProtocolUrl(['http:', 'https:']).default(
    'http://localhost:4000',
  ),
  NEXT_PUBLIC_IPFS_GATEWAY_URL: credentialFreeProtocolUrl(['http:', 'https:']).default(
    'http://127.0.0.1:8080',
  ),
  NEXT_PUBLIC_MEDIA_WORKER_URL: credentialFreeProtocolUrl(['http:', 'https:']).default(
    'http://localhost:4500',
  ),
  NEXT_PUBLIC_MODERATION_SERVICE_URL: credentialFreeProtocolUrl(['http:', 'https:']).default(
    'http://localhost:4400',
  ),
  NEXT_PUBLIC_PROGRAM_ID: optionalPublicKey,
  NEXT_PUBLIC_RELAY_URL: credentialFreeProtocolUrl(['ws:', 'wss:']).default(
    'ws://localhost:4200/v1/relay',
  ),
  NEXT_PUBLIC_SOLANA_CLUSTER: z.enum(['localnet', 'devnet', 'mainnet-beta']).default('localnet'),
  NEXT_PUBLIC_SOLANA_RPC_URL: credentialFreeProtocolUrl(['http:', 'https:']).default(
    'http://127.0.0.1:8899',
  ),
});

export const serverEnvironmentSchema = publicEnvironmentSchema
  .extend({
    ALLOWED_ORIGINS: originList(['http://localhost:3000']),
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    CONTENT_STORAGE_PATH: z.string().min(1).default('.local/content'),
    DATABASE_MIGRATION_URL: z.preprocess(
      emptyToUndefined,
      protocolUrl(['postgres:', 'postgresql:']).optional(),
    ),
    DATABASE_URL: protocolUrl(['postgres:', 'postgresql:']).default(
      'postgresql://wetdrool:local-development-only@127.0.0.1:5432/wetdrool',
    ),
    INDEXER_HOST: z.string().min(1).default('127.0.0.1'),
    INDEXER_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(100),
    INDEXER_DEPLOYMENT_SLOT: z.coerce.number().int().nonnegative().default(0),
    INDEXER_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    INDEXER_PROFILE_V2_ACTIVATION_SLOT: z.coerce
      .number()
      .int()
      .nonnegative()
      .max(Number.MAX_SAFE_INTEGER)
      .default(0),
    IPFS_API_URL: z.url().default('http://127.0.0.1:5001'),
    IPFS_GATEWAY_URL: z.url().default('http://127.0.0.1:8080'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    NODE_TLS_REJECT_UNAUTHORIZED: optionalString,
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
    OTEL_SERVICE_NAMESPACE: z.string().min(1).default('wetdrool'),
    REDIS_URL: protocolUrl(['redis:', 'rediss:']).default(
      'redis://:local-development-only@127.0.0.1:6379',
    ),
    SESSION_SECRET: optionalSecret,
    SOLANA_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('finalized'),
    SOLANA_RPC_URLS: urlList(['http://127.0.0.1:8899']),
    SOLANA_WS_URLS: urlList(['ws://127.0.0.1:8900']),
    SPONSOR_DAILY_LAMPORT_LIMIT: z.coerce.number().int().nonnegative().default(0),
    SPONSOR_ENABLED: booleanFromEnvironment(false),
    SPONSOR_SIGNER_URI: optionalString.refine(
      (value) => value === undefined || /^(?:file|kms|vault):\/\//.test(value),
      'must use a file://, kms://, or vault:// signer reference',
    ),
  })
  .superRefine((environment, context) => {
    const nonLocalEnvironment =
      environment.APP_ENV === 'staging' ||
      environment.APP_ENV === 'production' ||
      environment.NODE_ENV === 'production';
    try {
      assertNodeTlsVerificationPolicy(environment.NODE_TLS_REJECT_UNAUTHORIZED, {
        tlsRequired: nonLocalEnvironment,
      });
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message:
          error instanceof Error
            ? error.message.replace('NODE_TLS_REJECT_UNAUTHORIZED ', '')
            : 'is invalid',
        path: ['NODE_TLS_REJECT_UNAUTHORIZED'],
      });
    }
    for (const [path, value] of [
      ['DATABASE_URL', environment.DATABASE_URL],
      ['DATABASE_MIGRATION_URL', environment.DATABASE_MIGRATION_URL],
    ] as const) {
      if (value === undefined) continue;
      try {
        assertPostgresTlsPolicy(value, {
          tlsRequired: nonLocalEnvironment,
          variableName: path,
        });
      } catch (error) {
        context.addIssue({
          code: 'custom',
          message: error instanceof Error ? error.message.replace(`${path} `, '') : 'is invalid',
          path: [path],
        });
      }
    }

    if (environment.SPONSOR_ENABLED) {
      if (!environment.SPONSOR_SIGNER_URI) {
        context.addIssue({
          code: 'custom',
          message: 'is required when SPONSOR_ENABLED is true',
          path: ['SPONSOR_SIGNER_URI'],
        });
      }
      if (environment.SPONSOR_DAILY_LAMPORT_LIMIT === 0) {
        context.addIssue({
          code: 'custom',
          message: 'must be greater than zero when SPONSOR_ENABLED is true',
          path: ['SPONSOR_DAILY_LAMPORT_LIMIT'],
        });
      }
    }

    if (
      (environment.APP_ENV === 'staging' || environment.APP_ENV === 'production') &&
      environment.NODE_ENV !== 'production'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'must be production for staging and production deployments',
        path: ['NODE_ENV'],
      });
    }
    if (
      environment.NODE_ENV === 'production' &&
      environment.APP_ENV !== 'staging' &&
      environment.APP_ENV !== 'production'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'must be staging or production when NODE_ENV is production',
        path: ['APP_ENV'],
      });
    }

    if (nonLocalEnvironment) {
      if (!environment.NEXT_PUBLIC_PROGRAM_ID) {
        context.addIssue({
          code: 'custom',
          message: 'is required outside local development',
          path: ['NEXT_PUBLIC_PROGRAM_ID'],
        });
      }
      if (!environment.SESSION_SECRET) {
        context.addIssue({
          code: 'custom',
          message: 'is required outside local development',
          path: ['SESSION_SECRET'],
        });
      }

      const appOrigin = new URL(environment.NEXT_PUBLIC_APP_ORIGIN);
      if (appOrigin.protocol !== 'https:' || isLocalOrUnspecifiedHostname(appOrigin.hostname)) {
        context.addIssue({
          code: 'custom',
          message: 'must be a non-local HTTPS origin outside local development',
          path: ['NEXT_PUBLIC_APP_ORIGIN'],
        });
      }

      const expectedSolanaCluster =
        environment.APP_ENV === 'production' ? 'mainnet-beta' : 'devnet';
      if (environment.NEXT_PUBLIC_SOLANA_CLUSTER !== expectedSolanaCluster) {
        context.addIssue({
          code: 'custom',
          message: `must be ${expectedSolanaCluster} when APP_ENV is ${environment.APP_ENV}`,
          path: ['NEXT_PUBLIC_SOLANA_CLUSTER'],
        });
      }
      if (environment.SOLANA_COMMITMENT !== 'finalized') {
        context.addIssue({
          code: 'custom',
          message: 'must be finalized outside local development',
          path: ['SOLANA_COMMITMENT'],
        });
      }

      const browserEndpoints = [
        ['NEXT_PUBLIC_AUTH_SERVICE_URL', environment.NEXT_PUBLIC_AUTH_SERVICE_URL, 'https:'],
        ['NEXT_PUBLIC_FEED_SERVICE_URL', environment.NEXT_PUBLIC_FEED_SERVICE_URL, 'https:'],
        ['NEXT_PUBLIC_INDEXER_URL', environment.NEXT_PUBLIC_INDEXER_URL, 'https:'],
        ['NEXT_PUBLIC_IPFS_GATEWAY_URL', environment.NEXT_PUBLIC_IPFS_GATEWAY_URL, 'https:'],
        ['NEXT_PUBLIC_MEDIA_WORKER_URL', environment.NEXT_PUBLIC_MEDIA_WORKER_URL, 'https:'],
        [
          'NEXT_PUBLIC_MODERATION_SERVICE_URL',
          environment.NEXT_PUBLIC_MODERATION_SERVICE_URL,
          'https:',
        ],
        ['NEXT_PUBLIC_RELAY_URL', environment.NEXT_PUBLIC_RELAY_URL, 'wss:'],
        ['NEXT_PUBLIC_SOLANA_RPC_URL', environment.NEXT_PUBLIC_SOLANA_RPC_URL, 'https:'],
      ] as const;
      for (const [path, value, requiredProtocol] of browserEndpoints) {
        const url = new URL(value);
        if (url.protocol !== requiredProtocol || isLocalOrUnspecifiedHostname(url.hostname)) {
          context.addIssue({
            code: 'custom',
            message: `must be a non-local ${requiredProtocol.replace(':', '').toUpperCase()} endpoint outside local development`,
            path: [path],
          });
        }
      }

      const secureServerEndpoints = [
        ['IPFS_API_URL', environment.IPFS_API_URL, 'https:'],
        ['IPFS_GATEWAY_URL', environment.IPFS_GATEWAY_URL, 'https:'],
        ...environment.SOLANA_RPC_URLS.map(
          (value, index) => [`SOLANA_RPC_URLS.${String(index)}`, value, 'https:'] as const,
        ),
        ...environment.SOLANA_WS_URLS.map(
          (value, index) => [`SOLANA_WS_URLS.${String(index)}`, value, 'wss:'] as const,
        ),
      ] as const;
      for (const [path, value, requiredProtocol] of secureServerEndpoints) {
        const url = new URL(value);
        if (url.protocol !== requiredProtocol || isLocalOrUnspecifiedHostname(url.hostname)) {
          context.addIssue({
            code: 'custom',
            message: `must be a non-local ${requiredProtocol.replace(':', '').toUpperCase()} endpoint outside local development`,
            path: path.split('.'),
          });
        }
      }

      for (const [path, value] of [
        ['DATABASE_URL', environment.DATABASE_URL],
        ['DATABASE_MIGRATION_URL', environment.DATABASE_MIGRATION_URL],
        ['REDIS_URL', environment.REDIS_URL],
      ] as const) {
        if (value !== undefined && isLocalOrUnspecifiedHostname(new URL(value).hostname)) {
          context.addIssue({
            code: 'custom',
            message: 'must not use a local or unspecified endpoint outside local development',
            path: [path],
          });
        }
      }
      if (new URL(environment.REDIS_URL).protocol !== 'rediss:') {
        context.addIssue({
          code: 'custom',
          message: 'must use rediss:// outside local development',
          path: ['REDIS_URL'],
        });
      }

      for (const [index, value] of environment.ALLOWED_ORIGINS.entries()) {
        const url = new URL(value);
        if (url.protocol !== 'https:' || isLocalOrUnspecifiedHostname(url.hostname)) {
          context.addIssue({
            code: 'custom',
            message: 'must contain only non-local HTTPS origins outside local development',
            path: ['ALLOWED_ORIGINS', index],
          });
        }
      }

      if (environment.SPONSOR_SIGNER_URI?.startsWith('file://')) {
        context.addIssue({
          code: 'custom',
          message: 'file-based sponsor signers are forbidden outside local development',
          path: ['SPONSOR_SIGNER_URI'],
        });
      }
    }
  });

export type PublicEnvironment = z.output<typeof publicEnvironmentSchema>;
export type ServerEnvironment = z.output<typeof serverEnvironmentSchema>;

function parseWithSchema<T>(schema: z.ZodType<T>, input: EnvironmentInput): T {
  const retiredIssues = [...retiredNetworkEnvironmentKeys.entries()]
    .filter(([retiredKey]) => input[retiredKey] !== undefined)
    .map(([retiredKey, replacementKey]) => ({
      message: `has been retired; use ${replacementKey}`,
      path: retiredKey,
    }));
  if (retiredIssues.length > 0) {
    throw new EnvironmentValidationError(retiredIssues);
  }

  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  throw new EnvironmentValidationError(
    result.error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.map(String).join('.') || '<root>',
    })),
  );
}

export function parsePublicEnvironment(input: EnvironmentInput): PublicEnvironment {
  return parseWithSchema(publicEnvironmentSchema, input);
}

export function parseServerEnvironment(input: EnvironmentInput): ServerEnvironment {
  return parseWithSchema(serverEnvironmentSchema, input);
}

export function summarizeEnvironment(environment: ServerEnvironment) {
  return {
    appEnvironment: environment.APP_ENV,
    appOrigin: environment.NEXT_PUBLIC_APP_ORIGIN,
    authServiceOrigin: new URL(environment.NEXT_PUBLIC_AUTH_SERVICE_URL).origin,
    commitment: environment.SOLANA_COMMITMENT,
    feedServiceOrigin: new URL(environment.NEXT_PUBLIC_FEED_SERVICE_URL).origin,
    hasProgramId: environment.NEXT_PUBLIC_PROGRAM_ID !== undefined,
    indexerOrigin: `http://${environment.INDEXER_HOST}:${environment.INDEXER_PORT}`,
    ipfsGatewayOrigin: new URL(environment.IPFS_GATEWAY_URL).origin,
    mediaWorkerOrigin: new URL(environment.NEXT_PUBLIC_MEDIA_WORKER_URL).origin,
    moderationServiceOrigin: new URL(environment.NEXT_PUBLIC_MODERATION_SERVICE_URL).origin,
    rpcProviderCount: environment.SOLANA_RPC_URLS.length,
    solanaCluster: environment.NEXT_PUBLIC_SOLANA_CLUSTER,
    sponsorEnabled: environment.SPONSOR_ENABLED,
    telemetryEnabled: environment.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined,
    websocketProviderCount: environment.SOLANA_WS_URLS.length,
  } as const;
}
