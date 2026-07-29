import { strict as assert } from 'node:assert';
import { readFile } from 'node:fs/promises';

import { networkIdSchema } from '../../packages/protocol/dist/src/index.js';
import {
  PostgresProjectionStore,
  rebuildFromDurableLedger,
} from '../../apps/indexer/dist/src/index.js';
import {
  BASELINE_DURABLE_EVENT_COUNT,
  publicationAdditiveEventCount,
  readPublicationEvidence,
} from './publication-evidence.mjs';

const databaseUrl = required('DATABASE_URL');
const contentStoragePath = required('CONTENT_STORAGE_PATH');
const networkId = networkIdSchema.parse(required('INDEXER_NETWORK_ID'));
const programId = required('NEXT_PUBLIC_PROGRAM_ID');
localHttpUrl(required('SOLANA_RPC_URLS'));
const fixture = JSON.parse(await readFile(required('VERTICAL_SLICE_METADATA_PATH'), 'utf8'));
const evidence = await readPublicationEvidence(
  required('VERTICAL_SLICE_PUBLICATION_EVIDENCE_PATH'),
  { networkId, programId },
);
assert.equal(fixture.networkId, networkId);
assert.equal(fixture.programId, programId);

const projection = new PostgresProjectionStore(databaseUrl);
try {
  await assertBrowserPublication(projection, evidence, fixture, 'before replay', true);

  await projection.clearProjection(networkId);
  assert.equal(await projection.getIdentity(fixture.authorIdentityId), undefined);
  assert.equal(await projection.getIdentity(evidence.identity.identityId), undefined);
  for (const post of [fixture, ...evidence.posts]) {
    const objectId = post.postObjectId ?? post.objectId;
    assert.equal(await projection.getPost(objectId), undefined);
  }

  const replay = await rebuildFromDurableLedger({
    databaseUrl,
    contentStoragePath,
    networkId,
    apply: true,
    profileSchemaV2ActivationSlot: 0n,
  });
  const additiveEventCount = publicationAdditiveEventCount(evidence);
  assert.equal(replay.mode, 'applied');
  assert.equal(
    replay.eventCount,
    BASELINE_DURABLE_EVENT_COUNT + additiveEventCount,
    'the second rebuild must add two atomic registration events and one event per evidenced post',
  );

  await assertBrowserPublication(projection, evidence, fixture, 'after replay', false);
  process.stdout.write(
    `Rebuilt ${String(replay.eventCount)} durable events (${String(BASELINE_DURABLE_EVENT_COUNT)} baseline + ${String(additiveEventCount)} browser writes) with ledger digest ${replay.ledgerSha256}.\n`,
  );
} finally {
  await projection.close();
}

async function assertBrowserPublication(
  projection,
  publication,
  baseline,
  phase,
  requireObservedCheckpoint,
) {
  const identity = await projection.getIdentity(publication.identity.identityId);
  assert.ok(identity, `${phase}: browser identity must exist`);
  assert.equal(identity.networkId, publication.networkId);
  assert.equal(identity.identityAddress, publication.identity.identityAddress);
  assert.equal(identity.rootAuthority, publication.identity.rootAuthority);
  assert.equal(identity.active, true);
  assert.equal(identity.identitySequence, 3n);
  assert.ok(
    identity.updatedSlot >= BigInt(publication.posts.at(-1).finalizedSlot),
    `${phase}: reused identity sequence must cover both posts`,
  );

  const wokeName = await projection.getHandle(publication.networkId, publication.wokeName.handle);
  assert.ok(wokeName, `${phase}: anonymous .woke claim must exist`);
  assert.equal(wokeName.handle, publication.wokeName.handle);
  assert.equal(wokeName.handleClaimAddress, publication.wokeName.handleClaimAddress);
  assert.equal(wokeName.handleHash, publication.wokeName.handleHash);
  assert.equal(wokeName.identityId, publication.identity.identityId);
  assert.equal(wokeName.authority, publication.identity.rootAuthority);
  assert.equal(wokeName.identitySequence, 1n);
  assert.equal(wokeName.claimedSlot, BigInt(publication.wokeName.claimedSlot));

  const baselinePost = await projection.getPost(baseline.postObjectId);
  assert.equal(baselinePost?.content.body, baseline.postBody, `${phase}: baseline post restored`);
  assert.equal(baselinePost?.cid, baseline.postCid, `${phase}: baseline CAS object restored`);

  for (const expected of publication.posts) {
    const post = await projection.getPost(expected.objectId);
    assert.ok(post, `${phase}: browser post ${expected.objectId} must exist`);
    assert.equal(post.networkId, publication.networkId);
    assert.equal(post.authorIdentityId, publication.identity.identityId);
    assert.equal(post.objectId, expected.objectId);
    assert.equal(post.content.body, expected.body);
    assert.equal(post.cid, expected.cid);
    assert.equal(post.payloadHash, expected.payloadHash);
    assert.equal(post.transactionSignature, expected.transactionSignature);
    assert.equal(post.anchoredSlot, BigInt(expected.finalizedSlot));
    assert.equal(post.verified, true);
    assert.equal(post.tombstonedAt, undefined);
  }

  const feed = await projection.getFeed({
    networkId: publication.networkId,
    mode: 'chronological',
    limit: 20,
  });
  const expectedObjectIds = new Set([
    baseline.postObjectId,
    ...publication.posts.map((post) => post.objectId),
  ]);
  assert.deepEqual(
    new Set(feed.map((entry) => entry.post.objectId)),
    expectedObjectIds,
    `${phase}: feed must contain the prior fixture and both exact browser posts`,
  );
  const checkpoint = await projection.checkpoint(publication.networkId);
  assert.ok(checkpoint !== undefined, `${phase}: projection checkpoint must exist`);
  const lastPost = publication.posts.at(-1);
  const requiredCheckpoint = BigInt(
    requireObservedCheckpoint ? lastPost.indexedCheckpointSlot : lastPost.finalizedSlot,
  );
  assert.ok(
    checkpoint >= requiredCheckpoint,
    requireObservedCheckpoint
      ? `${phase}: live checkpoint must preserve the evidenced indexing observation`
      : `${phase}: rebuilt event checkpoint must cover the last browser post event`,
  );
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for browser-publication replay verification.`);
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
    throw new Error('Browser-publication replay refuses non-local Solana RPC endpoints.');
  }
  return urls[0].toString();
}
