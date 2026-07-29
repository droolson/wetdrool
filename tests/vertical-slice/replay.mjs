import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

import { networkIdSchema } from '../../packages/protocol/dist/src/index.js';
import {
  PostgresProjectionStore,
  rebuildFromDurableLedger,
} from '../../apps/indexer/dist/src/index.js';

const databaseUrl = required('DATABASE_URL');
const contentStoragePath = required('CONTENT_STORAGE_PATH');
const networkId = networkIdSchema.parse(required('INDEXER_NETWORK_ID'));
const programId = required('NEXT_PUBLIC_PROGRAM_ID');
localHttpUrl(required('SOLANA_RPC_URLS'));
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

  const [, , genesisHash, networkProgramId] = networkId.split(':');
  if (genesisHash === undefined || networkProgramId !== programId) {
    throw new Error('WokeNet ID is not bound to the configured program.');
  }
  const replay = await rebuildFromDurableLedger({
    databaseUrl,
    contentStoragePath,
    networkId,
    apply: true,
    profileSchemaV2ActivationSlot: 0n,
  });
  assert.equal(replay.mode, 'applied');
  assert.equal(replay.eventCount, 8, 'replay validates exactly every durable fixture event');

  const after = await snapshot(projection, metadata);
  assert.equal(
    after.tombstonedPost,
    undefined,
    'suppression-aware rebuild does not rematerialize deleted post content',
  );
  assert.deepEqual(
    normalize(after),
    normalize({ ...before, tombstonedPost: undefined }),
    'destroyed projection rebuilds to equivalent public protocol state',
  );
  process.stdout.write(
    `Rebuilt ${replay.eventCount} durable events with ledger digest ${replay.ledgerSha256}.\n`,
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
    throw new Error('Projection replay refuses non-local or ambiguous Solana RPC endpoints.');
  }
  return urls[0].toString();
}
