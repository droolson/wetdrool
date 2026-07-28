import { describe, expect, it } from 'vitest';

import { MemoryContentAddressedStorage } from '@socially-woke/storage';

import {
  FailoverSolanaRpc,
  KitSolanaRpcEndpoint,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  ProjectionRootKeyAuthorizer,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  SolanaEventMaterializer,
  SolanaSyncWorker,
} from '../src/index.js';

const integrationTest = process.env['RUN_SOLANA_INDEXER_INTEGRATION'] === '1' ? it : it.skip;

describe('local-validator Solana ingestion', () => {
  integrationTest(
    'replays the Anchor test fixture through the production RPC adapter',
    async () => {
      const rpcUrl = process.env['SOLANA_INTEGRATION_RPC_URL'] ?? 'http://127.0.0.1:8899';
      const endpoint = new KitSolanaRpcEndpoint(rpcUrl);
      const genesisHash = await endpoint.genesisHash();
      const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
      const networkId = `woke:v1:${genesisHash}:${programId}`;
      const projection = new MemoryProjectionStore();
      const storage = new MemoryContentAddressedStorage();
      const indexer = new OpenIndexer(
        projection,
        new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection)),
      );
      const worker = new SolanaSyncWorker({
        rpc: new FailoverSolanaRpc([endpoint], genesisHash, programId),
        indexer,
        projection,
        materializer: new SolanaEventMaterializer(storage, projection),
        networkId,
        programId,
        deploymentSlot: 0n,
        batchSize: 1_000,
        pollIntervalMilliseconds: 100,
        retryAttempts: 1,
        retryBaseMilliseconds: 1,
        retryMaximumMilliseconds: 1,
      });

      const result = await worker.runOnce();
      const events = projection.events(networkId);
      expect(result.transactions).toBeGreaterThan(0);
      expect(events.some((event) => event.type === 'identity-created')).toBe(true);
      expect(events.every((event) => event.finalized)).toBe(true);
    },
    60_000,
  );
});
