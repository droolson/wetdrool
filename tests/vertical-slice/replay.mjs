import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

import { networkIdSchema } from '../../packages/protocol/dist/src/index.js';
import { LocalContentAddressedStorage } from '../../packages/storage/dist/src/index.js';
import {
  FailoverSolanaRpc,
  ManifestVerifier,
  OpenIndexer,
  PostgresProjectionStore,
  ProjectionRootKeyAuthorizer,
  SolanaEventMaterializer,
  SolanaSyncWorker,
} from '../../apps/indexer/dist/src/index.js';

const databaseUrl = required('DATABASE_URL');
const contentStoragePath = required('CONTENT_STORAGE_PATH');
const networkId = networkIdSchema.parse(required('INDEXER_NETWORK_ID'));
const programId = required('NEXT_PUBLIC_PROGRAM_ID');
const rpcUrl = localHttpUrl(required('WOKENET_RPC_URLS'));
const metadata = JSON.parse(await readFile(required('VERTICAL_SLICE_METADATA_PATH'), 'utf8'));
assert.equal(metadata.networkId, networkId);
assert.equal(metadata.programId, programId);

const projection = new PostgresProjectionStore(databaseUrl);
try {
  const before = await snapshot(projection, metadata);
  assert.equal(before.chronological.length, 1, 'tombstone suppressed from chronological feed');
  assert.equal(before.following.length, 1, 'active follow projected into following feed');
  assert.equal(before.following[0]?.post.objectId, metadata.postObjectId);
  assert.equal(before.following[0]?.reason.kind, 'following');
  assert.equal(before.tombstonedPost?.objectId, metadata.tombstonedPostObjectId);
  assert.ok(before.tombstonedPost?.tombstonedAt, 'tombstoned post retains deletion projection');

  await projection.clearProjection(networkId);
  assert.equal(await projection.getIdentity(metadata.authorIdentityId), undefined);
  assert.deepEqual(
    await projection.getFeed({
      networkId,
      mode: 'chronological',
      limit: 20,
    }),
    [],
  );

  const storage = new LocalContentAddressedStorage({
    rootDirectory: contentStoragePath,
  });
  const verifier = new ManifestVerifier(storage, new ProjectionRootKeyAuthorizer(projection));
  const indexer = new OpenIndexer(projection, verifier);
  const [, , genesisHash, networkProgramId] = networkId.split(':');
  if (genesisHash === undefined || networkProgramId !== programId) {
    throw new Error('WokeNet ID is not bound to the configured program.');
  }
  const worker = new SolanaSyncWorker({
    rpc: FailoverSolanaRpc.fromUrls([rpcUrl], genesisHash, programId),
    indexer,
    projection,
    materializer: new SolanaEventMaterializer(storage, projection),
    networkId,
    programId,
    deploymentSlot: 0n,
    batchSize: 1_000,
    pollIntervalMilliseconds: 100,
    retryAttempts: 3,
    retryBaseMilliseconds: 10,
    retryMaximumMilliseconds: 100,
  });
  const replay = await worker.runOnce();
  assert.equal(replay.deadLetters, 0, 'replay has no dead letters');
  assert.equal(replay.checkpointAdvanced, true, 'replay advances finalized checkpoint');
  assert.equal(replay.appliedEvents, 8, 'replay applies exactly every projected fixture event');

  const after = await snapshot(projection, metadata);
  assert.deepEqual(
    normalize(after),
    normalize(before),
    'destroyed projection rebuilds to equivalent protocol state',
  );
  process.stdout.write(
    `Replayed ${replay.appliedEvents} events from ${replay.transactions} finalized transactions with no dead letters.\n`,
  );
} finally {
  await projection.close();
}

async function snapshot(projection, fixture) {
  return {
    author: await projection.getIdentity(fixture.authorIdentityId),
    viewer: await projection.getIdentity(fixture.viewerIdentityId),
    profile: await projection.getProfile(fixture.authorIdentityId),
    post: await projection.getPost(fixture.postObjectId),
    tombstonedPost: await projection.getPost(fixture.tombstonedPostObjectId),
    chronological: await projection.getFeed({
      networkId,
      mode: 'chronological',
      limit: 20,
    }),
    following: await projection.getFeed({
      networkId,
      viewerIdentityId: fixture.viewerIdentityId,
      mode: 'following',
      limit: 20,
    }),
  };
}

function normalize(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, item) => (typeof item === 'bigint' ? item.toString() : item)),
  );
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for production replay verification.`);
  }
  return value;
}

function localHttpUrl(value) {
  const urls = value.split(',').map((candidate) => new URL(candidate.trim()));
  if (
    urls.length !== 1 ||
    urls[0].protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(urls[0].hostname)
  ) {
    throw new Error(
      'Projection replay refuses non-local or ambiguous WokeNet Solana-compatible RPC endpoints.',
    );
  }
  return urls[0].toString();
}
