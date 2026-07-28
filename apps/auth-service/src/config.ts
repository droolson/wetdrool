import { z } from 'zod';

const rpIdSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^(?:localhost|[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)$/u);
const originSchema = z.url().superRefine((value, context) => {
  const url = new URL(value);
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
      message: 'Origin must be a credential-free HTTP(S) origin without a path.',
    });
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
    context.addIssue({
      code: 'custom',
      message: 'Non-local WebAuthn origins must use HTTPS.',
    });
  }
});
const databaseUrlSchema = z.url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === 'postgres:' || protocol === 'postgresql:';
}, 'Database URL must use PostgreSQL.');
const legacyRedirectRpIds = new Set(['sociallywoke.com', 'www.sociallywoke.com']);

export function parseAuthConfig(input: NodeJS.ProcessEnv = process.env) {
  const environment = z
    .object({
      AUTH_HOST: z.string().min(1).default('127.0.0.1'),
      AUTH_PORT: z.coerce.number().int().min(1).max(65_535).default(4300),
      AUTH_RP_NAME: z.string().trim().min(1).max(120).default('WokeSocial'),
      AUTH_RP_ID: rpIdSchema.default('localhost'),
      AUTH_ORIGIN: originSchema.default('http://localhost:4300'),
      AUTH_DATABASE_URL: databaseUrlSchema.optional(),
      AUTH_DANGEROUSLY_USE_MEMORY_STORE: z.enum(['0', '1']).default('0'),
      AUTH_CLEANUP_INTERVAL_MS: z.coerce.number().int().min(60_000).max(86_400_000).default(60_000),
      AUTH_PENDING_ACCOUNT_RETENTION_MS: z.coerce
        .number()
        .int()
        .min(300_000)
        .max(31_536_000_000)
        .default(3_600_000),
      AUTH_CEREMONY_RETENTION_MS: z.coerce
        .number()
        .int()
        .min(0)
        .max(31_536_000_000)
        .default(86_400_000),
      AUTH_SESSION_RETENTION_MS: z.coerce
        .number()
        .int()
        .min(0)
        .max(31_536_000_000)
        .default(604_800_000),
      AUTH_CLEANUP_BATCH_SIZE: z.coerce.number().int().min(1).max(5_000).default(500),
    })
    .parse(input);
  const origin = new URL(environment.AUTH_ORIGIN);
  if (legacyRedirectRpIds.has(environment.AUTH_RP_ID)) {
    throw new Error('The legacy redirect hostname cannot be used as a WebAuthn RP ID.');
  }
  if (
    origin.hostname !== environment.AUTH_RP_ID &&
    !origin.hostname.endsWith(`.${environment.AUTH_RP_ID}`)
  ) {
    throw new Error('AUTH_ORIGIN hostname must equal or be a subdomain of AUTH_RP_ID.');
  }
  if (
    environment.AUTH_DATABASE_URL === undefined &&
    environment.AUTH_DANGEROUSLY_USE_MEMORY_STORE !== '1'
  ) {
    throw new Error(
      'AUTH_DATABASE_URL is required unless the explicit development-only memory-store flag is set.',
    );
  }
  return {
    host: environment.AUTH_HOST,
    port: environment.AUTH_PORT,
    rpName: environment.AUTH_RP_NAME,
    rpId: environment.AUTH_RP_ID,
    origin: origin.origin,
    databaseUrl: environment.AUTH_DATABASE_URL,
    dangerouslyUseMemoryStore: environment.AUTH_DANGEROUSLY_USE_MEMORY_STORE === '1',
    cleanupIntervalMs: environment.AUTH_CLEANUP_INTERVAL_MS,
    retention: {
      pendingAccountRetentionMs: environment.AUTH_PENDING_ACCOUNT_RETENTION_MS,
      ceremonyRetentionMs: environment.AUTH_CEREMONY_RETENTION_MS,
      sessionRetentionMs: environment.AUTH_SESSION_RETENTION_MS,
      batchSize: environment.AUTH_CLEANUP_BATCH_SIZE,
    },
  } as const;
}
