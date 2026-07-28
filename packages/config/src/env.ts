import { z } from 'zod';

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
const legacyRedirectHostnames = new Set(['sociallywoke.com', 'www.sociallywoke.com']);
const retiredNetworkEnvironmentKeys = new Map([
  ['NEXT_PUBLIC_SOLANA_CLUSTER', 'NEXT_PUBLIC_WOKE_NETWORK'],
  ['NEXT_PUBLIC_SOLANA_RPC_URL', 'NEXT_PUBLIC_WOKE_RPC_URL'],
  ['SOLANA_COMMITMENT', 'WOKE_COMMITMENT'],
  ['SOLANA_RPC_URLS', 'WOKE_RPC_URLS'],
  ['SOLANA_WS_URLS', 'WOKE_WS_URLS'],
]);

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
          !legacyRedirectHostnames.has(url.hostname.toLowerCase())
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
      (value) => !legacyRedirectHostnames.has(new URL(value).hostname.toLowerCase()),
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
  NEXT_PUBLIC_WOKE_NETWORK: z.enum(['localnet', 'public-test']).default('localnet'),
  NEXT_PUBLIC_WOKE_RPC_URL: credentialFreeProtocolUrl(['http:', 'https:']).default(
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
      'postgresql://socially_woke:local-development-only@127.0.0.1:5432/socially_woke',
    ),
    INDEXER_HOST: z.string().min(1).default('127.0.0.1'),
    INDEXER_BATCH_SIZE: z.coerce.number().int().min(1).max(10_000).default(100),
    INDEXER_DEPLOYMENT_SLOT: z.coerce.number().int().nonnegative().default(0),
    INDEXER_PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
    IPFS_API_URL: z.url().default('http://127.0.0.1:5001'),
    IPFS_GATEWAY_URL: z.url().default('http://127.0.0.1:8080'),
    LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    OTEL_EXPORTER_OTLP_ENDPOINT: optionalUrl,
    OTEL_SERVICE_NAMESPACE: z.string().min(1).default('socially-woke'),
    REDIS_URL: protocolUrl(['redis:', 'rediss:']).default(
      'redis://:local-development-only@127.0.0.1:6379',
    ),
    SESSION_SECRET: optionalSecret,
    WOKE_COMMITMENT: z.enum(['processed', 'confirmed', 'finalized']).default('finalized'),
    WOKE_RPC_URLS: urlList(['http://127.0.0.1:8899']),
    WOKE_WS_URLS: urlList(['ws://127.0.0.1:8900']),
    SPONSOR_DAILY_LAMPORT_LIMIT: z.coerce.number().int().nonnegative().default(0),
    SPONSOR_ENABLED: booleanFromEnvironment(false),
    SPONSOR_SIGNER_URI: optionalString.refine(
      (value) => value === undefined || /^(?:file|kms|vault):\/\//.test(value),
      'must use a file://, kms://, or vault:// signer reference',
    ),
  })
  .superRefine((environment, context) => {
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

    if (environment.APP_ENV === 'production') {
      if (!environment.NEXT_PUBLIC_PROGRAM_ID) {
        context.addIssue({
          code: 'custom',
          message: 'is required in production',
          path: ['NEXT_PUBLIC_PROGRAM_ID'],
        });
      }
      if (!environment.SESSION_SECRET) {
        context.addIssue({
          code: 'custom',
          message: 'is required in production',
          path: ['SESSION_SECRET'],
        });
      }

      const appOrigin = new URL(environment.NEXT_PUBLIC_APP_ORIGIN);
      if (appOrigin.protocol !== 'https:' || appOrigin.hostname === 'localhost') {
        context.addIssue({
          code: 'custom',
          message: 'must be a non-local HTTPS origin in production',
          path: ['NEXT_PUBLIC_APP_ORIGIN'],
        });
      }

      if (environment.SPONSOR_SIGNER_URI?.startsWith('file://')) {
        context.addIssue({
          code: 'custom',
          message: 'file-based sponsor signers are forbidden in production',
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
    commitment: environment.WOKE_COMMITMENT,
    feedServiceOrigin: new URL(environment.NEXT_PUBLIC_FEED_SERVICE_URL).origin,
    hasProgramId: environment.NEXT_PUBLIC_PROGRAM_ID !== undefined,
    indexerOrigin: `http://${environment.INDEXER_HOST}:${environment.INDEXER_PORT}`,
    ipfsGatewayOrigin: new URL(environment.IPFS_GATEWAY_URL).origin,
    mediaWorkerOrigin: new URL(environment.NEXT_PUBLIC_MEDIA_WORKER_URL).origin,
    moderationServiceOrigin: new URL(environment.NEXT_PUBLIC_MODERATION_SERVICE_URL).origin,
    rpcProviderCount: environment.WOKE_RPC_URLS.length,
    sponsorEnabled: environment.SPONSOR_ENABLED,
    telemetryEnabled: environment.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined,
    websocketProviderCount: environment.WOKE_WS_URLS.length,
    wokeNetwork: environment.NEXT_PUBLIC_WOKE_NETWORK,
  } as const;
}
