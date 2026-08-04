import { randomBytes } from 'node:crypto';

import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  buildCommunityMembershipPayload,
  buildCommunityPayload,
  canonicalizeEnvelope,
  communityGovernanceStrategyCommitment,
  createPayloadBuilderIdentity,
  encodeMultibaseBase64Url,
  signPayload,
  type CommunityContent,
  type NetworkId,
} from '@wetdrool/protocol';
import { MemoryContentAddressedStorage } from '@wetdrool/storage';

import {
  GOVERNANCE_APPROVAL_BPS,
  GOVERNANCE_QUORUM_BPS,
  GOVERNANCE_STRATEGY_HASH,
  deriveCommunityMembershipAddress,
  deriveGovernanceProposalAddress,
  deriveGovernanceVoteAddress,
  ManifestVerifier,
  OpenIndexer,
  PostgresProjectionStore,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  type ProjectionError,
  type ProposalCreatedEvent,
  type ProposalFinalizedEvent,
  type ProtocolEvent,
  type VoteCastEvent,
} from '../src/index.js';
import { migrate } from '../src/migrate.js';
import { exerciseModerationAfterMemberDeactivation } from './community-membership-lifecycle-fixtures.js';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://wetdrool_indexer_runtime:local-indexer-runtime-only@127.0.0.1:5432/wetdrool';
const migrationDatabaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_MIGRATION_URL'] ??
  process.env['DATABASE_MIGRATION_URL'] ??
  'postgresql://wetdrool_indexer_migration:local-indexer-migration-only@127.0.0.1:5432/wetdrool';

describe('PostgreSQL governance projection integration', () => {
  it.each(['root', 'delegation'] as const)(
    'accepts %s-authorized moderation after member deactivation and replays it',
    async (signingKind) => {
      await migrate(migrationDatabaseUrl);
      const projection = new PostgresProjectionStore(databaseUrl);
      let networkId: string | undefined;
      try {
        const result = await exerciseModerationAfterMemberDeactivation(projection, signingKind);
        networkId = result.networkId;
        expect(result.beforeReplay).toMatchObject([
          {
            membershipAddress: result.membershipAddress,
            action: signingKind === 'root' ? 'remove' : 'ban',
            state: result.state,
            active: false,
            roles: 0,
            manifestVerified: true,
          },
        ]);
        expect(result.afterReplay).toEqual(result.beforeReplay);
      } finally {
        if (networkId !== undefined) {
          await projection.clearProjection(networkId);
        }
        await projection.close();
      }
    },
  );

  it('rolls back invalid transitions and deterministically rebuilds proposal and vote state', async () => {
    await migrate(migrationDatabaseUrl);
    const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
    const networkId = `droolnet:v1:${publicKey()}:${programId}` as NetworkId;
    const secondNetworkId = `droolnet:v1:${publicKey()}:${programId}` as NetworkId;
    const creatorAddress = publicKey();
    const voterAddress = publicKey();
    const creatorIdentityId = `wetdroolid:v1:${networkId}:${creatorAddress}`;
    const voterIdentityId = `wetdroolid:v1:${networkId}:${voterAddress}`;
    const creatorPrivateKey = randomBytes(32);
    const creatorPublicKey = ed25519.getPublicKey(creatorPrivateKey);
    const creatorAuthority = bs58.encode(creatorPublicKey);
    const voterPrivateKey = randomBytes(32);
    const voterPublicKey = ed25519.getPublicKey(voterPrivateKey);
    const voterAuthority = bs58.encode(voterPublicKey);
    const communityAddress = publicKey();
    const creatorMembershipAddress = await deriveCommunityMembershipAddress(
      programId,
      communityAddress,
      creatorAddress,
    );
    const voterMembershipAddress = await deriveCommunityMembershipAddress(
      programId,
      communityAddress,
      voterAddress,
    );
    const proposalManifestHash = digest();
    const proposalAddress = await deriveGovernanceProposalAddress(
      programId,
      communityAddress,
      proposalManifestHash,
    );
    const voteAddress = await deriveGovernanceVoteAddress(programId, proposalAddress, voterAddress);
    const communityContent = {
      slug: 'governance-commons',
      name: 'Governance Commons',
      description: 'A verified public community for deterministic governance projection tests.',
      visibility: 'public',
      membershipPolicy: 'open',
      governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
      federationPolicy: { mode: 'open', allow: [], block: [] },
      replacement: { sequence: 1 },
    } satisfies CommunityContent;
    const governanceCommitment = communityGovernanceStrategyCommitment(communityContent);
    expect(governanceCommitment.digest).toBe(GOVERNANCE_STRATEGY_HASH);
    const storage = new MemoryContentAddressedStorage();
    const communityEnvelope = signPayload(
      buildCommunityPayload(
        createPayloadBuilderIdentity(networkId, creatorIdentityId, creatorPublicKey, 'root'),
        communityContent,
        {
          createdAt: new Date('2026-07-28T17:00:04.000Z'),
          nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
        },
      ),
      creatorPrivateKey,
    );
    const communityReceipt = await storage.put(canonicalizeEnvelope(communityEnvelope), {
      permanence: 'deletion-compatible',
    });
    const creatorMembershipEnvelope = signPayload(
      buildCommunityMembershipPayload(
        createPayloadBuilderIdentity(networkId, creatorIdentityId, creatorPublicKey, 'root'),
        {
          communityAddress,
          member: creatorIdentityId,
          action: 'join',
          state: 'active',
          roles: ['member'],
          replacement: { sequence: 1 },
        },
        {
          createdAt: new Date('2026-07-28T17:00:05.000Z'),
          nonce: randomBytes(16),
        },
      ),
      creatorPrivateKey,
    );
    const creatorMembershipReceipt = await storage.put(
      canonicalizeEnvelope(creatorMembershipEnvelope),
      { permanence: 'deletion-compatible' },
    );
    const voterMembershipEnvelope = signPayload(
      buildCommunityMembershipPayload(
        createPayloadBuilderIdentity(networkId, voterIdentityId, voterPublicKey, 'root'),
        {
          communityAddress,
          member: voterIdentityId,
          action: 'join',
          state: 'active',
          roles: ['member'],
          replacement: { sequence: 1 },
        },
        {
          createdAt: new Date('2026-07-28T17:00:06.000Z'),
          nonce: randomBytes(16),
        },
      ),
      voterPrivateKey,
    );
    const voterMembershipReceipt = await storage.put(
      canonicalizeEnvelope(voterMembershipEnvelope),
      { permanence: 'deletion-compatible' },
    );
    const secondCreatorIdentityId = creatorIdentityId.replace(networkId, secondNetworkId);
    const secondVoterIdentityId = voterIdentityId.replace(networkId, secondNetworkId);
    const secondCommunityEnvelope = signPayload(
      buildCommunityPayload(
        createPayloadBuilderIdentity(
          secondNetworkId,
          secondCreatorIdentityId,
          creatorPublicKey,
          'root',
        ),
        communityContent,
        {
          createdAt: new Date('2026-07-28T17:00:04.000Z'),
          nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 17),
        },
      ),
      creatorPrivateKey,
    );
    const secondCommunityReceipt = await storage.put(
      canonicalizeEnvelope(secondCommunityEnvelope),
      { permanence: 'deletion-compatible' },
    );
    const secondCreatorMembershipEnvelope = signPayload(
      buildCommunityMembershipPayload(
        createPayloadBuilderIdentity(
          secondNetworkId,
          secondCreatorIdentityId,
          creatorPublicKey,
          'root',
        ),
        {
          communityAddress,
          member: secondCreatorIdentityId,
          action: 'join',
          state: 'active',
          roles: ['member'],
          replacement: { sequence: 1 },
        },
        {
          createdAt: new Date('2026-07-28T17:00:05.000Z'),
          nonce: randomBytes(16),
        },
      ),
      creatorPrivateKey,
    );
    const secondCreatorMembershipReceipt = await storage.put(
      canonicalizeEnvelope(secondCreatorMembershipEnvelope),
      { permanence: 'deletion-compatible' },
    );
    const secondVoterMembershipEnvelope = signPayload(
      buildCommunityMembershipPayload(
        createPayloadBuilderIdentity(
          secondNetworkId,
          secondVoterIdentityId,
          voterPublicKey,
          'root',
        ),
        {
          communityAddress,
          member: secondVoterIdentityId,
          action: 'join',
          state: 'active',
          roles: ['member'],
          replacement: { sequence: 1 },
        },
        {
          createdAt: new Date('2026-07-28T17:00:06.000Z'),
          nonce: randomBytes(16),
        },
      ),
      voterPrivateKey,
    );
    const secondVoterMembershipReceipt = await storage.put(
      canonicalizeEnvelope(secondVoterMembershipEnvelope),
      { permanence: 'deletion-compatible' },
    );
    const authorizedCommunityKeys = new Set([
      communityEnvelope.proof.keyId,
      creatorMembershipEnvelope.proof.keyId,
      voterMembershipEnvelope.proof.keyId,
      secondCommunityEnvelope.proof.keyId,
      secondCreatorMembershipEnvelope.proof.keyId,
      secondVoterMembershipEnvelope.proof.keyId,
    ]);
    let eventSeed = 0;
    const eventBase = (slot: bigint) => ({
      networkId,
      programId,
      transactionSignature: signature(),
      transactionIndex: eventSeed++,
      slot,
      logIndex: 0,
      blockTime: new Date(Date.UTC(2026, 6, 28, 17, 0, Number(slot))).toISOString(),
      finalized: true as const,
    });
    const proposal: ProposalCreatedEvent = {
      ...eventBase(7n),
      type: 'proposal-created',
      communityAddress,
      proposalAddress,
      proposerIdentityId: creatorIdentityId,
      authority: creatorAuthority,
      proposerSequence: 3n,
      previousCommunitySequence: 1n,
      manifestHash: proposalManifestHash,
      manifestUri: 'local://postgres-governance-proposal',
      governanceVersion: 1,
      governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
      votingModel: 'one-active-member-one-vote',
      eligibleMemberCount: 2n,
      communityMembershipSequence: 2n,
      opensAtSlot: 8n,
      closesAtSlot: 12n,
      quorumBps: GOVERNANCE_QUORUM_BPS,
      approvalBps: GOVERNANCE_APPROVAL_BPS,
      proposalStateSequence: 1n,
    };
    const vote: VoteCastEvent = {
      ...eventBase(8n),
      type: 'vote-cast',
      communityAddress,
      proposalAddress,
      voteAddress,
      voterIdentityId,
      membershipAddress: voterMembershipAddress,
      authority: voterAuthority,
      voterSequence: 2n,
      membershipStateSequence: 1n,
      proposalStateSequence: 2n,
      choice: 'yes',
      yesVotes: 1n,
      noVotes: 0n,
      abstainVotes: 0n,
    };
    const finalized: ProposalFinalizedEvent = {
      ...eventBase(12n),
      type: 'proposal-finalized',
      communityAddress,
      proposalAddress,
      finalizer: creatorAuthority,
      proposalStateSequence: 3n,
      eligibleMemberCount: 2n,
      yesVotes: 1n,
      noVotes: 0n,
      abstainVotes: 0n,
      participatingVotes: 1n,
      decisiveVotes: 1n,
      quorumBps: GOVERNANCE_QUORUM_BPS,
      approvalBps: GOVERNANCE_APPROVAL_BPS,
      quorumMet: true,
      approvalMet: true,
      outcome: 'accepted',
    };
    const prefix: readonly ProtocolEvent[] = [
      {
        ...eventBase(1n),
        type: 'protocol-initialized',
        configAddress: publicKey(),
      },
      {
        ...eventBase(2n),
        type: 'identity-created',
        identityId: creatorIdentityId,
        identityAddress: creatorAddress,
        rootAuthority: creatorAuthority,
      },
      {
        ...eventBase(3n),
        type: 'identity-created',
        identityId: voterIdentityId,
        identityAddress: voterAddress,
        rootAuthority: voterAuthority,
      },
      {
        ...eventBase(4n),
        type: 'community-created',
        communityAddress,
        creatorIdentityId,
        authority: creatorAuthority,
        communityNonce: communityEnvelope.payload.nonce,
        creatorSequence: 1n,
        manifestCid: communityReceipt.cid,
        manifestHash: communityEnvelope.proof.payloadHash,
        governanceVersion: 1,
        governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
        visibility: 'public',
        membershipPolicy: 'open',
        membershipPolicySequence: 1n,
        membershipSequence: 0n,
      },
      {
        ...eventBase(5n),
        type: 'community-membership-changed',
        communityAddress,
        membershipAddress: creatorMembershipAddress,
        memberIdentityId: creatorIdentityId,
        actorIdentityId: creatorIdentityId,
        authority: creatorAuthority,
        action: 'join',
        state: 'active',
        actorSequence: 2n,
        memberActionSequence: 2n,
        membershipPolicySequence: 1n,
        communityMembershipSequence: 1n,
        activeSinceMembershipSequence: 1n,
        membershipStateSequence: 1n,
        roles: 1,
        manifestCid: creatorMembershipReceipt.cid,
        manifestHash: creatorMembershipEnvelope.proof.payloadHash,
        manifestUri: `ipfs://${creatorMembershipReceipt.cid}`,
      },
      {
        ...eventBase(6n),
        type: 'community-membership-changed',
        communityAddress,
        membershipAddress: voterMembershipAddress,
        memberIdentityId: voterIdentityId,
        actorIdentityId: voterIdentityId,
        authority: voterAuthority,
        action: 'join',
        state: 'active',
        actorSequence: 1n,
        memberActionSequence: 1n,
        membershipPolicySequence: 1n,
        communityMembershipSequence: 2n,
        activeSinceMembershipSequence: 2n,
        membershipStateSequence: 1n,
        roles: 1,
        manifestCid: voterMembershipReceipt.cid,
        manifestHash: voterMembershipEnvelope.proof.payloadHash,
        manifestUri: `ipfs://${voterMembershipReceipt.cid}`,
      },
    ];
    const events: readonly ProtocolEvent[] = [...prefix, proposal, vote, finalized];
    const projection = new PostgresProjectionStore(databaseUrl);
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(storage, {
        authorize: ({ keyId }) => Promise.resolve(authorizedCommunityKeys.has(keyId)),
      }),
    );

    try {
      await projection.clearProjection(networkId);
      for (const event of prefix) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }

      await expect(
        indexer.ingest({
          ...proposal,
          transactionSignature: signature(),
          eligibleMemberCount: 1n,
        }),
      ).rejects.toMatchObject({
        code: 'stale-event',
      } satisfies Partial<ProjectionError>);
      await expect(projection.checkpoint(networkId)).resolves.toBe(6n);
      await expect(
        projection.getGovernanceProposal(networkId, proposalAddress),
      ).resolves.toBeUndefined();

      await expect(
        indexer.ingest({
          ...proposal,
          transactionSignature: signature(),
          proposerIdentityId: voterIdentityId,
        }),
      ).rejects.toMatchObject({
        code: 'stale-event',
      } satisfies Partial<ProjectionError>);
      await expect(indexer.ingest(proposal)).resolves.toMatchObject({ applied: true });

      await expect(
        indexer.ingest({
          ...vote,
          transactionSignature: signature(),
          slot: 9n,
          blockTime: new Date(Date.UTC(2026, 6, 28, 17, 0, 9)).toISOString(),
          membershipAddress: creatorMembershipAddress,
        }),
      ).rejects.toMatchObject({
        code: 'stale-event',
      } satisfies Partial<ProjectionError>);
      await expect(projection.checkpoint(networkId)).resolves.toBe(7n);
      await expect(projection.getGovernanceVote(networkId, voteAddress)).resolves.toBeUndefined();
      await expect(
        projection.getGovernanceProposal(networkId, proposalAddress),
      ).resolves.toMatchObject({
        stateSequence: 1n,
        yesVotes: 0n,
      });

      await expect(indexer.ingest(vote)).resolves.toMatchObject({ applied: true });
      await expect(
        indexer.ingest({
          ...vote,
          transactionSignature: signature(),
          voterSequence: 2n,
          proposalStateSequence: 3n,
          noVotes: 1n,
        }),
      ).rejects.toMatchObject({
        code: 'stale-event',
      } satisfies Partial<ProjectionError>);
      await expect(
        projection.getGovernanceVotesByProposal(networkId, proposalAddress),
      ).resolves.toHaveLength(1);

      await expect(
        indexer.ingest({
          ...finalized,
          transactionSignature: signature(),
          slot: 11n,
          blockTime: new Date(Date.UTC(2026, 6, 28, 17, 0, 11)).toISOString(),
        }),
      ).rejects.toMatchObject({
        code: 'stale-event',
      } satisfies Partial<ProjectionError>);
      await expect(projection.checkpoint(networkId)).resolves.toBe(8n);
      await expect(indexer.ingest(finalized)).resolves.toMatchObject({ applied: true });
      await expect(indexer.ingest(finalized)).resolves.toMatchObject({ applied: false });

      const expected = stableJson({
        proposal: await projection.getGovernanceProposal(networkId, proposalAddress),
        vote: await projection.getGovernanceVote(networkId, voteAddress),
        proposals: await projection.getGovernanceProposalsByCommunity(networkId, communityAddress),
        votes: await projection.getGovernanceVotesByProposal(networkId, proposalAddress),
        checkpoint: await projection.checkpoint(networkId),
      });
      expect(expected).toContain('"outcome":"accepted"');
      expect(expected).toContain('"stateSequence":"3"');

      const rebuilt = await indexer.rebuild(networkId, [...events].reverse());
      expect(rebuilt).toHaveLength(9);
      const actual = stableJson({
        proposal: await projection.getGovernanceProposal(networkId, proposalAddress),
        vote: await projection.getGovernanceVote(networkId, voteAddress),
        proposals: await projection.getGovernanceProposalsByCommunity(networkId, communityAddress),
        votes: await projection.getGovernanceVotesByProposal(networkId, proposalAddress),
        checkpoint: await projection.checkpoint(networkId),
      });
      expect(actual).toBe(expected);

      const secondNetworkEvents = events.map((item) => {
        const moved = moveEventToNetwork(item, networkId, secondNetworkId);
        if (moved.type === 'community-created') {
          return {
            ...moved,
            communityNonce: secondCommunityEnvelope.payload.nonce,
            manifestCid: secondCommunityReceipt.cid,
            manifestHash: secondCommunityEnvelope.proof.payloadHash,
          };
        }
        if (moved.type === 'community-membership-changed') {
          const manifest =
            moved.memberIdentityId === secondCreatorIdentityId
              ? {
                  envelope: secondCreatorMembershipEnvelope,
                  receipt: secondCreatorMembershipReceipt,
                }
              : {
                  envelope: secondVoterMembershipEnvelope,
                  receipt: secondVoterMembershipReceipt,
                };
          return {
            ...moved,
            manifestCid: manifest.receipt.cid,
            manifestHash: manifest.envelope.proof.payloadHash,
            manifestUri: `ipfs://${manifest.receipt.cid}`,
          };
        }
        return moved;
      });
      for (const event of secondNetworkEvents) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }
      await expect(projection.getCommunity(networkId, communityAddress)).resolves.toMatchObject({
        networkId,
        communityAddress,
      });
      await expect(
        projection.getCommunity(secondNetworkId, communityAddress),
      ).resolves.toMatchObject({
        networkId: secondNetworkId,
        communityAddress,
      });
      await expect(
        projection.getGovernanceProposal(networkId, proposalAddress),
      ).resolves.toMatchObject({ networkId, proposalAddress });
      await expect(
        projection.getGovernanceProposal(secondNetworkId, proposalAddress),
      ).resolves.toMatchObject({ networkId: secondNetworkId, proposalAddress });
      await expect(
        projection.getGovernanceVote(secondNetworkId, voteAddress),
      ).resolves.toMatchObject({ networkId: secondNetworkId, voteAddress });
    } finally {
      await projection.clearProjection(networkId);
      await projection.clearProjection(secondNetworkId);
      await projection.close();
    }
  });
});

function publicKey(): string {
  return bs58.encode(randomBytes(32));
}

function signature(): string {
  return bs58.encode(randomBytes(64));
}

function digest(): string {
  return encodeMultibaseBase64Url(randomBytes(32));
}

function moveEventToNetwork(
  event: ProtocolEvent,
  sourceNetworkId: NetworkId,
  targetNetworkId: NetworkId,
): ProtocolEvent {
  return Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(sourceNetworkId, targetNetworkId) : value,
    ]),
  ) as unknown as ProtocolEvent;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}
