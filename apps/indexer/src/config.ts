import { parseServerEnvironment } from '@wokesocial/config';
import { networkIdSchema, solanaPublicKeySchema } from '@wokesocial/protocol';
import { z } from 'zod';

import { SOCIAL_PROTOCOL_EVENT_LAYOUT } from './anchor-events.js';

export type IndexerConfig = Readonly<{
  allowedOrigins: readonly string[];
  contentStoragePath: string;
  databaseUrl: string;
  host: string;
  port: number;
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
  }>;
}>;

export function readIndexerConfig(environment: NodeJS.ProcessEnv = process.env): IndexerConfig {
  const parsed = parseServerEnvironment(environment);
  const networkId = nonEmpty(environment['INDEXER_NETWORK_ID']);
  const explicitProgramId = nonEmpty(environment['NEXT_PUBLIC_PROGRAM_ID']);
  const sync =
    networkId === undefined || explicitProgramId === undefined
      ? undefined
      : syncEnvironmentSchema.parse({
          networkId,
          programId: explicitProgramId,
          rpcUrls: parsed.WOKENET_RPC_URLS,
          deploymentSlot: parsed.INDEXER_DEPLOYMENT_SLOT,
          batchSize: parsed.INDEXER_BATCH_SIZE,
          commitment: parsed.WOKENET_COMMITMENT,
          pollIntervalMilliseconds: nonEmpty(environment['INDEXER_POLL_INTERVAL_MS']),
          retryAttempts: nonEmpty(environment['INDEXER_RETRY_ATTEMPTS']),
          retryBaseMilliseconds: nonEmpty(environment['INDEXER_RETRY_BASE_MS']),
          retryMaximumMilliseconds: nonEmpty(environment['INDEXER_RETRY_MAX_MS']),
        });
  return {
    allowedOrigins: parsed.ALLOWED_ORIGINS,
    contentStoragePath: parsed.CONTENT_STORAGE_PATH,
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.INDEXER_HOST,
    port: parsed.INDEXER_PORT,
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
  });

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === '' ? undefined : trimmed;
}
