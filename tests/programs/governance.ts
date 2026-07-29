import { strict as assert } from "node:assert";

import { BN, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import {
  assertAnchorError,
  assertRentExemptAccount,
  createDelegation,
  createIdentity,
  digest,
  manifestUri,
  measureAndSend,
  type Phase2Context,
  type TransactionMeasurement,
} from "./phase2_test_helpers";
import {
  GOVERNANCE_APPROVAL_BPS,
  GOVERNANCE_PROPOSAL_SPACE,
  GOVERNANCE_QUORUM_BPS,
  GOVERNANCE_STRATEGY_HASH,
  GOVERNANCE_VOTE_SPACE,
  SCOPE_COMMUNITY,
  SCOPE_PROFILE,
  SCOPE_SOCIAL,
  createGovernanceCommunity,
  deriveMembership,
  deriveProposal,
  deriveVote,
  parsedEvents,
  waitUntilSlot,
  type GovernanceCommunityFixture,
  type GovernanceMemberFixture,
} from "./governance_test_helpers";

const { Keypair, SystemProgram } = web3;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as UnknownRecord;
}

function onlyEvent(
  events: { data: unknown; name: string }[],
  expectedName: string,
): UnknownRecord {
  assert.equal(events.length, 1);
  assert.equal(events[0]?.name, expectedName);
  return record(events[0]?.data);
}

function memberAt(
  fixture: GovernanceCommunityFixture,
  index: number,
): GovernanceMemberFixture {
  const member = fixture.members[index];
  assert.ok(member, `missing governance member ${index}`);
  return member;
}

function publicKeyString(value: unknown): string {
  assert.ok(value instanceof web3.PublicKey);
  return value.toBase58();
}

async function currentSequences(
  context: Phase2Context,
  fixture: GovernanceCommunityFixture,
): Promise<{ community: number; creator: number; membership: number }> {
  const [creator, community] = await Promise.all([
    context.program.account.identity.fetch(fixture.creator.address),
    context.program.account.community.fetch(fixture.address),
  ]);
  return {
    creator: creator.sequence.toNumber(),
    community: community.creatorSequence.toNumber(),
    membership: community.membershipSequence.toNumber(),
  };
}

async function membershipSequence(
  context: Phase2Context,
  member: GovernanceMemberFixture,
): Promise<number> {
  return (
    await context.program.account.communityMembership.fetch(member.membership)
  ).stateSequence.toNumber();
}

export function registerGovernanceTests(context: Phase2Context): void {
  const { config, program, provider } = context;

  describe("one-active-member-one-vote community governance", () => {
    it("creates through a current community delegate, casts one vote per active snapshot member, survives strategy rotation, and finalizes once by anyone", async () => {
      const fixture = await createGovernanceCommunity(context, 23, 3);
      const creatorDelegate = Keypair.generate();
      const beforeDelegation = await currentSequences(context, fixture);
      const creatorDelegation = await createDelegation(
        context,
        fixture.creator,
        creatorDelegate,
        SCOPE_COMMUNITY,
        {
          delegationSequence: 1,
          expectedIdentitySequence: beforeDelegation.creator,
        },
      );
      const voterDelegate = Keypair.generate();
      const voterDelegation = await createDelegation(
        context,
        memberAt(fixture, 1),
        voterDelegate,
        SCOPE_SOCIAL,
        { expectedIdentitySequence: 1 },
      );
      const communityVoterDelegate = Keypair.generate();
      const communityVoterDelegation = await createDelegation(
        context,
        memberAt(fixture, 2),
        communityVoterDelegate,
        SCOPE_COMMUNITY,
        { expectedIdentitySequence: 1 },
      );

      const proposalHash = digest("governance-lifecycle-proposal");
      const proposal = deriveProposal(
        program.programId,
        fixture.address,
        proposalHash,
      );
      const slot = await provider.connection.getSlot("confirmed");
      const opensAtSlot = slot + 4;
      const closesAtSlot = opensAtSlot + 14;
      const afterDelegation = await currentSequences(context, fixture);
      const createSignature = await program.methods
        .createProposal({
          expectedCreatorSequence: new BN(afterDelegation.creator),
          expectedCommunitySequence: new BN(afterDelegation.community),
          expectedCommunityMembershipSequence: new BN(
            afterDelegation.membership,
          ),
          manifestHash: proposalHash,
          manifestUri: manifestUri("governance-lifecycle-proposal"),
          opensAtSlot: new BN(opensAtSlot),
          closesAtSlot: new BN(closesAtSlot),
          quorumBps: GOVERNANCE_QUORUM_BPS,
          approvalBps: GOVERNANCE_APPROVAL_BPS,
        })
        .accountsStrict({
          config,
          creatorIdentity: fixture.creator.address,
          community: fixture.address,
          proposal,
          authority: creatorDelegate.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: creatorDelegation.address,
        })
        .signers([creatorDelegate])
        .rpc();

      const createdEvent = onlyEvent(
        await parsedEvents(context, createSignature),
        "proposalCreated",
      );
      assert.deepEqual(Object.keys(createdEvent).sort(), [
        "approvalBps",
        "authority",
        "closesAtSlot",
        "community",
        "communityMembershipSequence",
        "config",
        "createdAtSlot",
        "eligibleMemberCount",
        "eventVersion",
        "governanceStrategyHash",
        "governanceVersion",
        "manifestHash",
        "manifestUri",
        "opensAtSlot",
        "previousCommunitySequence",
        "proposal",
        "proposalStateSequence",
        "proposerIdentity",
        "proposerSequence",
        "quorumBps",
        "votingModel",
      ]);
      assert.equal(publicKeyString(createdEvent.proposal), proposal.toBase58());
      assert.equal(
        publicKeyString(createdEvent.authority),
        creatorDelegate.publicKey.toBase58(),
      );
      assert.deepEqual(createdEvent.manifestHash, proposalHash);
      assert.equal((createdEvent.eligibleMemberCount as BN).toNumber(), 3);

      const proposalBeforeRotation =
        await program.account.governanceProposal.fetch(proposal);
      assert.equal(proposalBeforeRotation.version, 1);
      assert.equal(
        proposalBeforeRotation.proposerIdentity.toBase58(),
        fixture.creator.address.toBase58(),
      );
      assert.deepEqual(
        proposalBeforeRotation.governanceStrategyHash,
        GOVERNANCE_STRATEGY_HASH,
      );
      assert.deepEqual(proposalBeforeRotation.votingModel, {
        oneActiveMemberOneVote: {},
      });
      assert.deepEqual(proposalBeforeRotation.outcome, { pending: {} });
      assert.equal(proposalBeforeRotation.stateSequence.toNumber(), 1);

      const afterProposal = await currentSequences(context, fixture);
      await program.methods
        .updateCommunityGovernance({
          expectedCreatorSequence: new BN(afterProposal.creator),
          governanceVersion: 2,
          governanceStrategyHash: digest("future-governance-strategy"),
        })
        .accountsStrict({
          config,
          creatorIdentity: fixture.creator.address,
          community: fixture.address,
          rootAuthority: fixture.creator.authority.publicKey,
        })
        .signers([fixture.creator.authority])
        .rpc();

      await waitUntilSlot(provider, opensAtSlot);
      const firstMember = memberAt(fixture, 0);
      const firstVote = deriveVote(
        program.programId,
        proposal,
        firstMember.address,
      );
      const firstVoteSignature = await program.methods
        .castVote({
          expectedVoterSequence: new BN(1),
          expectedMembershipStateSequence: new BN(
            await membershipSequence(context, firstMember),
          ),
          expectedProposalStateSequence: new BN(1),
          choice: { yes: {} },
        })
        .accountsStrict({
          config,
          voterIdentity: firstMember.address,
          community: fixture.address,
          membership: firstMember.membership,
          proposal,
          vote: firstVote,
          authority: firstMember.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([firstMember.authority])
        .rpc();
      const voteEvent = onlyEvent(
        await parsedEvents(context, firstVoteSignature),
        "voteCast",
      );
      assert.deepEqual(Object.keys(voteEvent).sort(), [
        "abstainVotes",
        "authority",
        "castAtSlot",
        "choice",
        "community",
        "config",
        "eventVersion",
        "membership",
        "membershipStateSequence",
        "noVotes",
        "proposal",
        "proposalStateSequence",
        "vote",
        "voterIdentity",
        "voterSequence",
        "yesVotes",
      ]);
      assert.equal(publicKeyString(voteEvent.vote), firstVote.toBase58());
      assert.deepEqual(voteEvent.choice, { yes: {} });

      const secondMember = memberAt(fixture, 1);
      await program.methods
        .castVote({
          expectedVoterSequence: new BN(2),
          expectedMembershipStateSequence: new BN(
            await membershipSequence(context, secondMember),
          ),
          expectedProposalStateSequence: new BN(2),
          choice: { yes: {} },
        })
        .accountsStrict({
          config,
          voterIdentity: secondMember.address,
          community: fixture.address,
          membership: secondMember.membership,
          proposal,
          vote: deriveVote(program.programId, proposal, secondMember.address),
          authority: voterDelegate.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: voterDelegation.address,
        })
        .signers([voterDelegate])
        .rpc();

      const thirdMember = memberAt(fixture, 2);
      await program.methods
        .castVote({
          expectedVoterSequence: new BN(2),
          expectedMembershipStateSequence: new BN(
            await membershipSequence(context, thirdMember),
          ),
          expectedProposalStateSequence: new BN(3),
          choice: { abstain: {} },
        })
        .accountsStrict({
          config,
          voterIdentity: thirdMember.address,
          community: fixture.address,
          membership: thirdMember.membership,
          proposal,
          vote: deriveVote(program.programId, proposal, thirdMember.address),
          authority: communityVoterDelegate.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: communityVoterDelegation.address,
        })
        .signers([communityVoterDelegate])
        .rpc();

      const arbitraryFinalizer = Keypair.generate();
      await assertAnchorError(
        program.methods
          .finalizeProposal({ expectedProposalStateSequence: new BN(4) })
          .accountsStrict({
            config,
            community: fixture.address,
            proposal,
            finalizer: arbitraryFinalizer.publicKey,
          })
          .signers([arbitraryFinalizer])
          .rpc(),
        "ProposalFinalizationTooEarly",
      );

      await waitUntilSlot(provider, closesAtSlot);
      const finalizeSignature = await program.methods
        .finalizeProposal({ expectedProposalStateSequence: new BN(4) })
        .accountsStrict({
          config,
          community: fixture.address,
          proposal,
          finalizer: arbitraryFinalizer.publicKey,
        })
        .signers([arbitraryFinalizer])
        .rpc();
      const finalizedEvent = onlyEvent(
        await parsedEvents(context, finalizeSignature),
        "proposalFinalized",
      );
      assert.deepEqual(Object.keys(finalizedEvent).sort(), [
        "abstainVotes",
        "approvalBps",
        "approvalMet",
        "community",
        "config",
        "decisiveVotes",
        "eligibleMemberCount",
        "eventVersion",
        "finalizedAtSlot",
        "finalizer",
        "noVotes",
        "outcome",
        "participatingVotes",
        "proposal",
        "proposalStateSequence",
        "quorumBps",
        "quorumMet",
        "yesVotes",
      ]);
      assert.equal(finalizedEvent.quorumMet, true);
      assert.equal(finalizedEvent.approvalMet, true);
      assert.deepEqual(finalizedEvent.outcome, { accepted: {} });
      assert.equal((finalizedEvent.participatingVotes as BN).toNumber(), 3);
      assert.equal((finalizedEvent.decisiveVotes as BN).toNumber(), 2);

      const finalized =
        await program.account.governanceProposal.fetch(proposal);
      assert.deepEqual(finalized.outcome, { accepted: {} });
      assert.notEqual(finalized.finalizedAtSlot, null);
      assert.equal(finalized.stateSequence.toNumber(), 5);
      assert.deepEqual(
        finalized.governanceStrategyHash,
        GOVERNANCE_STRATEGY_HASH,
      );
      await assertAnchorError(
        program.methods
          .finalizeProposal({ expectedProposalStateSequence: new BN(5) })
          .accountsStrict({
            config,
            community: fixture.address,
            proposal,
            finalizer: arbitraryFinalizer.publicKey,
          })
          .signers([arbitraryFinalizer])
          .rpc(),
        "ProposalAlreadyFinalized",
      );
      assert.notEqual(
        await provider.connection.getAccountInfo(proposal, "confirmed"),
        null,
      );
      assert.notEqual(
        await provider.connection.getAccountInfo(firstVote, "confirmed"),
        null,
      );
    });

    it("rejects unsupported strategies, custom thresholds, zero-member snapshots, unsafe windows, stale sequences, unauthorized proposers, and duplicate digests", async () => {
      const fixture = await createGovernanceCommunity(context, 83, 1);
      const sequences = await currentSequences(context, fixture);
      const baseSlot = await provider.connection.getSlot("confirmed");
      const manifestHash = digest("governance-creation-adversarial");
      const proposal = deriveProposal(
        program.programId,
        fixture.address,
        manifestHash,
      );
      const create = (
        overrides: Partial<{
          approvalBps: number;
          closesAtSlot: number;
          expectedCommunitySequence: number;
          expectedCommunityMembershipSequence: number;
          expectedCreatorSequence: number;
          manifestHash: number[];
          manifestUri: string;
          opensAtSlot: number;
          quorumBps: number;
        }> = {},
        authority: web3.Keypair = fixture.creator.authority,
      ): Promise<string> => {
        const candidateHash = overrides.manifestHash ?? manifestHash;
        return program.methods
          .createProposal({
            expectedCreatorSequence: new BN(
              overrides.expectedCreatorSequence ?? sequences.creator,
            ),
            expectedCommunitySequence: new BN(
              overrides.expectedCommunitySequence ?? sequences.community,
            ),
            expectedCommunityMembershipSequence: new BN(
              overrides.expectedCommunityMembershipSequence ??
                sequences.membership,
            ),
            manifestHash: candidateHash,
            manifestUri:
              overrides.manifestUri ??
              manifestUri("governance-creation-adversarial"),
            opensAtSlot: new BN(overrides.opensAtSlot ?? baseSlot + 30),
            closesAtSlot: new BN(overrides.closesAtSlot ?? baseSlot + 40),
            quorumBps: overrides.quorumBps ?? GOVERNANCE_QUORUM_BPS,
            approvalBps: overrides.approvalBps ?? GOVERNANCE_APPROVAL_BPS,
          })
          .accountsStrict({
            config,
            creatorIdentity: fixture.creator.address,
            community: fixture.address,
            proposal: deriveProposal(
              program.programId,
              fixture.address,
              candidateHash,
            ),
            authority: authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([authority])
          .rpc();
      };

      await assertAnchorError(
        create({}, Keypair.generate()),
        "Unauthorized",
      );
      await assertAnchorError(
        create({ quorumBps: GOVERNANCE_QUORUM_BPS - 1 }),
        "GovernanceThresholdMismatch",
      );
      await assertAnchorError(
        create({
          manifestHash: Array.from({ length: 32 }, () => 0),
          manifestUri: manifestUri("zero"),
        }),
        "InvalidManifestHash",
      );
      await assertAnchorError(
        create({ opensAtSlot: 0, closesAtSlot: 10 }),
        "InvalidProposalWindow",
      );
      await assertAnchorError(
        create({
          opensAtSlot: baseSlot + 10,
          closesAtSlot: baseSlot + 11,
        }),
        "InvalidProposalWindow",
      );
      await assertAnchorError(
        create({
          opensAtSlot: baseSlot + 200_000,
          closesAtSlot: baseSlot + 200_010,
        }),
        "ProposalStartTooFar",
      );
      await assertAnchorError(
        create({ expectedCommunitySequence: sequences.community - 1 }),
        "CommunitySequenceMismatch",
      );
      await assertAnchorError(
        create({
          expectedCommunityMembershipSequence: sequences.membership - 1,
        }),
        "CommunityMembershipSequenceMismatch",
      );
      await assertAnchorError(
        create({ expectedCreatorSequence: sequences.creator + 1 }),
        "SequenceMismatch",
      );

      await create();
      await assertAnchorError(create(), "ProposalAlreadyExists");
      assert.equal(
        (await program.account.governanceProposal.fetch(proposal))
          .eligibleMemberCount.toNumber(),
        1,
      );

      const emptyFixture = await createGovernanceCommunity(context, 103, 0);
      const emptySequences = await currentSequences(context, emptyFixture);
      const emptyHash = digest("empty-community-proposal");
      const emptySlot = await provider.connection.getSlot("confirmed");
      await assertAnchorError(
        program.methods
          .createProposal({
            expectedCreatorSequence: new BN(emptySequences.creator),
            expectedCommunitySequence: new BN(emptySequences.community),
            expectedCommunityMembershipSequence: new BN(
              emptySequences.membership,
            ),
            manifestHash: emptyHash,
            manifestUri: manifestUri("empty-community-proposal"),
            opensAtSlot: new BN(emptySlot + 5),
            closesAtSlot: new BN(emptySlot + 10),
            quorumBps: GOVERNANCE_QUORUM_BPS,
            approvalBps: GOVERNANCE_APPROVAL_BPS,
          })
          .accountsStrict({
            config,
            creatorIdentity: emptyFixture.creator.address,
            community: emptyFixture.address,
            proposal: deriveProposal(
              program.programId,
              emptyFixture.address,
              emptyHash,
            ),
            authority: emptyFixture.creator.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([emptyFixture.creator.authority])
          .rpc(),
        "NoEligibleCommunityMembers",
      );

      const unsupported = await createGovernanceCommunity(
        context,
        123,
        1,
        digest("unsupported-governance-strategy"),
      );
      const unsupportedSequences = await currentSequences(context, unsupported);
      const unsupportedHash = digest("unsupported-strategy-proposal");
      const unsupportedSlot = await provider.connection.getSlot("confirmed");
      await assertAnchorError(
        program.methods
          .createProposal({
            expectedCreatorSequence: new BN(unsupportedSequences.creator),
            expectedCommunitySequence: new BN(
              unsupportedSequences.community,
            ),
            expectedCommunityMembershipSequence: new BN(
              unsupportedSequences.membership,
            ),
            manifestHash: unsupportedHash,
            manifestUri: manifestUri("unsupported-strategy-proposal"),
            opensAtSlot: new BN(unsupportedSlot + 5),
            closesAtSlot: new BN(unsupportedSlot + 10),
            quorumBps: GOVERNANCE_QUORUM_BPS,
            approvalBps: GOVERNANCE_APPROVAL_BPS,
          })
          .accountsStrict({
            config,
            creatorIdentity: unsupported.creator.address,
            community: unsupported.address,
            proposal: deriveProposal(
              program.programId,
              unsupported.address,
              unsupportedHash,
            ),
            authority: unsupported.creator.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([unsupported.creator.authority])
          .rpc(),
        "UnsupportedGovernanceStrategy",
      );
    });

    it("rejects early, duplicate, substituted, stale, inactive, late-snapshot, unauthorized, and closed votes", async () => {
      const fixture = await createGovernanceCommunity(context, 143, 2);
      const sequences = await currentSequences(context, fixture);
      const proposalHash = digest("governance-vote-adversarial");
      const proposal = deriveProposal(
        program.programId,
        fixture.address,
        proposalHash,
      );
      const slot = await provider.connection.getSlot("confirmed");
      const opensAtSlot = slot + 7;
      const closesAtSlot = opensAtSlot + 30;
      await program.methods
        .createProposal({
          expectedCreatorSequence: new BN(sequences.creator),
          expectedCommunitySequence: new BN(sequences.community),
          expectedCommunityMembershipSequence: new BN(sequences.membership),
          manifestHash: proposalHash,
          manifestUri: manifestUri("governance-vote-adversarial"),
          opensAtSlot: new BN(opensAtSlot),
          closesAtSlot: new BN(closesAtSlot),
          quorumBps: GOVERNANCE_QUORUM_BPS,
          approvalBps: GOVERNANCE_APPROVAL_BPS,
        })
        .accountsStrict({
          config,
          creatorIdentity: fixture.creator.address,
          community: fixture.address,
          proposal,
          authority: fixture.creator.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([fixture.creator.authority])
        .rpc();

      const firstMember = memberAt(fixture, 0);
      const firstVote = deriveVote(
        program.programId,
        proposal,
        firstMember.address,
      );
      const castFirst = (
        overrides: Partial<{
          authority: web3.Keypair;
          expectedMembershipStateSequence: number;
          expectedProposalStateSequence: number;
          expectedVoterSequence: number;
          membership: web3.PublicKey;
          vote: web3.PublicKey;
        }> = {},
      ): Promise<string> => {
        const authority = overrides.authority ?? firstMember.authority;
        return program.methods
          .castVote({
            expectedVoterSequence: new BN(
              overrides.expectedVoterSequence ?? 1,
            ),
            expectedMembershipStateSequence: new BN(
              overrides.expectedMembershipStateSequence ?? 1,
            ),
            expectedProposalStateSequence: new BN(
              overrides.expectedProposalStateSequence ?? 1,
            ),
            choice: { no: {} },
          })
          .accountsStrict({
            config,
            voterIdentity: firstMember.address,
            community: fixture.address,
            membership: overrides.membership ?? firstMember.membership,
            proposal,
            vote: overrides.vote ?? firstVote,
            authority: authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([authority])
          .rpc();
      };

      await assertAnchorError(castFirst(), "ProposalNotOpen");
      await waitUntilSlot(provider, opensAtSlot);
      await assertAnchorError(
        castFirst({ authority: Keypair.generate() }),
        "Unauthorized",
      );
      await assertAnchorError(
        castFirst({ expectedMembershipStateSequence: 0 }),
        "MembershipSequenceMismatch",
      );
      await assertAnchorError(
        castFirst({ expectedProposalStateSequence: 0 }),
        "ProposalSequenceMismatch",
      );
      await assertAnchorError(
        castFirst({ expectedVoterSequence: 2 }),
        "SequenceMismatch",
      );
      await castFirst();
      await assertAnchorError(
        castFirst({ expectedProposalStateSequence: 2 }),
        "VoteAlreadyCast",
      );

      const secondMember = memberAt(fixture, 1);
      await assert.rejects(
        program.methods
          .castVote({
            expectedVoterSequence: new BN(1),
            expectedMembershipStateSequence: new BN(1),
            expectedProposalStateSequence: new BN(2),
            choice: { yes: {} },
          })
          .accountsStrict({
            config,
            voterIdentity: secondMember.address,
            community: fixture.address,
            membership: firstMember.membership,
            proposal,
            vote: deriveVote(program.programId, proposal, secondMember.address),
            authority: secondMember.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([secondMember.authority])
          .rpc(),
      );
      await assert.rejects(
        program.methods
          .castVote({
            expectedVoterSequence: new BN(1),
            expectedMembershipStateSequence: new BN(1),
            expectedProposalStateSequence: new BN(2),
            choice: { yes: {} },
          })
          .accountsStrict({
            config,
            voterIdentity: secondMember.address,
            community: fixture.address,
            membership: secondMember.membership,
            proposal,
            vote: firstVote,
            authority: secondMember.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([secondMember.authority])
          .rpc(),
      );

      const creatorAfterProposal = await currentSequences(context, fixture);
      await program.methods
        .leaveCommunity({
          expectedMemberSequence: new BN(1),
          expectedStateSequence: new BN(1),
          expectedMembershipPolicySequence: new BN(1),
          expectedCommunityMembershipSequence: new BN(
            creatorAfterProposal.membership,
          ),
          manifestHash: digest("governance-second-member-leave"),
          manifestUri: manifestUri("governance-second-member-leave"),
        })
        .accountsStrict({
          config,
          community: fixture.address,
          memberIdentity: secondMember.address,
          membership: secondMember.membership,
          authority: secondMember.authority.publicKey,
          delegation: null,
        })
        .signers([secondMember.authority])
        .rpc();
      await assertAnchorError(
        program.methods
          .castVote({
            expectedVoterSequence: new BN(2),
            expectedMembershipStateSequence: new BN(2),
            expectedProposalStateSequence: new BN(2),
            choice: { yes: {} },
          })
          .accountsStrict({
            config,
            voterIdentity: secondMember.address,
            community: fixture.address,
            membership: secondMember.membership,
            proposal,
            vote: deriveVote(program.programId, proposal, secondMember.address),
            authority: secondMember.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([secondMember.authority])
          .rpc(),
        "InactiveCommunityMember",
      );

      const proposalState =
        await program.account.governanceProposal.fetch(proposal);
      await waitUntilSlot(
        provider,
        proposalState.createdAtSlot.toNumber() + 1,
      );
      const lateIdentity = await createIdentity(context, 163);
      const lateMembership = deriveMembership(
        program.programId,
        fixture.address,
        lateIdentity.address,
      );
      const creatorBeforeLateMember = await currentSequences(context, fixture);
      await program.methods
        .joinCommunity({
          expectedMemberSequence: new BN(0),
          expectedStateSequence: new BN(0),
          expectedMembershipPolicySequence: new BN(1),
          expectedCommunityMembershipSequence: new BN(
            creatorBeforeLateMember.membership,
          ),
          manifestHash: digest("governance-late-member-join"),
          manifestUri: manifestUri("governance-late-member-join"),
        })
        .accountsStrict({
          config,
          community: fixture.address,
          memberIdentity: lateIdentity.address,
          membership: lateMembership,
          authority: lateIdentity.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([lateIdentity.authority])
        .rpc();
      const lateMembershipState =
        await program.account.communityMembership.fetch(lateMembership);
      assert.ok(
        lateMembershipState.activeSinceMembershipSequence.gt(
          proposalState.communityMembershipSequence,
        ),
      );
      await assertAnchorError(
        program.methods
          .castVote({
            expectedVoterSequence: new BN(1),
            expectedMembershipStateSequence: new BN(1),
            expectedProposalStateSequence: new BN(2),
            choice: { yes: {} },
          })
          .accountsStrict({
            config,
            voterIdentity: lateIdentity.address,
            community: fixture.address,
            membership: lateMembership,
            proposal,
            vote: deriveVote(program.programId, proposal, lateIdentity.address),
            authority: lateIdentity.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([lateIdentity.authority])
          .rpc(),
        "MemberNotEligibleAtSnapshot",
      );

      await waitUntilSlot(provider, closesAtSlot);
      await assertAnchorError(
        program.methods
          .castVote({
            expectedVoterSequence: new BN(2),
            expectedMembershipStateSequence: new BN(2),
            expectedProposalStateSequence: new BN(2),
            choice: { yes: {} },
          })
          .accountsStrict({
            config,
            voterIdentity: secondMember.address,
            community: fixture.address,
            membership: secondMember.membership,
            proposal,
            vote: deriveVote(program.programId, proposal, secondMember.address),
            authority: secondMember.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([secondMember.authority])
          .rpc(),
        "ProposalVotingClosed",
      );
    });

    it("counts abstention toward quorum only and rejects both abstention-only and zero-participation proposals without division", async () => {
      const fixture = await createGovernanceCommunity(context, 183, 2);
      const sequences = await currentSequences(context, fixture);
      const slot = await provider.connection.getSlot("confirmed");
      const opensAtSlot = slot + 4;
      const closesAtSlot = opensAtSlot + 8;
      const abstainHash = digest("governance-abstain-only");
      const emptyHash = digest("governance-zero-participation");
      const abstainProposal = deriveProposal(
        program.programId,
        fixture.address,
        abstainHash,
      );
      const emptyProposal = deriveProposal(
        program.programId,
        fixture.address,
        emptyHash,
      );

      await program.methods
        .createProposal({
          expectedCreatorSequence: new BN(sequences.creator),
          expectedCommunitySequence: new BN(sequences.community),
          expectedCommunityMembershipSequence: new BN(sequences.membership),
          manifestHash: abstainHash,
          manifestUri: manifestUri("governance-abstain-only"),
          opensAtSlot: new BN(opensAtSlot),
          closesAtSlot: new BN(closesAtSlot),
          quorumBps: GOVERNANCE_QUORUM_BPS,
          approvalBps: GOVERNANCE_APPROVAL_BPS,
        })
        .accountsStrict({
          config,
          creatorIdentity: fixture.creator.address,
          community: fixture.address,
          proposal: abstainProposal,
          authority: fixture.creator.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([fixture.creator.authority])
        .rpc();
      const afterFirst = await currentSequences(context, fixture);
      await program.methods
        .createProposal({
          expectedCreatorSequence: new BN(afterFirst.creator),
          expectedCommunitySequence: new BN(afterFirst.community),
          expectedCommunityMembershipSequence: new BN(afterFirst.membership),
          manifestHash: emptyHash,
          manifestUri: manifestUri("governance-zero-participation"),
          opensAtSlot: new BN(opensAtSlot),
          closesAtSlot: new BN(closesAtSlot),
          quorumBps: GOVERNANCE_QUORUM_BPS,
          approvalBps: GOVERNANCE_APPROVAL_BPS,
        })
        .accountsStrict({
          config,
          creatorIdentity: fixture.creator.address,
          community: fixture.address,
          proposal: emptyProposal,
          authority: fixture.creator.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([fixture.creator.authority])
        .rpc();

      await waitUntilSlot(provider, opensAtSlot);
      const member = memberAt(fixture, 0);
      await program.methods
        .castVote({
          expectedVoterSequence: new BN(1),
          expectedMembershipStateSequence: new BN(1),
          expectedProposalStateSequence: new BN(1),
          choice: { abstain: {} },
        })
        .accountsStrict({
          config,
          voterIdentity: member.address,
          community: fixture.address,
          membership: member.membership,
          proposal: abstainProposal,
          vote: deriveVote(
            program.programId,
            abstainProposal,
            member.address,
          ),
          authority: member.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([member.authority])
        .rpc();

      await waitUntilSlot(provider, closesAtSlot);
      const finalizer = Keypair.generate();
      await program.methods
        .finalizeProposal({ expectedProposalStateSequence: new BN(2) })
        .accountsStrict({
          config,
          community: fixture.address,
          proposal: abstainProposal,
          finalizer: finalizer.publicKey,
        })
        .signers([finalizer])
        .rpc();
      await program.methods
        .finalizeProposal({ expectedProposalStateSequence: new BN(1) })
        .accountsStrict({
          config,
          community: fixture.address,
          proposal: emptyProposal,
          finalizer: finalizer.publicKey,
        })
        .signers([finalizer])
        .rpc();

      const [abstentionOnly, noParticipation] = await Promise.all([
        program.account.governanceProposal.fetch(abstainProposal),
        program.account.governanceProposal.fetch(emptyProposal),
      ]);
      assert.equal(abstentionOnly.abstainVotes.toNumber(), 1);
      assert.equal(abstentionOnly.yesVotes.toNumber(), 0);
      assert.equal(abstentionOnly.noVotes.toNumber(), 0);
      assert.deepEqual(abstentionOnly.outcome, { rejected: {} });
      assert.deepEqual(noParticipation.outcome, { rejected: {} });
    });

    it("keeps proposal creation, voting, and finalization within rent, packet, transaction, and compute budgets", async () => {
      const fixture = await createGovernanceCommunity(context, 203, 1);
      const sequences = await currentSequences(context, fixture);
      const manifestHash = digest("governance-budget-proposal");
      const proposal = deriveProposal(
        program.programId,
        fixture.address,
        manifestHash,
      );
      const member = memberAt(fixture, 0);
      const vote = deriveVote(program.programId, proposal, member.address);
      const slot = await provider.connection.getSlot("confirmed");
      const opensAtSlot = slot + 4;
      const closesAtSlot = opensAtSlot + 8;
      const measurements: TransactionMeasurement[] = [];

      measurements.push(
        await measureAndSend(
          context,
          "create governance proposal",
          () =>
            program.methods
              .createProposal({
                expectedCreatorSequence: new BN(sequences.creator),
                expectedCommunitySequence: new BN(sequences.community),
                expectedCommunityMembershipSequence: new BN(
                  sequences.membership,
                ),
                manifestHash,
                manifestUri: manifestUri("governance-budget-proposal"),
                opensAtSlot: new BN(opensAtSlot),
                closesAtSlot: new BN(closesAtSlot),
                quorumBps: GOVERNANCE_QUORUM_BPS,
                approvalBps: GOVERNANCE_APPROVAL_BPS,
              })
              .accountsStrict({
                config,
                creatorIdentity: fixture.creator.address,
                community: fixture.address,
                proposal,
                authority: fixture.creator.authority.publicKey,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
                delegation: null,
              })
              .transaction(),
          [fixture.creator.authority],
        ),
      );
      const proposalRent = await assertRentExemptAccount(
        context,
        proposal,
        "governance proposal",
        GOVERNANCE_PROPOSAL_SPACE,
      );

      await waitUntilSlot(provider, opensAtSlot);
      measurements.push(
        await measureAndSend(
          context,
          "cast governance vote",
          () =>
            program.methods
              .castVote({
                expectedVoterSequence: new BN(1),
                expectedMembershipStateSequence: new BN(1),
                expectedProposalStateSequence: new BN(1),
                choice: { yes: {} },
              })
              .accountsStrict({
                config,
                voterIdentity: member.address,
                community: fixture.address,
                membership: member.membership,
                proposal,
                vote,
                authority: member.authority.publicKey,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
                delegation: null,
              })
              .transaction(),
          [member.authority],
        ),
      );
      const voteRent = await assertRentExemptAccount(
        context,
        vote,
        "governance vote",
        GOVERNANCE_VOTE_SPACE,
      );

      await waitUntilSlot(provider, closesAtSlot);
      const finalizer = Keypair.generate();
      measurements.push(
        await measureAndSend(
          context,
          "finalize governance proposal",
          () =>
            program.methods
              .finalizeProposal({
                expectedProposalStateSequence: new BN(2),
              })
              .accountsStrict({
                config,
                community: fixture.address,
                proposal,
                finalizer: finalizer.publicKey,
              })
              .transaction(),
          [finalizer],
        ),
      );

      assert.deepEqual(
        measurements.map(({ label }) => label),
        [
          "create governance proposal",
          "cast governance vote",
          "finalize governance proposal",
        ],
      );
      process.stdout.write(
        `\ngovernance-transaction-cost-evidence ${JSON.stringify({
          measurements,
          rentEvidence: [proposalRent, voteRent],
        })}\n`,
      );
    });

    it("rejects a delegation with neither social nor community scope for voting", async () => {
      const fixture = await createGovernanceCommunity(context, 223, 1);
      const member = memberAt(fixture, 0);
      const profileDelegate = Keypair.generate();
      const delegation = await createDelegation(
        context,
        member,
        profileDelegate,
        SCOPE_PROFILE,
        { expectedIdentitySequence: 1 },
      );
      const sequences = await currentSequences(context, fixture);
      const manifestHash = digest("governance-missing-scope");
      const proposal = deriveProposal(
        program.programId,
        fixture.address,
        manifestHash,
      );
      const slot = await provider.connection.getSlot("confirmed");
      const opensAtSlot = slot + 4;
      const closesAtSlot = opensAtSlot + 8;
      await program.methods
        .createProposal({
          expectedCreatorSequence: new BN(sequences.creator),
          expectedCommunitySequence: new BN(sequences.community),
          expectedCommunityMembershipSequence: new BN(sequences.membership),
          manifestHash,
          manifestUri: manifestUri("governance-missing-scope"),
          opensAtSlot: new BN(opensAtSlot),
          closesAtSlot: new BN(closesAtSlot),
          quorumBps: GOVERNANCE_QUORUM_BPS,
          approvalBps: GOVERNANCE_APPROVAL_BPS,
        })
        .accountsStrict({
          config,
          creatorIdentity: fixture.creator.address,
          community: fixture.address,
          proposal,
          authority: fixture.creator.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([fixture.creator.authority])
        .rpc();
      await waitUntilSlot(provider, opensAtSlot);
      await assertAnchorError(
        program.methods
          .castVote({
            expectedVoterSequence: new BN(2),
            expectedMembershipStateSequence: new BN(1),
            expectedProposalStateSequence: new BN(1),
            choice: { yes: {} },
          })
          .accountsStrict({
            config,
            voterIdentity: member.address,
            community: fixture.address,
            membership: member.membership,
            proposal,
            vote: deriveVote(program.programId, proposal, member.address),
            authority: profileDelegate.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: delegation.address,
          })
          .signers([profileDelegate])
          .rpc(),
        "DelegationScopeMissing",
      );
    });
  });
}
