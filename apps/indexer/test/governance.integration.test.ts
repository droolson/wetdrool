import { randomBytes } from 'node:crypto';

import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import { encodeMultibaseBase64Url, type NetworkId } from '@wokesocial/protocol';
import { MemoryContentAddressedStorage } from '@wokesocial/storage';

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

const databaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';

describe('PostgreSQL governance projection integration', () => {
  it('rolls back invalid transitions and deterministically rebuilds proposal and vote state', async () => {
    await migrate(databaseUrl);
    const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
    const networkId = `wokenet:v1:${publicKey()}:${programId}` as NetworkId;
    const secondNetworkId = `wokenet:v1:${publicKey()}:${programId}` as NetworkId;
    const creatorAddress = publicKey();
    const voterAddress = publicKey();
    const creatorIdentityId = `wokesocialid:v1:${networkId}:${creatorAddress}`;
    const voterIdentityId = `wokesocialid:v1:${networkId}:${voterAddress}`;
    const creatorAuthority = publicKey();
    const voterAuthority = publicKey();
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
      proposerSequence: 4n,
      previousCommunitySequence: 3n,
      manifestHash: proposalManifestHash,
      manifestUri: 'local://postgres-governance-proposal',
      governanceVersion: 1,
      governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
      votingModel: 'one-active-member-one-vote',
      eligibleMemberCount: 2n,
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
      voterSequence: 1n,
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
        creatorSequence: 1n,
        manifestCid: `b${'a'.repeat(58)}`,
        manifestHash: digest(),
        governanceVersion: 1,
        governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
      },
      {
        ...eventBase(5n),
        type: 'community-membership-changed',
        communityAddress,
        membershipAddress: creatorMembershipAddress,
        memberIdentityId: creatorIdentityId,
        assignedByIdentityId: creatorIdentityId,
        authority: creatorAuthority,
        authoritySequence: 2n,
        membershipStateSequence: 1n,
        roles: 1,
        active: true,
      },
      {
        ...eventBase(6n),
        type: 'community-membership-changed',
        communityAddress,
        membershipAddress: voterMembershipAddress,
        memberIdentityId: voterIdentityId,
        assignedByIdentityId: creatorIdentityId,
        authority: creatorAuthority,
        authoritySequence: 3n,
        membershipStateSequence: 1n,
        roles: 1,
        active: true,
      },
    ];
    const events: readonly ProtocolEvent[] = [...prefix, proposal, vote, finalized];
    const projection = new PostgresProjectionStore(databaseUrl);
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(new MemoryContentAddressedStorage(), {
        authorize: () => Promise.resolve(false),
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

      for (const event of events.map((item) =>
        moveEventToNetwork(item, networkId, secondNetworkId),
      )) {
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
