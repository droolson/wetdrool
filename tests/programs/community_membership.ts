import { strict as assert } from "node:assert";

import { BN, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import {
  GOVERNANCE_STRATEGY_HASH,
  deriveCommunity,
  deriveMembership,
  parsedEvents,
} from "./governance_test_helpers";
import {
  assertAnchorError,
  createIdentity,
  digest,
  manifestUri,
  nonce,
  type IdentityFixture,
  type Phase2Context,
} from "./phase2_test_helpers";

const { SystemProgram } = web3;

type CommunityPolicy = "closed" | "open";
type CommunityVisibility = "private" | "public" | "unlisted";

interface CommunityFixture {
  address: web3.PublicKey;
  creator: IdentityFixture;
}

function policyArgument(policy: CommunityPolicy):
  | { closed: Record<string, never> }
  | { open: Record<string, never> } {
  return policy === "open" ? { open: {} } : { closed: {} };
}

function visibilityArgument(visibility: CommunityVisibility):
  | { private: Record<string, never> }
  | { public: Record<string, never> }
  | { unlisted: Record<string, never> } {
  switch (visibility) {
    case "private":
      return { private: {} };
    case "public":
      return { public: {} };
    case "unlisted":
      return { unlisted: {} };
  }
}

async function createCommunity(
  context: Phase2Context,
  nonceStart: number,
  visibility: CommunityVisibility,
  membershipPolicy: CommunityPolicy,
): Promise<CommunityFixture> {
  const creator = await createIdentity(context, nonceStart);
  const communityNonce = nonce(nonceStart + 1);
  const address = deriveCommunity(
    context.program.programId,
    creator.address,
    communityNonce,
  );
  await context.program.methods
    .createCommunity({
      expectedCreatorSequence: new BN(0),
      communityNonce,
      manifestHash: digest(`membership-community-${nonceStart}`),
      manifestUri: manifestUri(`membership-community-${nonceStart}`),
      governanceVersion: 1,
      governanceStrategyHash: GOVERNANCE_STRATEGY_HASH,
      visibility: visibilityArgument(visibility),
      membershipPolicy: policyArgument(membershipPolicy),
    })
    .accountsStrict({
      config: context.config,
      creatorIdentity: creator.address,
      community: address,
      rootAuthority: creator.authority.publicKey,
      payer: context.provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([creator.authority])
    .rpc();
  return { address, creator };
}

export function registerCommunityMembershipTests(
  context: Phase2Context,
): void {
  const { config, program, provider } = context;

  describe("member-authorized community enrollment", () => {
    it("allows an unlisted open community, rejects arbitrary assignment and stale policy state, and makes bans terminal", async () => {
      const community = await createCommunity(
        context,
        243,
        "unlisted",
        "open",
      );
      const member = await createIdentity(context, 245);
      const membership = deriveMembership(
        program.programId,
        community.address,
        member.address,
      );
      const joinArgs = {
        expectedMemberSequence: new BN(0),
        expectedStateSequence: new BN(0),
        expectedMembershipPolicySequence: new BN(1),
        expectedCommunityMembershipSequence: new BN(0),
        manifestHash: digest("unlisted-community-member-join"),
        manifestUri: manifestUri("unlisted-community-member-join"),
      };

      await assertAnchorError(
        program.methods
          .joinCommunity(joinArgs)
          .accountsStrict({
            config,
            community: community.address,
            memberIdentity: member.address,
            membership,
            authority: community.creator.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([community.creator.authority])
          .rpc(),
        "Unauthorized",
      );
      await assertAnchorError(
        program.methods
          .joinCommunity({
            ...joinArgs,
            expectedMembershipPolicySequence: new BN(0),
          })
          .accountsStrict({
            config,
            community: community.address,
            memberIdentity: member.address,
            membership,
            authority: member.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([member.authority])
          .rpc(),
        "MembershipPolicySequenceMismatch",
      );

      const joinSignature = await program.methods
        .joinCommunity(joinArgs)
        .accountsStrict({
          config,
          community: community.address,
          memberIdentity: member.address,
          membership,
          authority: member.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([member.authority])
        .rpc();
      const joinEvent = (await parsedEvents(context, joinSignature))[0];
      assert.equal(joinEvent?.name, "communityMembershipChanged");
      assert.deepEqual(
        (joinEvent?.data as { action: unknown }).action,
        { join: {} },
      );

      await program.methods
        .moderateCommunityMembership({
          expectedCreatorSequence: new BN(1),
          expectedStateSequence: new BN(1),
          expectedMembershipPolicySequence: new BN(1),
          expectedCommunityMembershipSequence: new BN(1),
          action: { ban: {} },
          manifestHash: digest("unlisted-community-member-ban"),
          manifestUri: manifestUri("unlisted-community-member-ban"),
        })
        .accountsStrict({
          config,
          creatorIdentity: community.creator.address,
          community: community.address,
          memberIdentity: member.address,
          membership,
          authority: community.creator.authority.publicKey,
          delegation: null,
        })
        .signers([community.creator.authority])
        .rpc();

      await assertAnchorError(
        program.methods
          .joinCommunity({
            expectedMemberSequence: new BN(1),
            expectedStateSequence: new BN(2),
            expectedMembershipPolicySequence: new BN(1),
            expectedCommunityMembershipSequence: new BN(2),
            manifestHash: digest("banned-community-member-rejoin"),
            manifestUri: manifestUri("banned-community-member-rejoin"),
          })
          .accountsStrict({
            config,
            community: community.address,
            memberIdentity: member.address,
            membership,
            authority: member.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([member.authority])
          .rpc(),
        "MembershipBanned",
      );

      const [communityState, membershipState] = await Promise.all([
        program.account.community.fetch(community.address),
        program.account.communityMembership.fetch(membership),
      ]);
      assert.deepEqual(communityState.visibility, { unlisted: {} });
      assert.equal(communityState.memberCount.toNumber(), 0);
      assert.equal(communityState.membershipSequence.toNumber(), 2);
      assert.deepEqual(membershipState.state, { banned: {} });
      assert.deepEqual(membershipState.action, { ban: {} });
      assert.equal(membershipState.roles, 0);
      assert.equal(membershipState.stateSequence.toNumber(), 2);
      assert.equal(membershipState.memberActionSequence.toNumber(), 1);
      assert.equal(membershipState.actorSequence.toNumber(), 2);
    });

    it("rejects self-service joins for private or non-open communities", async () => {
      const privateCommunity = await createCommunity(
        context,
        247,
        "private",
        "open",
      );
      const privateMember = await createIdentity(context, 249);
      const privateMembership = deriveMembership(
        program.programId,
        privateCommunity.address,
        privateMember.address,
      );
      await assertAnchorError(
        program.methods
          .joinCommunity({
            expectedMemberSequence: new BN(0),
            expectedStateSequence: new BN(0),
            expectedMembershipPolicySequence: new BN(1),
            expectedCommunityMembershipSequence: new BN(0),
            manifestHash: digest("private-community-member-join"),
            manifestUri: manifestUri("private-community-member-join"),
          })
          .accountsStrict({
            config,
            community: privateCommunity.address,
            memberIdentity: privateMember.address,
            membership: privateMembership,
            authority: privateMember.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([privateMember.authority])
          .rpc(),
        "CommunityNotPublic",
      );

      const closedCommunity = await createCommunity(
        context,
        251,
        "public",
        "closed",
      );
      const closedMember = await createIdentity(context, 253);
      const closedMembership = deriveMembership(
        program.programId,
        closedCommunity.address,
        closedMember.address,
      );
      await assertAnchorError(
        program.methods
          .joinCommunity({
            expectedMemberSequence: new BN(0),
            expectedStateSequence: new BN(0),
            expectedMembershipPolicySequence: new BN(1),
            expectedCommunityMembershipSequence: new BN(0),
            manifestHash: digest("closed-community-member-join"),
            manifestUri: manifestUri("closed-community-member-join"),
          })
          .accountsStrict({
            config,
            community: closedCommunity.address,
            memberIdentity: closedMember.address,
            membership: closedMembership,
            authority: closedMember.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            delegation: null,
          })
          .signers([closedMember.authority])
          .rpc(),
        "CommunityMembershipNotOpen",
      );

      assert.equal(
        await provider.connection.getAccountInfo(privateMembership),
        null,
      );
      assert.equal(
        await provider.connection.getAccountInfo(closedMembership),
        null,
      );
    });
  });
}
