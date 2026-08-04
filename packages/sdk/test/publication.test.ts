import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  COMMUNITY_MEMBERSHIP_SCHEMA_VERSION,
  COMMUNITY_SCHEMA_VERSION,
  PROFILE_SCHEMA_VERSION,
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  buildPostPayload,
  communityGovernanceStrategyCommitment,
  createPayloadBuilderIdentity,
  decodeMultibaseBase64Url,
  encodeMultibaseBase64Url,
  signPayload,
  type CommunityContent,
  type CommunityMembershipContent,
  type CommunityMembershipPayload,
  type NetworkId,
  type PostContent,
  type PortablePayload,
  type ProfileContent,
} from '@wetdrool/protocol';
import { MemoryContentAddressedStorage, MultiProviderStorage } from '@wetdrool/storage';

import {
  deriveWokeCommunityAddress,
  deriveWokeCommunityMembershipAddressForNetwork,
  PublicationError,
  PublicationPipeline,
  type AnchorCommunityInput,
  type AnchorCommunityMembershipInput,
  type CommunityPublicationOperationOptions,
  type PublicationPipelineOptions,
  type ProtocolChainWriter,
} from '../src/index.js';

const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const publicKey = ed25519.getPublicKey(privateKey);
const genesis = bs58.encode(Uint8Array.from({ length: 32 }, () => 7));
const program = bs58.encode(Uint8Array.from({ length: 32 }, () => 8));
const identityPda = bs58.encode(Uint8Array.from({ length: 32 }, () => 9));
const network = `droolnet:v1:${genesis}:${program}` as NetworkId;
const author = `wetdroolid:v1:droolnet:v1:${genesis}:${program}:${identityPda}`;
const identity = createPayloadBuilderIdentity(network, author, publicKey, 'root');
const delegatedIdentity = createPayloadBuilderIdentity(network, author, publicKey, 'delegation');
const otherPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 33);
const otherPublicKey = ed25519.getPublicKey(otherPrivateKey);
const otherIdentityPda = bs58.encode(Uint8Array.from({ length: 32 }, () => 10));
const otherAuthor = `wetdroolid:v1:droolnet:v1:${genesis}:${program}:${otherIdentityPda}`;
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
const communityContent: CommunityContent = {
  slug: 'kind-tech',
  name: 'Kind Technology',
  description: 'A community for humane technology.',
  visibility: 'public',
  membershipPolicy: 'open',
  governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  federationPolicy: {
    mode: 'open',
    allow: [],
    block: [],
  },
  replacement: { sequence: 1 },
};
const protectedValueDigest = encodeMultibaseBase64Url(Uint8Array.from({ length: 32 }, () => 11));
const protectedValueReference = {
  cid: `b${'a'.repeat(30)}`,
  digest: protectedValueDigest,
  bytes: 128,
  mediaType: 'application/wetdrool-encrypted-profile-value+json',
  protection: {
    kind: 'encrypted' as const,
    encryptionFormat: 'wetdrool-aes-256-gcm-v1',
    keyEnvelope: {
      id: `wetdroolobj:v1:key-envelope:${protectedValueDigest}`,
    },
    accessPolicy: {
      id: `wetdroolobj:v1:access-policy:${protectedValueDigest}`,
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

function reconcileAbsent(): ProtocolChainWriter['reconcileCommunityCreation'] {
  return vi.fn(async () => ({ status: 'absent' as const }));
}

function chainWriter(publishPost: ProtocolChainWriter['publishPost']): ProtocolChainWriter {
  return {
    publishPost,
    updateProfile: vi.fn(),
    reconcileCommunityCreation: reconcileAbsent(),
    createCommunity: vi.fn(),
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

  it('publishes a signed schema-v2 community with the exact governance commitment', async () => {
    const communityAddress = await deriveWokeCommunityAddress({
      networkId: network,
      creatorIdentityId: author,
      communityNonce: fixedNonce,
    });
    expect(communityAddress).toBe('6anWXF1eLib7wzC6eAfd1zvm4dBxpgyt2jCX5sKyuve');
    const order: string[] = [];
    const stages: string[] = [];
    const publicationStorage = storage();
    const originalPublish = publicationStorage.publish.bind(publicationStorage);
    const publish = vi
      .spyOn(publicationStorage, 'publish')
      .mockImplementation(async (...arguments_) => {
        order.push('store:start');
        const stored = await originalPublish(...arguments_);
        order.push('store:complete');
        return stored;
      });
    const createCommunity = vi.fn(async () => {
      order.push('anchor');
      expect(publish).toHaveBeenCalledOnce();
      return {
        signature: 'community-transaction-signature',
        slot: 45n,
        finalized: true,
        communityAddress,
      };
    });
    const reconcileCommunityCreation = reconcileAbsent();
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: {
        publishPost: vi.fn(),
        updateProfile: vi.fn(),
        reconcileCommunityCreation,
        createCommunity,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
      onProgress: ({ stage }) => stages.push(stage),
    });

    const result = await pipeline.publishCommunity(
      communityContent,
      { permanence: 'deletion-compatible' },
      {
        signer,
        createdAt: fixedCreatedAt,
        nonce: fixedNonce,
      },
    );
    const governance = communityGovernanceStrategyCommitment(communityContent);

    expect(result.envelope.payload).toMatchObject({
      schemaVersion: COMMUNITY_SCHEMA_VERSION,
      type: 'community',
      author,
      content: communityContent,
    });
    expect(createCommunity).toHaveBeenCalledWith({
      identity: author,
      objectId: result.objectId,
      cid: result.storage.cid,
      payloadHash: decodeMultibaseBase64Url(result.envelope.proof.payloadHash, 32),
      communityAddress,
      communityNonce: fixedNonce,
      governanceVersion: governance.governanceVersion,
      governanceStrategyHash: governance.bytes,
      membershipPolicy: 'open',
      visibility: 'public',
    });
    expect(reconcileCommunityCreation).toHaveBeenCalledWith(
      expect.objectContaining({ communityAddress }),
    );
    expect(order).toEqual(['store:start', 'store:complete', 'anchor']);
    expect(stages).toEqual([
      'validating',
      'signing',
      'storing',
      'anchoring',
      'confirming',
      'complete',
    ]);
    expect(result.chain.finalized).toBe(true);
    expect(result.chain.communityAddress).toBe(communityAddress);
  });

  it('reconciles a landed community after its RPC response is lost without resubmitting init', async () => {
    const communityAddress = await deriveWokeCommunityAddress({
      networkId: network,
      creatorIdentityId: author,
      communityNonce: fixedNonce,
    });
    let landedInput: AnchorCommunityInput | undefined;
    const reconcileCommunityCreation = vi.fn(async (input: AnchorCommunityInput) => {
      if (landedInput === undefined) return { status: 'absent' as const };
      expect(input).toEqual(landedInput);
      return {
        status: 'existing' as const,
        confirmation: {
          signature: 'landed-community-transaction-signature',
          slot: 47n,
          finalized: true,
          communityAddress: input.communityAddress,
        },
      };
    });
    const createCommunity = vi.fn(async (input: AnchorCommunityInput) => {
      landedInput = input;
      throw new Error('RPC response lost after transaction landed');
    });
    const pipeline = new PublicationPipeline({
      identity,
      storage: storage(),
      chain: {
        publishPost: vi.fn(),
        updateProfile: vi.fn(),
        reconcileCommunityCreation,
        createCommunity,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });
    const operation = {
      signer,
      createdAt: fixedCreatedAt,
      nonce: fixedNonce,
    };

    await expect(
      pipeline.publishCommunity(communityContent, { permanence: 'deletion-compatible' }, operation),
    ).rejects.toMatchObject({
      stage: 'anchoring',
      recoverableCid: expect.stringMatching(/^bafk/u),
    });
    const result = await pipeline.publishCommunity(
      communityContent,
      { permanence: 'deletion-compatible' },
      operation,
    );

    expect(createCommunity).toHaveBeenCalledOnce();
    expect(reconcileCommunityCreation).toHaveBeenCalledTimes(2);
    const creationInput = createCommunity.mock.calls[0]?.[0];
    const retryInput = reconcileCommunityCreation.mock.calls[1]?.[0];
    expect(creationInput).toBeDefined();
    expect(retryInput).toEqual(creationInput);
    expect(creationInput?.communityAddress).toBe(communityAddress);
    expect(creationInput?.communityNonce).toEqual(fixedNonce);
    expect(result.objectId).toBe(creationInput?.objectId);
    expect(result.storage.cid).toBe(creationInput?.cid);
    expect(result.chain.communityAddress).toBe(communityAddress);
  });

  it('publishes and reconciles the exact member-signed join without a duplicate transition', async () => {
    const communityAddress = await deriveWokeCommunityAddress({
      networkId: network,
      creatorIdentityId: author,
      communityNonce: fixedNonce,
    });
    const membershipAddress = await deriveWokeCommunityMembershipAddressForNetwork({
      networkId: network,
      communityAddress,
      memberIdentityId: author,
    });
    const membershipContent = {
      action: 'join',
      communityAddress,
      member: author,
      replacement: { sequence: 1 },
      roles: ['member'],
      state: 'active',
    } as const satisfies CommunityMembershipContent;
    let landedInput: AnchorCommunityMembershipInput | undefined;
    const reconcileCommunityMembershipAction = vi.fn(
      async (input: AnchorCommunityMembershipInput) => {
        if (landedInput === undefined) return { status: 'ready' as const };
        expect(input).toEqual(landedInput);
        return {
          status: 'existing' as const,
          confirmation: {
            finalized: true,
            membershipAddress,
            signature: 'landed-membership-signature',
            slot: 51n,
          },
        };
      },
    );
    const applyCommunityMembershipAction = vi.fn(async (input: AnchorCommunityMembershipInput) => {
      landedInput = input;
      throw new Error('RPC response lost after member-signed join landed');
    });
    const pipeline = new PublicationPipeline({
      identity,
      storage: storage(),
      chain: {
        applyCommunityMembershipAction,
        createCommunity: vi.fn(),
        follow: vi.fn(),
        publishPost: vi.fn(),
        reconcileCommunityCreation: reconcileAbsent(),
        reconcileCommunityMembershipAction,
        unfollow: vi.fn(),
        updateProfile: vi.fn(),
      },
    });
    const operation = {
      createdAt: fixedCreatedAt,
      expectedCommunityMembershipSequence: 0n,
      expectedMemberIdentitySequence: 0n,
      expectedMembershipPolicySequence: 1n,
      expectedMembershipStateSequence: 0n,
      nonce: fixedNonce,
      signer,
    } as const;

    await expect(
      pipeline.publishOwnCommunityMembership(
        membershipContent,
        { permanence: 'deletion-compatible' },
        operation,
      ),
    ).rejects.toMatchObject({
      recoverableCid: expect.stringMatching(/^bafk/u),
      stage: 'anchoring',
    });
    const result = await pipeline.publishOwnCommunityMembership(
      membershipContent,
      { permanence: 'deletion-compatible' },
      operation,
    );

    expect(applyCommunityMembershipAction).toHaveBeenCalledOnce();
    expect(reconcileCommunityMembershipAction).toHaveBeenCalledTimes(2);
    expect(result.envelope.payload).toMatchObject({
      author,
      content: membershipContent,
      schemaVersion: COMMUNITY_MEMBERSHIP_SCHEMA_VERSION,
      type: 'community-membership',
    });
    expect(result.chain).toEqual({
      finalized: true,
      membershipAddress,
      signature: 'landed-membership-signature',
      slot: 51n,
    });
    expect(landedInput).toMatchObject({
      action: 'join',
      communityAddress,
      expectedCommunityMembershipSequence: 0n,
      expectedMemberIdentitySequence: 0n,
      expectedMembershipPolicySequence: 1n,
      expectedMembershipStateSequence: 0n,
      identity: author,
      memberIdentityAddress: identityPda,
      membershipAddress,
      membershipStateSequence: 1n,
    });
    expect(landedInput?.payloadHash).toEqual(
      decodeMultibaseBase64Url(result.envelope.proof.payloadHash, 32),
    );
  });

  it('anchors the signed membership coordinates when a signer mutates its input after signing', async () => {
    const communityAddress = await deriveWokeCommunityAddress({
      networkId: network,
      creatorIdentityId: author,
      communityNonce: fixedNonce,
    });
    const membershipAddress = await deriveWokeCommunityMembershipAddressForNetwork({
      networkId: network,
      communityAddress,
      memberIdentityId: author,
    });
    const wrongCommunityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 12));
    const mutableContent: CommunityMembershipContent = {
      action: 'join',
      communityAddress,
      member: author,
      replacement: { sequence: 1 },
      roles: ['member'],
      state: 'active',
    };
    const applyCommunityMembershipAction = vi.fn(async (input: AnchorCommunityMembershipInput) => ({
      finalized: true,
      membershipAddress: input.membershipAddress,
      signature: 'mutation-resistant-membership-signature',
      slot: 52n,
    }));
    const mutatingSigner = vi.fn((payload: PortablePayload) => {
      const envelope = signPayload(payload, privateKey);
      mutableContent.communityAddress = wrongCommunityAddress;
      mutableContent.replacement.sequence = 99;
      if (payload.type !== 'community-membership') throw new Error('Expected membership payload.');
      const membershipPayload = payload as CommunityMembershipPayload;
      membershipPayload.content.communityAddress = wrongCommunityAddress;
      membershipPayload.content.replacement.sequence = 99;
      return envelope;
    });
    const pipeline = new PublicationPipeline({
      identity,
      storage: storage(),
      chain: {
        applyCommunityMembershipAction,
        createCommunity: vi.fn(),
        follow: vi.fn(),
        publishPost: vi.fn(),
        reconcileCommunityCreation: reconcileAbsent(),
        reconcileCommunityMembershipAction: vi.fn(async () => ({ status: 'ready' as const })),
        unfollow: vi.fn(),
        updateProfile: vi.fn(),
      },
    });

    const result = await pipeline.publishOwnCommunityMembership(
      mutableContent,
      { permanence: 'deletion-compatible' },
      {
        createdAt: fixedCreatedAt,
        expectedCommunityMembershipSequence: 0n,
        expectedMemberIdentitySequence: 0n,
        expectedMembershipPolicySequence: 1n,
        expectedMembershipStateSequence: 0n,
        nonce: fixedNonce,
        signer: mutatingSigner,
      },
    );

    expect(result.envelope.payload).toMatchObject({
      content: {
        communityAddress,
        replacement: { sequence: 1 },
      },
    });
    expect(applyCommunityMembershipAction).toHaveBeenCalledWith(
      expect.objectContaining({
        communityAddress,
        membershipAddress,
        membershipStateSequence: 1n,
      }),
    );
  });

  it('rejects a stale membership sequence before signing or storage', async () => {
    const communityAddress = await deriveWokeCommunityAddress({
      networkId: network,
      creatorIdentityId: author,
      communityNonce: fixedNonce,
    });
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const membershipSigner = vi.fn(signer);
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: {
        ...chainWriter(vi.fn()),
        applyCommunityMembershipAction: vi.fn(),
        reconcileCommunityMembershipAction: vi.fn(async () => ({ status: 'ready' as const })),
      },
    });

    await expect(
      pipeline.publishOwnCommunityMembership(
        {
          action: 'join',
          communityAddress,
          member: author,
          replacement: { sequence: 1 },
          roles: ['member'],
          state: 'active',
        },
        { permanence: 'deletion-compatible' },
        {
          createdAt: fixedCreatedAt,
          expectedCommunityMembershipSequence: 0n,
          expectedMemberIdentitySequence: 0n,
          expectedMembershipPolicySequence: 1n,
          expectedMembershipStateSequence: 1n,
          nonce: fixedNonce,
          signer: membershipSigner,
        },
      ),
    ).rejects.toMatchObject({
      stage: 'validating',
    });

    expect(membershipSigner).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('rejects a valid confirmation address that is not the derived community PDA', async () => {
    const wrongCommunityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 12));
    const createCommunity = vi.fn(async () => ({
      signature: 'wrong-community-address-signature',
      slot: 48n,
      finalized: true,
      communityAddress: wrongCommunityAddress,
    }));
    const pipeline = new PublicationPipeline({
      identity,
      storage: storage(),
      chain: {
        publishPost: vi.fn(),
        updateProfile: vi.fn(),
        reconcileCommunityCreation: reconcileAbsent(),
        createCommunity,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });

    await expect(
      pipeline.publishCommunity(
        communityContent,
        { permanence: 'deletion-compatible' },
        { signer, createdAt: fixedCreatedAt, nonce: fixedNonce },
      ),
    ).rejects.toMatchObject({
      stage: 'anchoring',
      message: 'Community chain confirmation does not match the PDA derived from the signed nonce.',
      recoverableCid: expect.stringMatching(/^bafk/u),
    });
    expect(createCommunity).toHaveBeenCalledOnce();
  });

  it('rejects omitted community retry coordinates before signing, storage, or anchoring', async () => {
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const communitySigner = vi.fn(signer);
    const createCommunity = vi.fn();
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: {
        publishPost: vi.fn(),
        updateProfile: vi.fn(),
        reconcileCommunityCreation: reconcileAbsent(),
        createCommunity,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });

    await expect(
      pipeline.publishCommunity(communityContent, { permanence: 'deletion-compatible' }, {
        signer: communitySigner,
      } as unknown as CommunityPublicationOperationOptions),
    ).rejects.toMatchObject({
      stage: 'validating',
      message:
        'Community publication requires an explicit valid createdAt and 16-byte nonce that callers persist and reuse for retries.',
    });
    expect(communitySigner).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(createCommunity).not.toHaveBeenCalled();
  });

  it('rejects delegated community publication before signing, storage, or anchoring', async () => {
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const communitySigner = vi.fn(signer);
    const createCommunity = vi.fn();
    const pipeline = new PublicationPipeline({
      identity: delegatedIdentity,
      storage: publicationStorage,
      chain: {
        publishPost: vi.fn(),
        updateProfile: vi.fn(),
        reconcileCommunityCreation: reconcileAbsent(),
        createCommunity,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });

    await expect(
      pipeline.publishCommunity(
        communityContent,
        { permanence: 'deletion-compatible' },
        { signer: communitySigner, createdAt: fixedCreatedAt, nonce: fixedNonce },
      ),
    ).rejects.toMatchObject({
      stage: 'validating',
      message: 'community objects must be signed by an identity root key.',
    });
    expect(communitySigner).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(createCommunity).not.toHaveBeenCalled();
  });

  it('retains stored community evidence when anchoring does not finalize', async () => {
    const communityAddress = await deriveWokeCommunityAddress({
      networkId: network,
      creatorIdentityId: author,
      communityNonce: fixedNonce,
    });
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const createCommunity = vi.fn(async () => ({
      signature: 'unfinalized-community-signature',
      slot: 46n,
      finalized: false,
      communityAddress,
    }));
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: {
        publishPost: vi.fn(),
        updateProfile: vi.fn(),
        reconcileCommunityCreation: reconcileAbsent(),
        createCommunity,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });

    const result = pipeline.publishCommunity(
      { ...communityContent, visibility: 'unlisted' },
      { permanence: 'deletion-compatible' },
      { signer, createdAt: fixedCreatedAt, nonce: fixedNonce },
    );

    await expect(result).rejects.toMatchObject({
      stage: 'confirming',
      recoverableCid: expect.stringMatching(/^bafk/u),
    });
    expect(publish).toHaveBeenCalledOnce();
    expect(createCommunity).toHaveBeenCalledOnce();
  });

  it.each(['private', 'restricted'] as const)(
    'rejects %s communities before signing, storage, or anchoring',
    async (visibility) => {
      const publicationStorage = storage();
      const publish = vi.spyOn(publicationStorage, 'publish');
      const communitySigner = vi.fn(signer);
      const createCommunity = vi.fn();
      const pipeline = new PublicationPipeline({
        identity,
        storage: publicationStorage,
        chain: {
          publishPost: vi.fn(),
          updateProfile: vi.fn(),
          reconcileCommunityCreation: reconcileAbsent(),
          createCommunity,
          follow: vi.fn(),
          unfollow: vi.fn(),
        },
      });

      await expect(
        pipeline.publishCommunity(
          { ...communityContent, visibility },
          { permanence: 'deletion-compatible' },
          { signer: communitySigner, createdAt: fixedCreatedAt, nonce: fixedNonce },
        ),
      ).rejects.toMatchObject({
        stage: 'validating',
        message:
          'Private and restricted community publication is disabled until encrypted publication is connected.',
      });
      expect(communitySigner).not.toHaveBeenCalled();
      expect(publish).not.toHaveBeenCalled();
      expect(createCommunity).not.toHaveBeenCalled();
    },
  );

  it('rejects replacement community manifests before signing, storage, or anchoring', async () => {
    const publicationStorage = storage();
    const publish = vi.spyOn(publicationStorage, 'publish');
    const communitySigner = vi.fn(signer);
    const createCommunity = vi.fn();
    const pipeline = new PublicationPipeline({
      identity,
      storage: publicationStorage,
      chain: {
        publishPost: vi.fn(),
        updateProfile: vi.fn(),
        reconcileCommunityCreation: reconcileAbsent(),
        createCommunity,
        follow: vi.fn(),
        unfollow: vi.fn(),
      },
    });

    await expect(
      pipeline.publishCommunity(
        {
          ...communityContent,
          replacement: {
            sequence: 2,
            replaces: {
              id: `wetdroolobj:v1:community:${protectedValueDigest}`,
            },
          },
        },
        { permanence: 'deletion-compatible' },
        { signer: communitySigner, createdAt: fixedCreatedAt, nonce: fixedNonce },
      ),
    ).rejects.toMatchObject({
      stage: 'validating',
      message:
        'Community publication only supports the first manifest sequence because the current program has no community-manifest update path.',
    });
    expect(communitySigner).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(createCommunity).not.toHaveBeenCalled();
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
        reconcileCommunityCreation: reconcileAbsent(),
        createCommunity: vi.fn(),
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
        reconcileCommunityCreation: reconcileAbsent(),
        createCommunity: vi.fn(),
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
        reconcileCommunityCreation: reconcileAbsent(),
        createCommunity: vi.fn(),
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
