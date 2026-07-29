import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  PROFILE_SCHEMA_VERSION,
  buildPostPayload,
  createPayloadBuilderIdentity,
  decodeMultibaseBase64Url,
  encodeMultibaseBase64Url,
  signPayload,
  type NetworkId,
  type PostContent,
  type PortablePayload,
  type ProfileContent,
} from '@wokesocial/protocol';
import { MemoryContentAddressedStorage, MultiProviderStorage } from '@wokesocial/storage';

import {
  PublicationError,
  PublicationPipeline,
  type PublicationPipelineOptions,
  type ProtocolChainWriter,
} from '../src/index.js';

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const publicKey = ed25519.getPublicKey(privateKey);
const genesis = bs58.encode(Uint8Array.from({ length: 32 }, () => 7));
const program = bs58.encode(Uint8Array.from({ length: 32 }, () => 8));
const identityPda = bs58.encode(Uint8Array.from({ length: 32 }, () => 9));
const network = `wokenet:v1:${genesis}:${program}` as NetworkId;
const author = `wokesocialid:v1:wokenet:v1:${genesis}:${program}:${identityPda}`;
const identity = createPayloadBuilderIdentity(network, author, publicKey);
const otherPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 33);
const otherPublicKey = ed25519.getPublicKey(otherPrivateKey);
const otherIdentityPda = bs58.encode(Uint8Array.from({ length: 32 }, () => 10));
const otherAuthor = `wokesocialid:v1:wokenet:v1:${genesis}:${program}:${otherIdentityPda}`;
const otherIdentity = createPayloadBuilderIdentity(network, otherAuthor, otherPublicKey);
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
const profileContent: ProfileContent = {
  displayName: 'River',
  bio: 'Building humane social infrastructure.',
  pronouns: [{ visibility: 'public', value: 'they/them' }],
  chosenFamilyLabels: [],
  links: [],
};
const protectedValueDigest = encodeMultibaseBase64Url(Uint8Array.from({ length: 32 }, () => 11));
const protectedValueReference = {
  cid: `b${'a'.repeat(30)}`,
  digest: protectedValueDigest,
  bytes: 128,
  mediaType: 'application/wokesocial-encrypted-profile-value+json',
  protection: {
    kind: 'encrypted' as const,
    encryptionFormat: 'wokesocial-aes-256-gcm-v1',
    keyEnvelope: {
      id: `wokesocialobj:v1:key-envelope:${protectedValueDigest}`,
    },
    accessPolicy: {
      id: `wokesocialobj:v1:access-policy:${protectedValueDigest}`,
    },
  },
};
const fixedCreatedAt = new Date('2026-07-28T12:00:00.000Z');
const fixedNonce = Uint8Array.from({ length: 16 }, (_, index) => index);

function signer<Payload extends PortablePayload>(payload: Payload) {
  return signPayload(payload, privateKey);
}

function storage(): MultiProviderStorage {
  return new MultiProviderStorage({
    providers: [new MemoryContentAddressedStorage()],
  });
}

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
      storage: storage(),
      chain: chainWriter(publishPost),
      onProgress: ({ stage }) => stages.push(stage),
    });

    const result = await pipeline.publishPost(
      content,
      { permanence: 'deletion-compatible' },
      {
        signer,
        createdAt: fixedCreatedAt,
        nonce: fixedNonce,
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
      storage: storage(),
      chain: chainWriter(async () => {
        throw new Error('RPC unavailable');
      }),
    });

    const result = pipeline.publishPost(
      content,
      {
        permanence: 'deletion-compatible',
      },
      {
        signer,
      },
    );
    await expect(result).rejects.toBeInstanceOf(PublicationError);
    await expect(result).rejects.toMatchObject({
      stage: 'anchoring',
      recoverableCid: expect.stringMatching(/^bafk/u),
    });
  });

  it('keeps signers operation-scoped and has no key-bearing pipeline option or property', async () => {
    type PipelineAcceptsPrivateKey = 'privateKey' extends keyof PublicationPipelineOptions
      ? true
      : false;
    type PostOptions = Parameters<PublicationPipeline['publishPost']>[2];
    type OperationRequiresSigner = PostOptions extends { readonly signer: unknown } ? true : false;

    const pipelineAcceptsPrivateKey: PipelineAcceptsPrivateKey = false;
    const operationRequiresSigner: OperationRequiresSigner = true;
    const publishPost = vi.fn(async () => ({
      signature: 'post-transaction-signature',
      slot: 43n,
      finalized: true,
    }));
    const updateProfile = vi.fn(async () => ({
      signature: 'profile-transaction-signature',
      slot: 44n,
      finalized: true,
    }));
    const postSigner = vi.fn(signer);
    const profileSigner = vi.fn(signer);
    const pipeline = new PublicationPipeline({
      identity,
      storage: storage(),
      chain: {
        publishPost,
        updateProfile,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });

    expect(pipelineAcceptsPrivateKey).toBe(false);
    expect(operationRequiresSigner).toBe(true);
    expect(Reflect.ownKeys(pipeline).map(String)).not.toEqual(
      expect.arrayContaining(['privateKey', 'signer']),
    );

    await pipeline.publishPost(
      content,
      { permanence: 'deletion-compatible' },
      {
        signer: postSigner,
        createdAt: fixedCreatedAt,
        nonce: fixedNonce,
      },
    );
    await pipeline.updateProfile(
      profileContent,
      { permanence: 'deletion-compatible' },
      {
        signer: profileSigner,
        createdAt: fixedCreatedAt,
        nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 16),
      },
    );

    expect(postSigner).toHaveBeenCalledOnce();
    expect(postSigner.mock.calls[0]?.[0]).toMatchObject({
      author,
      signingKey: identity.signingKey,
      type: 'post',
    });
    expect(profileSigner).toHaveBeenCalledOnce();
    expect(profileSigner.mock.calls[0]?.[0]).toMatchObject({
      author,
      signingKey: identity.signingKey,
      type: 'profile',
    });
    expect(updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      }),
    );
  });

  it('rejects protected profile plaintext before signing, storage, or anchoring', async () => {
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const profileSigner = vi.fn(signer);
    const updateProfile = vi.fn();
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: {
        publishPost: vi.fn(),
        updateProfile,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });
    const rawPrivateProfile = {
      ...profileContent,
      gender: { visibility: 'private', value: 'must remain private' },
    } as unknown as ProfileContent;

    await expect(
      pipeline.updateProfile(
        rawPrivateProfile,
        { permanence: 'deletion-compatible' },
        {
          signer: profileSigner,
          createdAt: fixedCreatedAt,
          nonce: fixedNonce,
        },
      ),
    ).rejects.toThrow();

    expect(profileSigner).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('fails closed for protected references until authenticated encryption is connected', async () => {
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const publicationSigner = vi.fn(signer);
    const updateProfile = vi.fn();
    const publishPost = vi.fn();
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: {
        publishPost,
        updateProfile,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });
    const postWithoutInlineBody = structuredClone(content);
    delete postWithoutInlineBody.body;

    await expect(
      pipeline.updateProfile(
        {
          ...profileContent,
          pronouns: [{ visibility: 'private', valueReference: protectedValueReference }],
        },
        { permanence: 'deletion-compatible' },
        { signer: publicationSigner, createdAt: fixedCreatedAt, nonce: fixedNonce },
      ),
    ).rejects.toThrow('disabled until the official client can encrypt and verify');
    await expect(
      pipeline.publishPost(
        {
          ...postWithoutInlineBody,
          bodyReference: protectedValueReference,
          visibility: { kind: 'followers' },
        },
        { permanence: 'deletion-compatible' },
        { signer: publicationSigner, createdAt: fixedCreatedAt, nonce: fixedNonce },
      ),
    ).rejects.toThrow('disabled until the official client can encrypt and verify');

    expect(publicationSigner).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature before storage or chain submission', async () => {
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const publishPost = vi.fn(async () => ({
      signature: 'must-not-submit',
      slot: 45n,
      finalized: true,
    }));
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: chainWriter(publishPost),
    });

    const result = pipeline.publishPost(
      content,
      { permanence: 'deletion-compatible' },
      {
        signer: (payload) => {
          const envelope = signPayload(payload, privateKey);
          const signature = decodeMultibaseBase64Url(envelope.proof.signature, 64);
          signature[0] = (signature[0] ?? 0) ^ 1;
          return {
            ...envelope,
            proof: {
              ...envelope.proof,
              signature: encodeMultibaseBase64Url(signature),
            },
          };
        },
        createdAt: fixedCreatedAt,
        nonce: fixedNonce,
      },
    );

    await expect(result).rejects.toMatchObject({
      stage: 'signing',
      message: 'Invalid Ed25519 signature.',
    });
    expect(publish).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });

  it('rejects a signer payload mismatch before storage or chain submission', async () => {
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const publishPost = vi.fn(async () => ({
      signature: 'must-not-submit',
      slot: 46n,
      finalized: true,
    }));
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: chainWriter(publishPost),
    });

    const result = pipeline.publishPost(
      content,
      { permanence: 'deletion-compatible' },
      {
        signer: (payload) =>
          signPayload(
            {
              ...payload,
              content: {
                ...payload.content,
                body: 'A different signed post.',
              },
            },
            privateKey,
          ),
        createdAt: fixedCreatedAt,
        nonce: fixedNonce,
      },
    );

    await expect(result).rejects.toMatchObject({
      stage: 'signing',
      message:
        'Signer returned an envelope that does not exactly match the constructed payload and identity.',
    });
    expect(publish).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });

  it('rejects a signer identity mismatch before storage or chain submission', async () => {
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const publishPost = vi.fn(async () => ({
      signature: 'must-not-submit',
      slot: 47n,
      finalized: true,
    }));
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: chainWriter(publishPost),
    });

    const result = pipeline.publishPost(
      content,
      { permanence: 'deletion-compatible' },
      {
        signer: () =>
          signPayload(
            buildPostPayload(otherIdentity, content, {
              createdAt: fixedCreatedAt,
              nonce: fixedNonce,
            }),
            otherPrivateKey,
          ),
        createdAt: fixedCreatedAt,
        nonce: fixedNonce,
      },
    );

    await expect(result).rejects.toMatchObject({
      stage: 'signing',
      message:
        'Signer returned an envelope that does not exactly match the constructed payload and identity.',
    });
    expect(publish).not.toHaveBeenCalled();
    expect(publishPost).not.toHaveBeenCalled();
  });
});
