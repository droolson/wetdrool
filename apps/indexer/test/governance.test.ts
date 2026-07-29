import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import {
  buildCommunityMembershipPayload,
  buildCommunityPayload,
  canonicalizeEnvelope,
  createPayloadBuilderIdentity,
  encodeMultibaseBase64Url,
  getContentCid,
  signPayload,
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  type CommunityContent,
  type NetworkId,
} from '@wokesocial/protocol';
import { MemoryContentAddressedStorage } from '@wokesocial/storage';

import {
  AnchorEventDecodingError,
  buildIndexerApp,
  decodeAnchorEventLog,
  deriveCommunityMembershipAddress,
  deriveGovernanceProposalAddress,
  deriveGovernanceVoteAddress,
  GOVERNANCE_APPROVAL_BPS,
  GOVERNANCE_QUORUM_BPS,
  GOVERNANCE_STRATEGY_HASH,
  ManifestVerifier,
  MemoryProjectionStore,
  OpenIndexer,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  SolanaEventMaterializer,
  type ProjectionError,
  type ProposalCreatedEvent,
  type ProposalFinalizedEvent,
  type ProtocolEvent,
  type SolanaEventMaterializationError,
  type VoteCastEvent,
} from '../src/index.js';

const strategyBytes = Uint8Array.from([
  157, 228, 91, 3, 18, 196, 74, 120, 218, 76, 61, 70, 178, 130, 168, 136, 138, 236, 102, 13, 66, 36,
  42, 13, 118, 19, 131, 75, 148, 53, 117, 113,
]);
const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
const networkId = `wokenet:v1:${publicKey(1)}:${programId}` as NetworkId;
const configAddress = publicKey(2);
const creatorAddress = publicKey(3);
const voterAddress = publicKey(4);
const creatorIdentityId = `wokesocialid:v1:${networkId}:${creatorAddress}`;
const voterIdentityId = `wokesocialid:v1:${networkId}:${voterAddress}`;
const creatorPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 51);
const creatorAuthority = bs58.encode(ed25519.getPublicKey(creatorPrivateKey));
const voterPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => 180 - index);
const voterAuthority = bs58.encode(ed25519.getPublicKey(voterPrivateKey));
const communityAddress = publicKey(7);
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
const proposalManifestHash = digest(30);
const proposalAddress = await deriveGovernanceProposalAddress(
  programId,
  communityAddress,
  proposalManifestHash,
);
const voteAddress = await deriveGovernanceVoteAddress(programId, proposalAddress, voterAddress);
const creatorBuilderIdentity = createPayloadBuilderIdentity(
  networkId,
  creatorIdentityId,
  ed25519.getPublicKey(creatorPrivateKey),
  'root',
);
const voterBuilderIdentity = createPayloadBuilderIdentity(
  networkId,
  voterIdentityId,
  ed25519.getPublicKey(voterPrivateKey),
  'root',
);
const communityContent = {
  slug: 'governance-lab',
  name: 'Governance Lab',
  description: 'A verified governance fixture.',
  visibility: 'public',
  membershipPolicy: 'open',
  governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  federationPolicy: { mode: 'open', allow: [], block: [] },
  replacement: { sequence: 1 },
} satisfies CommunityContent;
const communityEnvelope = signPayload(
  buildCommunityPayload(creatorBuilderIdentity, communityContent, {
    createdAt: new Date('2026-07-28T12:04:00.000Z'),
    nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 1),
  }),
  creatorPrivateKey,
);
const communityManifestBytes = canonicalizeEnvelope(communityEnvelope);
const communityManifestCid = await getContentCid(communityManifestBytes);
const creatorMembershipEnvelope = signPayload(
  buildCommunityMembershipPayload(
    creatorBuilderIdentity,
    {
      communityAddress,
      member: creatorIdentityId,
      action: 'join',
      state: 'active',
      roles: ['member'],
      replacement: { sequence: 1 },
    },
    {
      createdAt: new Date('2026-07-28T12:05:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 21),
    },
  ),
  creatorPrivateKey,
);
const creatorMembershipBytes = canonicalizeEnvelope(creatorMembershipEnvelope);
const creatorMembershipCid = await getContentCid(creatorMembershipBytes);
const voterMembershipEnvelope = signPayload(
  buildCommunityMembershipPayload(
    voterBuilderIdentity,
    {
      communityAddress,
      member: voterIdentityId,
      action: 'join',
      state: 'active',
      roles: ['member'],
      replacement: { sequence: 1 },
    },
    {
      createdAt: new Date('2026-07-28T12:06:00.000Z'),
      nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 41),
    },
  ),
  voterPrivateKey,
);
const voterMembershipBytes = canonicalizeEnvelope(voterMembershipEnvelope);
const voterMembershipCid = await getContentCid(voterMembershipBytes);
const communityManifestByCid = new Map([
  [communityManifestCid, communityManifestBytes],
  [creatorMembershipCid, creatorMembershipBytes],
  [voterMembershipCid, voterMembershipBytes],
]);
const communityManifestSource = {
  get(cid: string): Promise<Uint8Array> {
    const bytes = communityManifestByCid.get(cid);
    return bytes === undefined
      ? Promise.reject(new Error(`Unknown test CID ${cid}.`))
      : Promise.resolve(bytes);
  },
};

describe('community manifest verification invariants', () => {
  const verifier = new ManifestVerifier(communityManifestSource, {
    authorize: () => Promise.resolve(true),
  });

  it('rejects missing and mismatched schema-v2 PDA nonces', async () => {
    const creation = communityCreationEvent();
    const { communityNonce, ...missingNonce } = creation;
    expect(communityNonce).toBe(communityEnvelope.payload.nonce);
    await expect(verifier.forEvent(missingNonce as ProtocolEvent)).rejects.toMatchObject({
      code: 'object-mismatch',
    });
    await expect(
      verifier.forEvent({
        ...creation,
        communityNonce: encodeMultibaseBase64Url(Uint8Array.from({ length: 16 }, () => 99)),
      }),
    ).rejects.toMatchObject({ code: 'object-mismatch' });
  });

  it('rejects non-creation root and delegated community signing keys terminally', async () => {
    await expect(
      verifier.forEvent({ ...communityCreationEvent(), authority: publicKey(99) }),
    ).rejects.toMatchObject({ code: 'unauthorized-key' });

    const delegatedBytes = Buffer.from(
      new TextDecoder().decode(communityManifestBytes).replaceAll('#root/', '#delegation/'),
      'utf8',
    );
    const delegatedCid = await getContentCid(delegatedBytes);
    const delegatedSource = {
      get(cid: string): Promise<Uint8Array> {
        return cid === delegatedCid
          ? Promise.resolve(delegatedBytes)
          : Promise.reject(new Error('Unknown delegated community fixture.'));
      },
    };
    await expect(
      new ManifestVerifier(delegatedSource, {
        authorize: () => Promise.resolve(true),
      }).forEvent({
        ...communityCreationEvent(),
        manifestCid: delegatedCid,
      }),
    ).rejects.toMatchObject({ code: 'manifest-invalid' });
  });
});

describe('governance Anchor events', () => {
  it('strictly decodes and materializes all three final IDL layouts', async () => {
    const projection = new MemoryProjectionStore();
    const materializer = new SolanaEventMaterializer(
      new MemoryContentAddressedStorage(),
      projection,
    );
    const encodedProposal = proposalAnchorEvent();
    const encodedVote = voteAnchorEvent();
    const encodedFinalized = finalizedAnchorEvent();

    const decodedProposal = decodeAnchorEventLog(encodedProposal);
    const decodedVote = decodeAnchorEventLog(encodedVote);
    const decodedFinalized = decodeAnchorEventLog(encodedFinalized);

    expect(decodedProposal).toMatchObject({
      kind: 'proposal-created',
      proposal: proposalAddress,
      proposerIdentity: creatorAddress,
      proposerSequence: 3n,
      previousCommunitySequence: 1n,
      governanceVersion: 1,
      votingModel: 'one-active-member-one-vote',
      eligibleMemberCount: 2n,
      communityMembershipSequence: 2n,
      quorumBps: GOVERNANCE_QUORUM_BPS,
      approvalBps: GOVERNANCE_APPROVAL_BPS,
    });
    expect(decodedVote).toMatchObject({
      kind: 'vote-cast',
      vote: voteAddress,
      voterIdentity: voterAddress,
      choice: 'yes',
      yesVotes: 1n,
      noVotes: 0n,
      abstainVotes: 0n,
    });
    expect(decodedFinalized).toMatchObject({
      kind: 'proposal-finalized',
      finalizer: creatorAuthority,
      participatingVotes: 1n,
      decisiveVotes: 1n,
      quorumMet: true,
      approvalMet: true,
      outcome: 'accepted',
    });

    await expect(materializer.materialize(decodedProposal, context(7n, 71))).resolves.toMatchObject(
      {
        type: 'proposal-created',
        communityAddress,
        proposalAddress,
        proposerIdentityId: creatorIdentityId,
        manifestHash: proposalManifestHash,
        governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
        manifestUri: 'local://proposal-one',
      },
    );
    await expect(materializer.materialize(decodedVote, context(8n, 72))).resolves.toMatchObject({
      type: 'vote-cast',
      proposalAddress,
      voteAddress,
      voterIdentityId,
      membershipAddress: voterMembershipAddress,
    });
    await expect(
      materializer.materialize(decodedFinalized, context(12n, 73)),
    ).resolves.toMatchObject({
      type: 'proposal-finalized',
      proposalAddress,
      outcome: 'accepted',
    });
  });

  it('rejects unknown enums, trailing bytes, unsupported versions, slot drift, and invalid constants', async () => {
    const invalidModel = proposalAnchorEvent({ votingModel: 9 });
    expect(() => decodeAnchorEventLog(invalidModel)).toThrow(AnchorEventDecodingError);

    const trailing = Buffer.concat([
      Buffer.from(proposalAnchorEvent(), 'base64'),
      Buffer.from([0]),
    ]).toString('base64');
    expect(() => decodeAnchorEventLog(trailing)).toThrow(/trailing bytes/u);

    const projection = new MemoryProjectionStore();
    const materializer = new SolanaEventMaterializer(
      new MemoryContentAddressedStorage(),
      projection,
    );
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(proposalAnchorEvent({ eventVersion: 2 })),
        context(7n, 74),
      ),
    ).rejects.toMatchObject({
      code: 'unsupported-version',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(decodeAnchorEventLog(proposalAnchorEvent()), context(8n, 75)),
    ).rejects.toMatchObject({
      code: 'slot-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(proposalAnchorEvent({ quorumBps: 4_999 })),
        context(7n, 76),
      ),
    ).rejects.toMatchObject({
      code: 'event-invalid',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(finalizedAnchorEvent({ outcome: 0 })),
        context(12n, 77),
      ),
    ).rejects.toMatchObject({
      code: 'event-invalid',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(proposalAnchorEvent({ proposalAddress: publicKey(78) })),
        context(7n, 78),
      ),
    ).rejects.toMatchObject({
      code: 'account-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await projection.apply(governanceEvents()[0] as ProtocolEvent);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(proposalAnchorEvent({ configAddress: publicKey(79) })),
        context(7n, 79),
      ),
    ).rejects.toMatchObject({
      code: 'account-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
  });
});

describe('governance projection', () => {
  it('rejects open self-join events for effectively private communities', async () => {
    const privateContent = {
      ...communityContent,
      visibility: 'private',
    } satisfies CommunityContent;
    const privateEnvelope = signPayload(
      buildCommunityPayload(creatorBuilderIdentity, privateContent, {
        createdAt: new Date('2026-07-28T12:04:00.000Z'),
        nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 61),
      }),
      creatorPrivateKey,
    );
    const privateBytes = canonicalizeEnvelope(privateEnvelope);
    const privateCid = await getContentCid(privateBytes);
    communityManifestByCid.set(privateCid, privateBytes);
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(communityManifestSource, {
        authorize: () => Promise.resolve(true),
      }),
    );
    const events = governanceEvents();
    for (const event of events.slice(0, 3)) {
      await indexer.ingest(event);
    }
    const creation = events[3];
    if (creation?.type !== 'community-created') {
      throw new Error('Expected a community creation fixture.');
    }
    await indexer.ingest({
      ...creation,
      communityNonce: privateEnvelope.payload.nonce,
      manifestCid: privateCid,
      manifestHash: privateEnvelope.proof.payloadHash,
      visibility: 'private',
    });

    await expect(indexer.ingest(events[4] as ProtocolEvent)).rejects.toMatchObject({
      code: 'stale-event',
    } satisfies Partial<ProjectionError>);
    await expect(projection.getCommunityMemberships(networkId, communityAddress)).resolves.toEqual(
      [],
    );
    await expect(projection.checkpoint(networkId)).resolves.toBe(4n);
  });

  it('isolates identical identity, community, proposal, membership, and vote addresses by network', async () => {
    const secondNetworkId = `wokenet:v1:${publicKey(140)}:${programId}` as NetworkId;
    const projection = new MemoryProjectionStore();
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(communityManifestSource, {
        authorize: () => Promise.resolve(true),
      }),
    );
    const firstNetworkEvents = governanceEvents();
    const secondCreatorIdentityId = creatorIdentityId.replace(networkId, secondNetworkId);
    const secondVoterIdentityId = voterIdentityId.replace(networkId, secondNetworkId);
    const secondEnvelope = signPayload(
      buildCommunityPayload(
        createPayloadBuilderIdentity(
          secondNetworkId,
          secondCreatorIdentityId,
          ed25519.getPublicKey(creatorPrivateKey),
          'root',
        ),
        communityContent,
        {
          createdAt: new Date('2026-07-28T12:04:00.000Z'),
          nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 2),
        },
      ),
      creatorPrivateKey,
    );
    const secondBytes = canonicalizeEnvelope(secondEnvelope);
    const secondCid = await getContentCid(secondBytes);
    communityManifestByCid.set(secondCid, secondBytes);
    const secondCreatorMembershipEnvelope = signPayload(
      buildCommunityMembershipPayload(
        createPayloadBuilderIdentity(
          secondNetworkId,
          secondCreatorIdentityId,
          ed25519.getPublicKey(creatorPrivateKey),
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
          createdAt: new Date('2026-07-28T12:05:00.000Z'),
          nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 22),
        },
      ),
      creatorPrivateKey,
    );
    const secondCreatorMembershipBytes = canonicalizeEnvelope(secondCreatorMembershipEnvelope);
    const secondCreatorMembershipCid = await getContentCid(secondCreatorMembershipBytes);
    communityManifestByCid.set(secondCreatorMembershipCid, secondCreatorMembershipBytes);
    const secondVoterMembershipEnvelope = signPayload(
      buildCommunityMembershipPayload(
        createPayloadBuilderIdentity(
          secondNetworkId,
          secondVoterIdentityId,
          ed25519.getPublicKey(voterPrivateKey),
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
          createdAt: new Date('2026-07-28T12:06:00.000Z'),
          nonce: Uint8Array.from({ length: 16 }, (_, index) => index + 42),
        },
      ),
      voterPrivateKey,
    );
    const secondVoterMembershipBytes = canonicalizeEnvelope(secondVoterMembershipEnvelope);
    const secondVoterMembershipCid = await getContentCid(secondVoterMembershipBytes);
    communityManifestByCid.set(secondVoterMembershipCid, secondVoterMembershipBytes);
    const secondNetworkEvents = firstNetworkEvents.map((event) => {
      const moved = moveEventToNetwork(event, secondNetworkId);
      if (moved.type === 'community-created') {
        return {
          ...moved,
          communityNonce: secondEnvelope.payload.nonce,
          manifestCid: secondCid,
          manifestHash: secondEnvelope.proof.payloadHash,
        };
      }
      if (moved.type === 'community-membership-changed') {
        const manifest =
          moved.memberIdentityId === secondCreatorIdentityId
            ? {
                envelope: secondCreatorMembershipEnvelope,
                cid: secondCreatorMembershipCid,
              }
            : {
                envelope: secondVoterMembershipEnvelope,
                cid: secondVoterMembershipCid,
              };
        return {
          ...moved,
          manifestCid: manifest.cid,
          manifestHash: manifest.envelope.proof.payloadHash,
          manifestUri: `ipfs://${manifest.cid}`,
        };
      }
      return moved;
    });

    for (const event of [...firstNetworkEvents, ...secondNetworkEvents]) {
      await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
    }

    await expect(projection.getIdentity(creatorIdentityId)).resolves.toMatchObject({
      networkId,
      identityAddress: creatorAddress,
    });
    await expect(projection.getIdentity(secondCreatorIdentityId)).resolves.toMatchObject({
      networkId: secondNetworkId,
      identityAddress: creatorAddress,
    });
    await expect(projection.getCommunity(networkId, communityAddress)).resolves.toMatchObject({
      networkId,
      communityAddress,
    });
    await expect(projection.getCommunity(secondNetworkId, communityAddress)).resolves.toMatchObject(
      {
        networkId: secondNetworkId,
        communityAddress,
      },
    );
    await expect(
      projection.getCommunityMemberships(networkId, communityAddress),
    ).resolves.toHaveLength(2);
    await expect(
      projection.getCommunityMemberships(secondNetworkId, communityAddress),
    ).resolves.toHaveLength(2);
    await expect(
      projection.getGovernanceProposal(networkId, proposalAddress),
    ).resolves.toMatchObject({ networkId, proposalAddress });
    await expect(
      projection.getGovernanceProposal(secondNetworkId, proposalAddress),
    ).resolves.toMatchObject({ networkId: secondNetworkId, proposalAddress });
    await expect(projection.getGovernanceVote(networkId, voteAddress)).resolves.toMatchObject({
      networkId,
      voteAddress,
    });
    await expect(projection.getGovernanceVote(secondNetworkId, voteAddress)).resolves.toMatchObject(
      { networkId: secondNetworkId, voteAddress },
    );
  });

  it('projects a lifecycle idempotently, serves lookups, and rebuilds deterministically', async () => {
    const fixture = await fixtureThrough(9);
    const proposal = await fixture.projection.getGovernanceProposal(networkId, proposalAddress);
    const vote = await fixture.projection.getGovernanceVote(networkId, voteAddress);
    expect(proposal).toMatchObject({
      proposalAddress,
      communityAddress,
      proposerIdentityId: creatorIdentityId,
      manifestVerified: false,
      yesVotes: 1n,
      noVotes: 0n,
      abstainVotes: 0n,
      stateSequence: 3n,
      outcome: 'accepted',
      participatingVotes: 1n,
      decisiveVotes: 1n,
      quorumMet: true,
      approvalMet: true,
      finalizedSlot: 12n,
    });
    expect(vote).toMatchObject({
      voteAddress,
      voterIdentityId,
      proposalStateSequence: 2n,
      choice: 'yes',
      castSlot: 8n,
    });
    await expect(fixture.indexer.ingest(fixture.events[8] as ProtocolEvent)).resolves.toMatchObject(
      { applied: false },
    );

    const app = await buildIndexerApp({ projection: fixture.projection, logger: false });
    try {
      const proposalResponse = await app.inject({
        method: 'GET',
        url: `/v1/governance/proposals/${proposalAddress}?network=${encodeURIComponent(networkId)}`,
      });
      expect(proposalResponse.statusCode).toBe(200);
      expect(proposalResponse.json()).toMatchObject({
        canonical: false,
        proposal: {
          proposalAddress,
          eligibleMemberCount: '2',
          yesVotes: '1',
          stateSequence: '3',
          outcome: 'accepted',
        },
      });
      const votesResponse = await app.inject({
        method: 'GET',
        url: `/v1/governance/proposals/${proposalAddress}/votes?network=${encodeURIComponent(networkId)}`,
      });
      expect(votesResponse.statusCode).toBe(200);
      expect(votesResponse.json()).toMatchObject({
        canonical: false,
        proposalAddress,
        votes: [{ voteAddress, voterSequence: '2', proposalStateSequence: '2' }],
      });
      const voteResponse = await app.inject({
        method: 'GET',
        url: `/v1/governance/votes/${voteAddress}?network=${encodeURIComponent(networkId)}`,
      });
      expect(voteResponse.statusCode).toBe(200);
      const listResponse = await app.inject({
        method: 'GET',
        url: `/v1/communities/${communityAddress}/proposals?network=${encodeURIComponent(networkId)}`,
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toMatchObject({
        canonical: false,
        proposals: [{ proposalAddress }],
      });
      const invalid = await app.inject({
        method: 'GET',
        url: `/v1/governance/proposals/not_base58!?network=${encodeURIComponent(networkId)}`,
      });
      expect(invalid.statusCode).toBe(400);
      const missingNetwork = await app.inject({
        method: 'GET',
        url: `/v1/governance/proposals/${proposalAddress}`,
      });
      expect(missingNetwork.statusCode).toBe(400);
      const shortBase58 = await app.inject({
        method: 'GET',
        url: `/v1/governance/proposals/abc?network=${encodeURIComponent(networkId)}`,
      });
      expect(shortBase58.statusCode).toBe(400);
    } finally {
      await app.close();
    }

    const before = stableJson({
      proposal,
      vote,
      checkpoint: await fixture.projection.checkpoint(networkId),
    });
    const rebuilt = await fixture.indexer.rebuild(networkId, [...fixture.events].reverse());
    expect(rebuilt).toHaveLength(9);
    const after = stableJson({
      proposal: await fixture.projection.getGovernanceProposal(networkId, proposalAddress),
      vote: await fixture.projection.getGovernanceVote(networkId, voteAddress),
      checkpoint: await fixture.projection.checkpoint(networkId),
    });
    expect(after).toBe(before);
  });

  it('rejects proposal count, sequence, identity, strategy, address, and manifest substitutions', async () => {
    const fixture = await fixtureThrough(6);
    const proposal = fixture.events[6] as ProposalCreatedEvent;
    const variants: readonly ProposalCreatedEvent[] = [
      {
        ...proposal,
        transactionSignature: signature(80),
        eligibleMemberCount: 1n,
      },
      {
        ...proposal,
        transactionSignature: signature(81),
        previousCommunitySequence: 2n,
      },
      {
        ...proposal,
        transactionSignature: signature(82),
        proposerIdentityId: voterIdentityId,
      },
      {
        ...proposal,
        transactionSignature: signature(83),
        governanceVersion: 2,
      },
      {
        ...proposal,
        transactionSignature: signature(84),
        governanceStrategyHash: digest(84),
      },
      {
        ...proposal,
        transactionSignature: signature(85),
        communityAddress: publicKey(85),
      },
      {
        ...proposal,
        transactionSignature: signature(86),
        proposalAddress: publicKey(86),
      },
    ];
    for (const variant of variants) {
      await expect(fixture.indexer.ingest(variant)).rejects.toBeInstanceOf(Error);
      await expect(
        fixture.projection.getGovernanceProposal(networkId, proposalAddress),
      ).resolves.toBeUndefined();
      await expect(fixture.projection.checkpoint(networkId)).resolves.toBe(6n);
    }

    await expect(fixture.indexer.ingest(proposal)).resolves.toMatchObject({ applied: true });
    const duplicateManifest: ProposalCreatedEvent = {
      ...proposal,
      transactionSignature: signature(87),
      slot: 9n,
      blockTime: blockTime(9n),
      proposerSequence: 5n,
      previousCommunitySequence: 4n,
      opensAtSlot: 10n,
      closesAtSlot: 14n,
    };
    await expect(fixture.indexer.ingest(duplicateManifest)).rejects.toMatchObject({
      code: 'stale-event',
    } satisfies Partial<ProjectionError>);
  });

  it('rolls back duplicate votes and every relationship, timing, sequence, and tally substitution', async () => {
    const fixture = await fixtureThrough(7);
    const vote = fixture.events[7] as VoteCastEvent;
    const invalidVotes: readonly VoteCastEvent[] = [
      {
        ...vote,
        transactionSignature: signature(90),
        proposalAddress: publicKey(90),
      },
      {
        ...vote,
        transactionSignature: signature(91),
        communityAddress: publicKey(91),
      },
      {
        ...vote,
        transactionSignature: signature(92),
        voterIdentityId: creatorIdentityId,
      },
      {
        ...vote,
        transactionSignature: signature(93),
        membershipAddress: creatorMembershipAddress,
      },
      {
        ...vote,
        transactionSignature: signature(94),
        membershipStateSequence: 2n,
      },
      {
        ...vote,
        transactionSignature: signature(95),
        proposalStateSequence: 3n,
      },
      {
        ...vote,
        transactionSignature: signature(96),
        choice: 'no',
      },
      {
        ...vote,
        transactionSignature: signature(97),
        noVotes: 1n,
      },
      {
        ...vote,
        transactionSignature: signature(98),
        voteAddress: publicKey(98),
      },
      {
        ...vote,
        transactionSignature: signature(99),
        slot: 12n,
        blockTime: blockTime(12n),
      },
    ];
    for (const invalidVote of invalidVotes) {
      await expect(fixture.indexer.ingest(invalidVote)).rejects.toBeInstanceOf(Error);
      await expect(
        fixture.projection.getGovernanceVote(networkId, invalidVote.voteAddress),
      ).resolves.toBeUndefined();
      await expect(
        fixture.projection.getGovernanceProposal(networkId, proposalAddress),
      ).resolves.toMatchObject({
        yesVotes: 0n,
        noVotes: 0n,
        abstainVotes: 0n,
        stateSequence: 1n,
      });
      await expect(fixture.projection.checkpoint(networkId)).resolves.toBe(7n);
    }

    await expect(fixture.indexer.ingest(vote)).resolves.toMatchObject({ applied: true });
    const duplicateVote: VoteCastEvent = {
      ...vote,
      transactionSignature: signature(100),
      voterSequence: 2n,
      proposalStateSequence: 3n,
      noVotes: 1n,
    };
    await expect(fixture.indexer.ingest(duplicateVote)).rejects.toMatchObject({
      code: 'stale-event',
    } satisfies Partial<ProjectionError>);
    await expect(
      fixture.projection.getGovernanceVotesByProposal(networkId, proposalAddress),
    ).resolves.toHaveLength(1);
  });

  it('rejects early, stale, substituted, arithmetically invalid, and duplicate finalization', async () => {
    const fixture = await fixtureThrough(8);
    const finalized = fixture.events[8] as ProposalFinalizedEvent;
    const invalidFinalizations: readonly ProposalFinalizedEvent[] = [
      {
        ...finalized,
        transactionSignature: signature(110),
        slot: 11n,
        blockTime: blockTime(11n),
      },
      {
        ...finalized,
        transactionSignature: signature(111),
        proposalStateSequence: 4n,
      },
      {
        ...finalized,
        transactionSignature: signature(112),
        communityAddress: publicKey(102),
      },
      {
        ...finalized,
        transactionSignature: signature(113),
        eligibleMemberCount: 1n,
      },
      {
        ...finalized,
        transactionSignature: signature(114),
        yesVotes: 0n,
      },
      {
        ...finalized,
        transactionSignature: signature(115),
        quorumMet: false,
      },
      {
        ...finalized,
        transactionSignature: signature(116),
        outcome: 'rejected',
      },
    ];
    for (const invalidFinalization of invalidFinalizations) {
      await expect(fixture.indexer.ingest(invalidFinalization)).rejects.toBeInstanceOf(Error);
      await expect(
        fixture.projection.getGovernanceProposal(networkId, proposalAddress),
      ).resolves.toMatchObject({
        stateSequence: 2n,
        outcome: 'pending',
      });
      await expect(fixture.projection.checkpoint(networkId)).resolves.toBe(8n);
    }

    await expect(fixture.indexer.ingest(finalized)).resolves.toMatchObject({ applied: true });
    await expect(
      fixture.indexer.ingest({
        ...finalized,
        transactionSignature: signature(117),
      }),
    ).rejects.toMatchObject({
      code: 'stale-event',
    } satisfies Partial<ProjectionError>);
  });
});

async function fixtureThrough(eventCount: number) {
  const projection = new MemoryProjectionStore();
  const indexer = new OpenIndexer(
    projection,
    new ManifestVerifier(communityManifestSource, {
      authorize: () => Promise.resolve(true),
    }),
  );
  const events = governanceEvents();
  for (const event of events.slice(0, eventCount)) {
    await indexer.ingest(event);
  }
  return { projection, indexer, events };
}

function governanceEvents(): readonly ProtocolEvent[] {
  return [
    {
      ...base(1n, 1),
      type: 'protocol-initialized',
      configAddress,
    },
    {
      ...base(2n, 2),
      type: 'identity-created',
      identityId: creatorIdentityId,
      identityAddress: creatorAddress,
      rootAuthority: creatorAuthority,
    },
    {
      ...base(3n, 3),
      type: 'identity-created',
      identityId: voterIdentityId,
      identityAddress: voterAddress,
      rootAuthority: voterAuthority,
    },
    {
      ...base(4n, 4),
      type: 'community-created',
      communityAddress,
      creatorIdentityId,
      authority: creatorAuthority,
      communityNonce: communityEnvelope.payload.nonce,
      creatorSequence: 1n,
      manifestCid: communityManifestCid,
      manifestHash: communityEnvelope.proof.payloadHash,
      governanceVersion: 1,
      governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
      visibility: 'public',
      membershipPolicy: 'open',
      membershipPolicySequence: 1n,
      membershipSequence: 0n,
    },
    {
      ...base(5n, 5),
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
      manifestCid: creatorMembershipCid,
      manifestHash: creatorMembershipEnvelope.proof.payloadHash,
      manifestUri: `ipfs://${creatorMembershipCid}`,
    },
    {
      ...base(6n, 6),
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
      manifestCid: voterMembershipCid,
      manifestHash: voterMembershipEnvelope.proof.payloadHash,
      manifestUri: `ipfs://${voterMembershipCid}`,
    },
    {
      ...base(7n, 7),
      type: 'proposal-created',
      communityAddress,
      proposalAddress,
      proposerIdentityId: creatorIdentityId,
      authority: creatorAuthority,
      proposerSequence: 3n,
      previousCommunitySequence: 1n,
      manifestHash: proposalManifestHash,
      manifestUri: 'local://proposal-one',
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
    },
    {
      ...base(8n, 8),
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
    },
    {
      ...base(12n, 9),
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
    },
  ];
}

function communityCreationEvent(): Extract<ProtocolEvent, { readonly type: 'community-created' }> {
  const event = governanceEvents().find(
    (candidate): candidate is Extract<ProtocolEvent, { readonly type: 'community-created' }> =>
      candidate.type === 'community-created',
  );
  if (event === undefined) throw new Error('Expected a community creation fixture.');
  return event;
}

function moveEventToNetwork(event: ProtocolEvent, targetNetworkId: NetworkId): ProtocolEvent {
  return Object.fromEntries(
    Object.entries(event).map(([key, value]) => [
      key,
      typeof value === 'string' ? value.replace(networkId, targetNetworkId) : value,
    ]),
  ) as unknown as ProtocolEvent;
}

function base(slot: bigint, seed: number) {
  return {
    networkId,
    programId,
    transactionSignature: signature(seed),
    transactionIndex: seed,
    slot,
    logIndex: 0,
    blockTime: blockTime(slot),
    finalized: true as const,
  };
}

function blockTime(slot: bigint): string {
  return new Date(Date.UTC(2026, 6, 28, 16, 0, Number(slot))).toISOString();
}

function context(slot: bigint, seed: number) {
  return {
    networkId,
    programId,
    transactionSignature: signature(seed),
    transactionIndex: seed,
    slot,
    logIndex: 0,
    blockTime: Date.parse(blockTime(slot)) / 1_000,
  };
}

function proposalAnchorEvent(
  overrides: {
    readonly eventVersion?: number;
    readonly votingModel?: number;
    readonly quorumBps?: number;
    readonly configAddress?: string;
    readonly proposalAddress?: string;
  } = {},
): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProposalCreated,
    u16(overrides.eventVersion ?? 1),
    pubkey(overrides.configAddress ?? configAddress),
    pubkey(communityAddress),
    pubkey(overrides.proposalAddress ?? proposalAddress),
    pubkey(creatorAddress),
    pubkey(creatorAuthority),
    u64(3n),
    u64(1n),
    bytes(32, 30),
    borshString('local://proposal-one'),
    u16(1),
    strategyBytes,
    Uint8Array.of(overrides.votingModel ?? 0),
    u64(2n),
    u64(2n),
    u64(8n),
    u64(12n),
    u16(overrides.quorumBps ?? GOVERNANCE_QUORUM_BPS),
    u16(GOVERNANCE_APPROVAL_BPS),
    u64(1n),
    u64(7n),
  );
}

function voteAnchorEvent(): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.VoteCast,
    u16(1),
    pubkey(configAddress),
    pubkey(communityAddress),
    pubkey(proposalAddress),
    pubkey(voteAddress),
    pubkey(voterAddress),
    pubkey(voterMembershipAddress),
    pubkey(voterAuthority),
    u64(2n),
    u64(1n),
    u64(2n),
    Uint8Array.of(0),
    u64(1n),
    u64(0n),
    u64(0n),
    u64(8n),
  );
}

function finalizedAnchorEvent(overrides: { readonly outcome?: number } = {}): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.ProposalFinalized,
    u16(1),
    pubkey(configAddress),
    pubkey(communityAddress),
    pubkey(proposalAddress),
    pubkey(creatorAuthority),
    u64(3n),
    u64(2n),
    u64(1n),
    u64(0n),
    u64(0n),
    u64(1n),
    u64(1n),
    u16(GOVERNANCE_QUORUM_BPS),
    u16(GOVERNANCE_APPROVAL_BPS),
    Uint8Array.of(1),
    Uint8Array.of(1),
    Uint8Array.of(overrides.outcome ?? 1),
    u64(12n),
  );
}

function eventData(discriminator: readonly number[], ...fields: readonly Uint8Array[]): string {
  return Buffer.concat([
    Buffer.from(discriminator),
    ...fields.map((field) => Buffer.from(field)),
  ]).toString('base64');
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}

function u64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}

function borshString(value: string): Uint8Array {
  const encoded = Buffer.from(value, 'utf8');
  const result = new Uint8Array(4 + encoded.byteLength);
  new DataView(result.buffer).setUint32(0, encoded.byteLength, true);
  result.set(encoded, 4);
  return result;
}

function pubkey(value: string): Uint8Array {
  return bs58.decode(value);
}

function signature(seed: number): string {
  return bs58.encode(bytes(64, seed));
}

function publicKey(seed: number): string {
  return bs58.encode(bytes(32, seed));
}

function digest(seed: number): string {
  return encodeMultibaseBase64Url(bytes(32, seed));
}

function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) % 256);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}
