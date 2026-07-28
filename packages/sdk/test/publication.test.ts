import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  createPayloadBuilderIdentity,
  type NetworkId,
  type PostContent,
} from '@socially-woke/protocol';
import { MemoryContentAddressedStorage, MultiProviderStorage } from '@socially-woke/storage';

import { PublicationError, PublicationPipeline, type ProtocolChainWriter } from '../src/index.js';

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const publicKey = ed25519.getPublicKey(privateKey);
const genesis = bs58.encode(Uint8Array.from({ length: 32 }, () => 7));
const program = bs58.encode(Uint8Array.from({ length: 32 }, () => 8));
const identityPda = bs58.encode(Uint8Array.from({ length: 32 }, () => 9));
const network = `woke:v1:${genesis}:${program}` as NetworkId;
const author = `swid:v1:woke:v1:${genesis}:${program}:${identityPda}`;
const identity = createPayloadBuilderIdentity(network, author, publicKey);
const content: PostContent = {
  format: 'plain',
  body: 'A signed post.',
  media: [],
  language: 'en',
  contentWarnings: [],
  accessibility: {
    altTextReminderAcknowledged: false,
    captionReferences: [],
  },
  visibility: { kind: 'public' },
  authorLabels: [],
  replyPolicy: 'anyone',
  quotePolicy: 'allowed',
};

function chainWriter(publishPost: ProtocolChainWriter['publishPost']): ProtocolChainWriter {
  return {
    publishPost,
    updateProfile: vi.fn(),
    follow: vi.fn(),
    unfollow: vi.fn(),
  };
}

describe('publication pipeline', () => {
  it('stores before anchoring and returns finalized evidence', async () => {
    const stages: string[] = [];
    const publishPost = vi.fn(async () => ({
      signature: 'local-transaction-signature',
      slot: 42n,
      finalized: true,
    }));
    const pipeline = new PublicationPipeline({
      identity,
      privateKey,
      storage: new MultiProviderStorage({
        providers: [new MemoryContentAddressedStorage()],
      }),
      chain: chainWriter(publishPost),
      onProgress: ({ stage }) => stages.push(stage),
    });

    const result = await pipeline.publishPost(
      content,
      { permanence: 'deletion-compatible' },
      {
        createdAt: new Date('2026-07-28T12:00:00.000Z'),
        nonce: Uint8Array.from({ length: 16 }, (_, index) => index),
      },
    );

    expect(result.chain.finalized).toBe(true);
    expect(result.storage.cid).toMatch(/^bafk/u);
    expect(publishPost).toHaveBeenCalledWith(
      expect.objectContaining({
        cid: result.storage.cid,
        objectId: result.objectId,
      }),
    );
    expect(stages).toEqual([
      'validating',
      'signing',
      'storing',
      'anchoring',
      'confirming',
      'complete',
    ]);
  });

  it('surfaces stored content for a retry after chain failure', async () => {
    const pipeline = new PublicationPipeline({
      identity,
      privateKey,
      storage: new MultiProviderStorage({
        providers: [new MemoryContentAddressedStorage()],
      }),
      chain: chainWriter(async () => {
        throw new Error('RPC unavailable');
      }),
    });

    const result = pipeline.publishPost(content, {
      permanence: 'deletion-compatible',
    });
    await expect(result).rejects.toBeInstanceOf(PublicationError);
    await expect(result).rejects.toMatchObject({
      stage: 'anchoring',
      recoverableCid: expect.stringMatching(/^bafk/u),
    });
  });
});
