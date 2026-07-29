import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import { parseWokeManifestUri } from '@wokesocial/protocol';
import { MemoryContentAddressedStorage } from '@wokesocial/storage';

import {
  ManifestVerifier,
  MemoryProjectionStore,
  SolanaEventMaterializer,
  type DecodedAnchorEvent,
  type SolanaEventContext,
  type SolanaEventMaterializationError,
} from '../src/index.js';
import { TEST_CID } from './cid-fixtures.js';

const publicKey = (byte: number): string =>
  bs58.encode(Uint8Array.from({ length: 32 }, () => byte));
const cid = TEST_CID;
const transactionId = 'A'.repeat(43);
const config = publicKey(1);
const programId = publicKey(2);
const identity = publicKey(3);
const authority = publicKey(4);
const community = publicKey(5);
const postReference = publicKey(6);
const networkId = `wokenet:v1:${publicKey(7)}:${programId}`;
const manifestHash = Uint8Array.from({ length: 32 }, () => 8);
const validUris = [
  `ipfs://${cid}`,
  `local://${cid}`,
  `ar://${transactionId}/${cid}`,
  `https://example.test/${cid}`,
  `https://cdn.example.test:443/manifests/${cid}`,
] as const;

describe('Solana manifest URI materialization', () => {
  it.each(validUris)(
    'materializes a chain-valid community locator without losing its CID: %s',
    async (manifestUri) => {
      expect(parseWokeManifestUri(manifestUri)).toMatchObject({ cid });
      const event = await materializer().materialize(communityCreated(manifestUri), context());

      expect(event).toMatchObject({
        type: 'community-created',
        manifestCid: cid,
      });
    },
  );

  it.each(validUris)('extracts the CID from a profile locator: %s', async (manifestUri) => {
    const event = await materializer().materialize(profileUpdated(manifestUri), context());

    expect(event).toMatchObject({
      type: 'profile-updated',
      manifestUri,
      cid,
    });
  });

  it.each(validUris)('extracts the CID from a post locator: %s', async (manifestUri) => {
    const event = await materializer().materialize(postPublished(manifestUri), context());

    expect(event).toMatchObject({
      type: 'post-published',
      manifestUri,
      cid,
    });
  });

  it('extracts an HTTPS CID without fetching the arbitrary provider locator', async () => {
    const get = vi.fn(() => Promise.reject(new Error('must not fetch during materialization')));
    const indexer = new SolanaEventMaterializer({ get }, new MemoryProjectionStore());

    await expect(
      indexer.materialize(
        communityCreated(`https://untrusted.example/manifests/${cid}`),
        context(),
      ),
    ).resolves.toMatchObject({ manifestCid: cid });
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    'ipfs://baaaaaaaaaaaaaaaaaaaa',
    `ipfs://bafkrez${'a'.repeat(52)}`,
    `ipfs://bafkreiz${'a'.repeat(51)}`,
    `local://${cid.toUpperCase()}`,
    `local://${cid.slice(0, -1)}b`,
    'local://bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'local://bafkrgqgpqpqtk7xpxc67cvbikdlg3aah2yqoibilk4k5za7uveq5g3hjzzd5buj4lwc7fmh7qmmnfb365qxwhojrxvduc6ubuu4de6xze7nd4',
    `ipfs://${cid}/extra`,
    `local://${cid}?download=1`,
    `ar://${transactionId}`,
    `https://example.test/${cid}#fragment`,
  ])('rejects an invalid community locator instead of misidentifying a CID: %s', async (uri) => {
    await expect(
      materializer().materialize(communityCreated(uri), context()),
    ).rejects.toMatchObject({
      code: 'manifest-uri',
    } satisfies Partial<SolanaEventMaterializationError>);
  });

  it.each([
    'ipfs://baaaaaaaaaaaaaaaaaaaa',
    `local://${cid.toUpperCase()}`,
    `local://${cid.slice(0, 7)}z${cid.slice(8)}`,
    `ar://${transactionId}/${cid.slice(0, -1)}`,
    'https://example.test/bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
    'ipfs://bafkrgqgpqpqtk7xpxc67cvbikdlg3aah2yqoibilk4k5za7uveq5g3hjzzd5buj4lwc7fmh7qmmnfb365qxwhojrxvduc6ubuu4de6xze7nd4',
  ])(
    'classifies a malformed profile locator as terminal before provider I/O: %s',
    async (manifestUri) => {
      const get = vi.fn(() => Promise.reject(new Error('provider must not be called')));
      const event = await materializer().materialize(profileUpdated(manifestUri), context());
      const verifier = new ManifestVerifier({ get }, { authorize: () => Promise.resolve(true) });

      await expect(verifier.forEvent(event)).rejects.toMatchObject({
        code: 'manifest-uri',
      });
      expect(get).not.toHaveBeenCalled();
    },
  );
});

function materializer(): SolanaEventMaterializer {
  return new SolanaEventMaterializer(
    new MemoryContentAddressedStorage(),
    new MemoryProjectionStore(),
  );
}

function context(): SolanaEventContext {
  return {
    networkId,
    programId,
    transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 9)),
    slot: 42n,
    logIndex: 1,
    blockTime: 1_785_258_000,
  };
}

function communityCreated(manifestUri: string): DecodedAnchorEvent {
  return {
    kind: 'community-created',
    eventVersion: 1,
    config,
    community,
    creatorIdentity: identity,
    authority,
    communityNonce: new Uint8Array(16),
    creatorSequence: 1n,
    manifestHash,
    manifestUri,
    governanceVersion: 1,
    governanceStrategyHash: Uint8Array.from({ length: 32 }, () => 10),
    createdAtSlot: 42n,
  };
}

function profileUpdated(manifestUri: string): DecodedAnchorEvent {
  return {
    kind: 'profile-updated',
    eventVersion: 1,
    config,
    identity,
    authority,
    sequence: 1n,
    previousManifestHash: new Uint8Array(32),
    manifestHash,
    manifestUri,
    updatedAtSlot: 42n,
    profileSchemaVersion: 2,
  };
}

function postPublished(manifestUri: string): DecodedAnchorEvent {
  return {
    kind: 'post-published',
    eventVersion: 1,
    config,
    postReference,
    authorIdentity: identity,
    authority,
    postNonce: new Uint8Array(16),
    authorSequence: 1n,
    manifestHash,
    manifestUri,
    createdAtSlot: 42n,
  };
}
