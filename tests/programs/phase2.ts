import { strict as assert } from "node:assert";

import { BN, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import {
  HANDLE_CLAIM_SPACE,
  REACTION_LIKE,
  SCOPE_POST,
  SCOPE_PROFILE,
  SCOPE_SOCIAL,
  assertAnchorError,
  assertRentExemptAccount,
  createDelegation,
  createIdentity,
  deriveBlock,
  deriveFollow,
  deriveHandleClaim,
  derivePost,
  deriveReaction,
  deriveTombstone,
  digest,
  manifestUri,
  measureAndSend,
  nonce,
  waitForAccountClosure,
  waitUntilAfterSlot,
  type DelegationFixture,
  type IdentityFixture,
  type Phase2Context,
  type TransactionMeasurement,
} from "./phase2_test_helpers";

const { Keypair, SystemProgram } = web3;

export function registerPhase2Tests(context: Phase2Context): void {
  const { config, program, provider } = context;

  describe("Phase-2 handle and delegated action coverage", () => {
    it("claims and releases a handle with exact duplicate, validation, authority, substitution, and sequence errors", async () => {
      const owner = await createIdentity(context, 17);
      const contender = await createIdentity(context, 37);
      const handle = "phase_two_handle";
      const handleHash = digest(handle);
      const handleClaim = deriveHandleClaim(program.programId, handleHash);

      const claim = (
        identity: IdentityFixture,
        rootAuthority: web3.Keypair,
        expectedIdentitySequence: number,
        candidateHandle: string,
        candidateHash: number[],
      ): Promise<string> =>
        program.methods
          .claimHandle({
            expectedIdentitySequence: new BN(expectedIdentitySequence),
            handleHash: candidateHash,
            handle: candidateHandle,
          })
          .accountsStrict({
            config,
            identity: identity.address,
            handleClaim: deriveHandleClaim(program.programId, candidateHash),
            rootAuthority: rootAuthority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([rootAuthority])
          .rpc();

      await assertAnchorError(
        claim(owner, owner.authority, 0, "ab", digest("ab")),
        "InvalidHandleLength",
      );
      await assertAnchorError(
        claim(owner, owner.authority, 0, "Phase_two", digest("Phase_two")),
        "InvalidHandleCharacter",
      );
      await assertAnchorError(
        claim(
          owner,
          owner.authority,
          0,
          "phase__two",
          digest("phase__two"),
        ),
        "InvalidHandleFormat",
      );
      await assertAnchorError(
        claim(
          owner,
          owner.authority,
          0,
          "phase_two_mismatch",
          digest("different_valid_handle"),
        ),
        "HandleHashMismatch",
      );
      await assertAnchorError(
        claim(owner, contender.authority, 0, handle, handleHash),
        "Unauthorized",
      );
      await assertAnchorError(
        claim(owner, owner.authority, 1, handle, handleHash),
        "SequenceMismatch",
      );

      await claim(owner, owner.authority, 0, handle, handleHash);

      const claimState = await program.account.handleClaim.fetch(handleClaim);
      assert.equal(claimState.identity.toBase58(), owner.address.toBase58());
      assert.deepEqual(claimState.handleHash, handleHash);
      assert.equal(claimState.handle, handle);
      assert.equal(claimState.identitySequence.toNumber(), 1);

      await assertAnchorError(
        claim(contender, contender.authority, 0, handle, handleHash),
        "HandleAlreadyClaimed",
      );

      const release = (
        identity: IdentityFixture,
        rootAuthority: web3.Keypair,
        expectedIdentitySequence: number,
        candidateHandle: string,
      ): Promise<string> =>
        program.methods
          .releaseHandle({
            expectedIdentitySequence: new BN(expectedIdentitySequence),
            handleHash,
            handle: candidateHandle,
          })
          .accountsStrict({
            config,
            identity: identity.address,
            handleClaim,
            rootAuthority: rootAuthority.publicKey,
          })
          .signers([rootAuthority])
          .rpc();

      await assertAnchorError(
        release(
          owner,
          owner.authority,
          1,
          "phase_two_different_handle",
        ),
        "HandleHashMismatch",
      );
      await assertAnchorError(
        release(owner, contender.authority, 1, handle),
        "Unauthorized",
      );
      await assertAnchorError(
        release(contender, contender.authority, 0, handle),
        "HandleClaimSubstitution",
      );
      await assertAnchorError(
        release(owner, owner.authority, 0, handle),
        "SequenceMismatch",
      );

      await release(owner, owner.authority, 1, handle);

      await waitForAccountClosure(provider, handleClaim);
      const ownerState = await program.account.identity.fetch(owner.address);
      assert.equal(ownerState.sequence.toNumber(), 2);
    });

    it("executes all six delegated variants, including reversible social states, with fresh identities", async () => {
      const actor = await createIdentity(context, 57);
      const subject = await createIdentity(context, 77);
      const delegate = Keypair.generate();
      const delegation = await createDelegation(
        context,
        actor,
        delegate,
        SCOPE_POST | SCOPE_SOCIAL,
      );

      const targetPostNonce = nonce(97);
      const targetPostHash = digest("phase-two-live-target");
      const targetPost = derivePost(
        program.programId,
        subject.address,
        targetPostNonce,
      );
      await program.methods
        .publishPost({
          expectedAuthorSequence: new BN(0),
          postNonce: targetPostNonce,
          manifestHash: targetPostHash,
          manifestUri: manifestUri("phase-two-live-target"),
        })
        .accountsStrict({
          config,
          authorIdentity: subject.address,
          postReference: targetPost,
          rootAuthority: subject.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([subject.authority])
        .rpc();

      const delegatedPostNonce = nonce(117);
      const delegatedPostHash = digest("phase-two-delegated-post");
      const delegatedPost = derivePost(
        program.programId,
        actor.address,
        delegatedPostNonce,
      );
      const delegatedTombstone = deriveTombstone(
        program.programId,
        actor.address,
        delegatedPost,
      );
      const followEdge = deriveFollow(
        program.programId,
        actor.address,
        subject.address,
      );
      const blockEdge = deriveBlock(
        program.programId,
        actor.address,
        subject.address,
      );
      const reactionReference = deriveReaction(
        program.programId,
        actor.address,
        targetPost,
        REACTION_LIKE,
      );

      await program.methods
        .publishPostDelegated({
          expectedAuthorSequence: new BN(1),
          postNonce: delegatedPostNonce,
          manifestHash: delegatedPostHash,
          manifestUri: manifestUri("phase-two-delegated-post"),
        })
        .accountsStrict({
          config,
          authorIdentity: actor.address,
          delegation: delegation.address,
          delegateAuthority: delegate.publicKey,
          postReference: delegatedPost,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([delegate])
        .rpc();
      await program.methods
        .tombstonePostDelegated({
          expectedAuthorSequence: new BN(2),
          targetHash: delegatedPostHash,
          reason: { userRequest: {} },
        })
        .accountsStrict({
          config,
          authorIdentity: actor.address,
          delegation: delegation.address,
          delegateAuthority: delegate.publicKey,
          postReference: delegatedPost,
          tombstone: delegatedTombstone,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([delegate])
        .rpc();
      await program.methods
        .followDelegated({ expectedFollowerSequence: new BN(3) })
        .accountsStrict({
          config,
          followerIdentity: actor.address,
          subjectIdentity: subject.address,
          delegation: delegation.address,
          delegateAuthority: delegate.publicKey,
          followEdge,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([delegate])
        .rpc();
      await program.methods
        .unfollowDelegated({ expectedFollowerSequence: new BN(4) })
        .accountsStrict({
          config,
          followerIdentity: actor.address,
          subjectIdentity: subject.address,
          followEdge,
          delegation: delegation.address,
          delegateAuthority: delegate.publicKey,
        })
        .signers([delegate])
        .rpc();
      await program.methods
        .setBlockDelegated({
          expectedBlockerSequence: new BN(5),
          active: true,
        })
        .accountsStrict({
          config,
          blockerIdentity: actor.address,
          subjectIdentity: subject.address,
          delegation: delegation.address,
          delegateAuthority: delegate.publicKey,
          blockEdge,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([delegate])
        .rpc();
      await program.methods
        .setBlockDelegated({
          expectedBlockerSequence: new BN(6),
          active: false,
        })
        .accountsStrict({
          config,
          blockerIdentity: actor.address,
          subjectIdentity: subject.address,
          delegation: delegation.address,
          delegateAuthority: delegate.publicKey,
          blockEdge,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([delegate])
        .rpc();
      await program.methods
        .setReactionDelegated({
          expectedReactorSequence: new BN(7),
          reactionKind: REACTION_LIKE,
          active: true,
        })
        .accountsStrict({
          config,
          reactorIdentity: actor.address,
          targetPost,
          delegation: delegation.address,
          delegateAuthority: delegate.publicKey,
          reactionReference,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([delegate])
        .rpc();
      await program.methods
        .setReactionDelegated({
          expectedReactorSequence: new BN(8),
          reactionKind: REACTION_LIKE,
          active: false,
        })
        .accountsStrict({
          config,
          reactorIdentity: actor.address,
          targetPost,
          delegation: delegation.address,
          delegateAuthority: delegate.publicKey,
          reactionReference,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([delegate])
        .rpc();

      const [
        actorState,
        postState,
        tombstoneState,
        followState,
        blockState,
        reactionState,
      ] = await Promise.all([
        program.account.identity.fetch(actor.address),
        program.account.postReference.fetch(delegatedPost),
        program.account.tombstone.fetch(delegatedTombstone),
        program.account.followEdge.fetch(followEdge),
        program.account.blockEdge.fetch(blockEdge),
        program.account.reactionReference.fetch(reactionReference),
      ]);
      assert.equal(actorState.sequence.toNumber(), 9);
      assert.notEqual(postState.tombstonedAtSlot, null);
      assert.equal(
        tombstoneState.targetPost.toBase58(),
        delegatedPost.toBase58(),
      );
      assert.equal(followState.active, false);
      assert.equal(followState.stateSequence.toNumber(), 2);
      assert.equal(blockState.active, false);
      assert.equal(blockState.stateSequence.toNumber(), 2);
      assert.equal(reactionState.active, false);
      assert.equal(reactionState.stateSequence.toNumber(), 2);
    });

    it("rejects delegated identity, signer, scope, revocation, expiry, and issuer-epoch attacks with exact errors", async () => {
      const validIdentity = await createIdentity(context, 137);
      const otherIdentity = await createIdentity(context, 157);
      const validDelegate = Keypair.generate();
      const validDelegation = await createDelegation(
        context,
        validIdentity,
        validDelegate,
        SCOPE_POST,
      );
      const wrongSigner = Keypair.generate();

      const rejectedPublish = (
        identity: IdentityFixture,
        delegation: DelegationFixture,
        signer: web3.Keypair,
        postNonceStart: number,
        expectedSequence: number,
      ): Promise<string> => {
        const postNonce = nonce(postNonceStart);
        return program.methods
          .publishPostDelegated({
            expectedAuthorSequence: new BN(expectedSequence),
            postNonce,
            manifestHash: digest(`rejected-${postNonceStart}`),
            manifestUri: manifestUri(`rejected-${postNonceStart}`),
          })
          .accountsStrict({
            config,
            authorIdentity: identity.address,
            delegation: delegation.address,
            delegateAuthority: signer.publicKey,
            postReference: derivePost(
              program.programId,
              identity.address,
              postNonce,
            ),
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([signer])
          .rpc();
      };

      await assertAnchorError(
        rejectedPublish(validIdentity, validDelegation, wrongSigner, 177, 1),
        "DelegationSubstitution",
      );
      await assertAnchorError(
        rejectedPublish(otherIdentity, validDelegation, validDelegate, 187, 0),
        "DelegationSubstitution",
      );

      const scopeIdentity = await createIdentity(context, 197);
      const scopeDelegate = Keypair.generate();
      const scopeDelegation = await createDelegation(
        context,
        scopeIdentity,
        scopeDelegate,
        SCOPE_PROFILE,
      );
      await assertAnchorError(
        rejectedPublish(scopeIdentity, scopeDelegation, scopeDelegate, 207, 1),
        "DelegationScopeMissing",
      );

      const revokedIdentity = await createIdentity(context, 217);
      const revokedDelegate = Keypair.generate();
      const revokedDelegation = await createDelegation(
        context,
        revokedIdentity,
        revokedDelegate,
        SCOPE_POST,
      );
      await program.methods
        .revokeDelegation({ expectedIdentitySequence: new BN(1) })
        .accountsStrict({
          config,
          identity: revokedIdentity.address,
          delegation: revokedDelegation.address,
          rootAuthority: revokedIdentity.authority.publicKey,
        })
        .signers([revokedIdentity.authority])
        .rpc();
      await assertAnchorError(
        rejectedPublish(
          revokedIdentity,
          revokedDelegation,
          revokedDelegate,
          227,
          2,
        ),
        "DelegationRevoked",
      );

      const expiringIdentity = await createIdentity(context, 237);
      const expiringDelegate = Keypair.generate();
      const expiryBaseSlot = await provider.connection.getSlot("confirmed");
      const expiresAtSlot = expiryBaseSlot + 8;
      const expiringDelegation = await createDelegation(
        context,
        expiringIdentity,
        expiringDelegate,
        SCOPE_POST,
        { expiresAtSlot },
      );
      await waitUntilAfterSlot(provider, expiresAtSlot);
      await assertAnchorError(
        rejectedPublish(
          expiringIdentity,
          expiringDelegation,
          expiringDelegate,
          247,
          1,
        ),
        "DelegationExpired",
      );

      const epochIdentity = await createIdentity(context, 1);
      const epochDelegate = Keypair.generate();
      const epochDelegation = await createDelegation(
        context,
        epochIdentity,
        epochDelegate,
        SCOPE_POST,
      );
      const replacementAuthority = Keypair.generate();
      await program.methods
        .rotateRootAuthority({ expectedIdentitySequence: new BN(1) })
        .accountsStrict({
          config,
          identity: epochIdentity.address,
          rootAuthority: epochIdentity.authority.publicKey,
          newRootAuthority: replacementAuthority.publicKey,
        })
        .signers([epochIdentity.authority, replacementAuthority])
        .rpc();
      await assertAnchorError(
        rejectedPublish(
          epochIdentity,
          epochDelegation,
          epochDelegate,
          11,
          2,
        ),
        "DelegationIssuerSuperseded",
      );
    });

    it("keeps every Phase-2 instruction within transaction, compute, and rent budgets", async () => {
      const actor = await createIdentity(context, 31);
      const subject = await createIdentity(context, 51);
      const delegate = Keypair.generate();
      const delegation = await createDelegation(
        context,
        actor,
        delegate,
        SCOPE_POST | SCOPE_SOCIAL,
      );

      const targetPostNonce = nonce(71);
      const targetPost = derivePost(
        program.programId,
        subject.address,
        targetPostNonce,
      );
      await program.methods
        .publishPost({
          expectedAuthorSequence: new BN(0),
          postNonce: targetPostNonce,
          manifestHash: digest("phase-two-budget-target"),
          manifestUri: manifestUri("phase-two-budget-target"),
        })
        .accountsStrict({
          config,
          authorIdentity: subject.address,
          postReference: targetPost,
          rootAuthority: subject.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([subject.authority])
        .rpc();

      const measurements: TransactionMeasurement[] = [];
      const handle = "phase_two_budget_handle_123456";
      const handleHash = digest(handle);
      const handleClaim = deriveHandleClaim(program.programId, handleHash);
      measurements.push(
        await measureAndSend(
          context,
          "claim handle",
          () =>
            program.methods
              .claimHandle({
                expectedIdentitySequence: new BN(1),
                handleHash,
                handle,
              })
              .accountsStrict({
                config,
                identity: actor.address,
                handleClaim,
                rootAuthority: actor.authority.publicKey,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [actor.authority],
        ),
      );
      const rentEvidence = await assertRentExemptAccount(
        context,
        handleClaim,
        "handle claim",
        HANDLE_CLAIM_SPACE,
      );
      measurements.push(
        await measureAndSend(
          context,
          "release handle",
          () =>
            program.methods
              .releaseHandle({
                expectedIdentitySequence: new BN(2),
                handleHash,
                handle,
              })
              .accountsStrict({
                config,
                identity: actor.address,
                handleClaim,
                rootAuthority: actor.authority.publicKey,
              })
              .transaction(),
          [actor.authority],
        ),
      );

      const delegatedPostNonce = nonce(91);
      const delegatedPostHash = digest("phase-two-budget-post");
      const delegatedPost = derivePost(
        program.programId,
        actor.address,
        delegatedPostNonce,
      );
      const delegatedTombstone = deriveTombstone(
        program.programId,
        actor.address,
        delegatedPost,
      );
      const followEdge = deriveFollow(
        program.programId,
        actor.address,
        subject.address,
      );
      const blockEdge = deriveBlock(
        program.programId,
        actor.address,
        subject.address,
      );
      const reactionReference = deriveReaction(
        program.programId,
        actor.address,
        targetPost,
        REACTION_LIKE,
      );

      measurements.push(
        await measureAndSend(
          context,
          "publish post delegated",
          () =>
            program.methods
              .publishPostDelegated({
                expectedAuthorSequence: new BN(3),
                postNonce: delegatedPostNonce,
                manifestHash: delegatedPostHash,
                manifestUri: manifestUri("phase-two-budget-post"),
              })
              .accountsStrict({
                config,
                authorIdentity: actor.address,
                delegation: delegation.address,
                delegateAuthority: delegate.publicKey,
                postReference: delegatedPost,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [delegate],
        ),
      );
      measurements.push(
        await measureAndSend(
          context,
          "tombstone post delegated",
          () =>
            program.methods
              .tombstonePostDelegated({
                expectedAuthorSequence: new BN(4),
                targetHash: delegatedPostHash,
                reason: { userRequest: {} },
              })
              .accountsStrict({
                config,
                authorIdentity: actor.address,
                delegation: delegation.address,
                delegateAuthority: delegate.publicKey,
                postReference: delegatedPost,
                tombstone: delegatedTombstone,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [delegate],
        ),
      );
      measurements.push(
        await measureAndSend(
          context,
          "follow delegated",
          () =>
            program.methods
              .followDelegated({ expectedFollowerSequence: new BN(5) })
              .accountsStrict({
                config,
                followerIdentity: actor.address,
                subjectIdentity: subject.address,
                delegation: delegation.address,
                delegateAuthority: delegate.publicKey,
                followEdge,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [delegate],
        ),
      );
      measurements.push(
        await measureAndSend(
          context,
          "unfollow delegated",
          () =>
            program.methods
              .unfollowDelegated({ expectedFollowerSequence: new BN(6) })
              .accountsStrict({
                config,
                followerIdentity: actor.address,
                subjectIdentity: subject.address,
                followEdge,
                delegation: delegation.address,
                delegateAuthority: delegate.publicKey,
              })
              .transaction(),
          [delegate],
        ),
      );
      measurements.push(
        await measureAndSend(
          context,
          "set block delegated",
          () =>
            program.methods
              .setBlockDelegated({
                expectedBlockerSequence: new BN(7),
                active: true,
              })
              .accountsStrict({
                config,
                blockerIdentity: actor.address,
                subjectIdentity: subject.address,
                delegation: delegation.address,
                delegateAuthority: delegate.publicKey,
                blockEdge,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [delegate],
        ),
      );
      measurements.push(
        await measureAndSend(
          context,
          "set reaction delegated",
          () =>
            program.methods
              .setReactionDelegated({
                expectedReactorSequence: new BN(8),
                reactionKind: REACTION_LIKE,
                active: true,
              })
              .accountsStrict({
                config,
                reactorIdentity: actor.address,
                targetPost,
                delegation: delegation.address,
                delegateAuthority: delegate.publicKey,
                reactionReference,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [delegate],
        ),
      );

      assert.deepEqual(
        measurements.map(({ label }) => label),
        [
          "claim handle",
          "release handle",
          "publish post delegated",
          "tombstone post delegated",
          "follow delegated",
          "unfollow delegated",
          "set block delegated",
          "set reaction delegated",
        ],
      );
      process.stdout.write(
        `\nphase-2-transaction-cost-evidence ${JSON.stringify({
          measurements,
          rentEvidence: [rentEvidence],
        })}\n`,
      );
    });
  });
}
