import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import * as anchor from "@coral-xyz/anchor";
import { AnchorProvider, BN, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import type { Program } from "@coral-xyz/anchor";
import type { SocialProtocol } from "../../target/types/social_protocol";
import { registerCommunityMembershipTests } from "./community_membership";
import { registerGovernanceTests } from "./governance";
import { parsedEvents } from "./governance_test_helpers";
import { registerIdentityDeactivationTests } from "./identity_deactivation";
import { registerPaymentTests } from "./payments";
import { registerPhase2Tests } from "./phase2";
import { manifestUri, TEST_MANIFEST_CID } from "./phase2_test_helpers";
import { registerRecoveryTests } from "./recovery";

const {
  Keypair,
  PublicKey,
  SystemProgram,
} = web3;

const PDA_PREFIX = Buffer.from("wetdrool");
const PDA_VERSION = Buffer.from([1]);
const CONFIG_SEED = Buffer.from("config");
const IDENTITY_SEED = Buffer.from("identity");
const POST_SEED = Buffer.from("post");
const FOLLOW_SEED = Buffer.from("follow");
const TOMBSTONE_SEED = Buffer.from("tombstone");
const DELEGATION_SEED = Buffer.from("delegation");
const BLOCK_SEED = Buffer.from("block");
const COMMUNITY_SEED = Buffer.from("community");
const MEMBERSHIP_SEED = Buffer.from("membership");
const REACTION_SEED = Buffer.from("reaction");

const SCOPE_PROFILE = 1;
const PROFILE_SCHEMA_VERSION = 2;
const SCOPE_SOCIAL = 1 << 2;
const SCOPE_COMMUNITY = 1 << 3;
const COMMUNITY_ROLE_MEMBER = 1;
const REACTION_LIKE = 1;

function digest(value: string): number[] {
  return Array.from(createHash("sha256").update(value).digest());
}

function nonce(value: number): number[] {
  return Array.from({ length: 16 }, (_, index) => (value + index) & 0xff);
}

function u64Seed(value: number): Buffer {
  const seed = Buffer.alloc(8);
  seed.writeBigUInt64LE(BigInt(value));
  return seed;
}

describe("social_protocol local-validator vertical slice", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.SocialProtocol as Program<SocialProtocol>;
  const authorAuthority = Keypair.generate();
  const subjectAuthority = Keypair.generate();
  const attacker = Keypair.generate();
  const rotatedAuthority = Keypair.generate();
  const profileDelegate = Keypair.generate();
  const socialDelegate = Keypair.generate();
  const expiringDelegate = Keypair.generate();
  const communityDelegate = Keypair.generate();
  const rotationOriginalAuthority = Keypair.generate();
  const rotationReplacementAuthority = Keypair.generate();
  const supersededDelegate = Keypair.generate();

  const [config] = PublicKey.findProgramAddressSync(
    [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
    program.programId,
  );
  const authorNonce = nonce(11);
  const subjectNonce = nonce(51);
  const postNonce = nonce(91);
  const secondPostNonce = nonce(111);
  const communityNonce = nonce(131);
  const rotationIdentityNonce = nonce(151);
  const profileHash = digest("profile-manifest-v1");
  const postHash = digest("post-manifest-v1");
  const secondPostHash = digest("post-manifest-v2");

  const [authorIdentity] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      IDENTITY_SEED,
      authorAuthority.publicKey.toBuffer(),
      Buffer.from(authorNonce),
    ],
    program.programId,
  );
  const [subjectIdentity] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      IDENTITY_SEED,
      subjectAuthority.publicKey.toBuffer(),
      Buffer.from(subjectNonce),
    ],
    program.programId,
  );
  const [postReference] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      POST_SEED,
      authorIdentity.toBuffer(),
      Buffer.from(postNonce),
    ],
    program.programId,
  );
  const [secondPostReference] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      POST_SEED,
      authorIdentity.toBuffer(),
      Buffer.from(secondPostNonce),
    ],
    program.programId,
  );
  const [followEdge] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      FOLLOW_SEED,
      authorIdentity.toBuffer(),
      subjectIdentity.toBuffer(),
    ],
    program.programId,
  );
  const [tombstone] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      TOMBSTONE_SEED,
      authorIdentity.toBuffer(),
      postReference.toBuffer(),
    ],
    program.programId,
  );
  const delegationAddress = (
    delegate: web3.PublicKey,
    sequence: number,
  ): web3.PublicKey =>
    PublicKey.findProgramAddressSync(
      [
        PDA_PREFIX,
        PDA_VERSION,
        DELEGATION_SEED,
        authorIdentity.toBuffer(),
        delegate.toBuffer(),
        u64Seed(sequence),
      ],
      program.programId,
    )[0];
  const profileDelegation = delegationAddress(profileDelegate.publicKey, 1);
  const socialDelegation = delegationAddress(socialDelegate.publicKey, 2);
  const expiringDelegation = delegationAddress(expiringDelegate.publicKey, 3);
  const communityDelegation = delegationAddress(
    communityDelegate.publicKey,
    4,
  );
  const [blockEdge] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      BLOCK_SEED,
      authorIdentity.toBuffer(),
      subjectIdentity.toBuffer(),
    ],
    program.programId,
  );
  const [selfBlockEdge] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      BLOCK_SEED,
      authorIdentity.toBuffer(),
      authorIdentity.toBuffer(),
    ],
    program.programId,
  );
  const [community] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      COMMUNITY_SEED,
      authorIdentity.toBuffer(),
      Buffer.from(communityNonce),
    ],
    program.programId,
  );
  const [membership] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      MEMBERSHIP_SEED,
      community.toBuffer(),
      subjectIdentity.toBuffer(),
    ],
    program.programId,
  );
  const [substitutedMembership] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      MEMBERSHIP_SEED,
      community.toBuffer(),
      authorIdentity.toBuffer(),
    ],
    program.programId,
  );
  const [reactionReference] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      REACTION_SEED,
      subjectIdentity.toBuffer(),
      secondPostReference.toBuffer(),
      Buffer.from([REACTION_LIKE]),
    ],
    program.programId,
  );
  const [rotationIdentity] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      IDENTITY_SEED,
      rotationOriginalAuthority.publicKey.toBuffer(),
      Buffer.from(rotationIdentityNonce),
    ],
    program.programId,
  );
  const [supersededDelegation] = PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      DELEGATION_SEED,
      rotationIdentity.toBuffer(),
      supersededDelegate.publicKey.toBuffer(),
      u64Seed(1),
    ],
    program.programId,
  );

  it("creates, updates, publishes, follows, unfollows, refollows, and tombstones", async () => {
    await program.methods
      .initializeProtocol()
      .accountsStrict({
        payer: provider.wallet.publicKey,
        config,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await assert.rejects(
      program.methods
        .initializeProtocol()
        .accountsStrict({
          payer: provider.wallet.publicKey,
          config,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    );

    await program.methods
      .createIdentity({ identityNonce: authorNonce })
      .accountsStrict({
        config,
        identity: authorIdentity,
        rootAuthority: authorAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorAuthority])
      .rpc();

    await program.methods
      .createIdentity({ identityNonce: subjectNonce })
      .accountsStrict({
        config,
        identity: subjectIdentity,
        rootAuthority: subjectAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([subjectAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .updateProfile({
          expectedSequence: new BN(0),
          profileSchemaVersion: 1,
          manifestHash: digest("legacy-profile-schema"),
          manifestUri: manifestUri("legacy-profile-schema"),
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          rootAuthority: authorAuthority.publicKey,
        })
        .signers([authorAuthority])
        .rpc(),
      (error: unknown) => {
        const anchorError = error as {
          error?: { errorCode?: { code?: string } };
        };
        assert.equal(
          anchorError.error?.errorCode?.code,
          "UnsupportedProfileSchemaVersion",
        );
        return true;
      },
    );

    await assert.rejects(
      program.methods
        .updateProfile({
          expectedSequence: new BN(0),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          manifestHash: digest("fake-cid-profile"),
          manifestUri: "ipfs://baaaaaaaaaaaaaaaaaaaa",
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          rootAuthority: authorAuthority.publicKey,
        })
        .signers([authorAuthority])
        .rpc(),
      (error: unknown) => {
        const anchorError = error as {
          error?: { errorCode?: { code?: string } };
        };
        assert.equal(
          anchorError.error?.errorCode?.code,
          "UnsupportedManifestUri",
        );
        return true;
      },
    );

    const profileSignature = await program.methods
      .updateProfile({
        expectedSequence: new BN(0),
        profileSchemaVersion: PROFILE_SCHEMA_VERSION,
        manifestHash: profileHash,
        manifestUri: manifestUri("profile-manifest-v1"),
      })
      .accountsStrict({
        config,
        identity: authorIdentity,
        rootAuthority: authorAuthority.publicKey,
      })
      .signers([authorAuthority])
      .rpc();

    const profileEvents = (await parsedEvents(
      { config, program, provider },
      profileSignature,
    )).filter(({ name }) => name === "profileReferenceUpdated");
    assert.equal(profileEvents.length, 1);
    const profileEvent = profileEvents[0]?.data as
      | Record<string, unknown>
      | undefined;
    assert.ok(profileEvent);
    assert.equal(profileEvent.profileSchemaVersion, PROFILE_SCHEMA_VERSION);

    await assert.rejects(
      program.methods
        .updateProfile({
          expectedSequence: new BN(1),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          manifestHash: digest("attacker-profile"),
          manifestUri: manifestUri("attacker-profile"),
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          rootAuthority: attacker.publicKey,
        })
        .signers([attacker])
        .rpc(),
    );

    await program.methods
      .publishPost({
        expectedAuthorSequence: new BN(1),
        postNonce,
        manifestHash: postHash,
        manifestUri: manifestUri("post-manifest-v1"),
      })
      .accountsStrict({
        config,
        authorIdentity,
        postReference,
        rootAuthority: authorAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .publishPost({
          expectedAuthorSequence: new BN(2),
          postNonce,
          manifestHash: postHash,
          manifestUri: manifestUri("post-manifest-v1"),
        })
        .accountsStrict({
          config,
          authorIdentity,
          postReference,
          rootAuthority: authorAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authorAuthority])
        .rpc(),
    );

    await program.methods
      .follow({ expectedFollowerSequence: new BN(2) })
      .accountsStrict({
        config,
        followerIdentity: authorIdentity,
        subjectIdentity,
        followEdge,
        rootAuthority: authorAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorAuthority])
      .rpc();

    let edgeState = await program.account.followEdge.fetch(followEdge);
    assert.equal(edgeState.active, true);
    assert.equal(edgeState.stateSequence.toNumber(), 1);

    await assert.rejects(
      program.methods
        .follow({ expectedFollowerSequence: new BN(3) })
        .accountsStrict({
          config,
          followerIdentity: authorIdentity,
          subjectIdentity,
          followEdge,
          rootAuthority: authorAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([authorAuthority])
        .rpc(),
    );

    await program.methods
      .unfollow({ expectedFollowerSequence: new BN(3) })
      .accountsStrict({
        config,
        followerIdentity: authorIdentity,
        subjectIdentity,
        followEdge,
        rootAuthority: authorAuthority.publicKey,
      })
      .signers([authorAuthority])
      .rpc();

    edgeState = await program.account.followEdge.fetch(followEdge);
    assert.equal(edgeState.active, false);
    assert.equal(edgeState.stateSequence.toNumber(), 2);

    await program.methods
      .follow({ expectedFollowerSequence: new BN(4) })
      .accountsStrict({
        config,
        followerIdentity: authorIdentity,
        subjectIdentity,
        followEdge,
        rootAuthority: authorAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorAuthority])
      .rpc();

    edgeState = await program.account.followEdge.fetch(followEdge);
    assert.equal(edgeState.active, true);
    assert.equal(edgeState.stateSequence.toNumber(), 3);

    await program.methods
      .tombstonePost({
        expectedAuthorSequence: new BN(5),
        targetHash: postHash,
        reason: { userRequest: {} },
      })
      .accountsStrict({
        config,
        authorIdentity,
        postReference,
        tombstone,
        rootAuthority: authorAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authorAuthority])
      .rpc();

    const authorState = await program.account.identity.fetch(authorIdentity);
    const postState = await program.account.postReference.fetch(postReference);
    const tombstoneState = await program.account.tombstone.fetch(tombstone);
    const configState = await program.account.protocolConfig.fetch(config);

    assert.equal(authorState.sequence.toNumber(), 6);
    assert.notEqual(postState.tombstonedAtSlot, null);
    assert.deepEqual(tombstoneState.targetHash, postHash);
    assert.equal(configState.identityCount.toNumber(), 2);
    assert.equal(configState.postCount.toNumber(), 1);
    assert.equal(configState.followEdgeCount.toNumber(), 1);
    assert.equal(configState.tombstoneCount.toNumber(), 1);
  });

  it("rotates the root without changing the identity PDA and enforces delegation lifecycle", async () => {
    await assert.rejects(
      program.methods
        .rotateRootAuthority({
          expectedIdentitySequence: new BN(6),
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          rootAuthority: authorAuthority.publicKey,
          newRootAuthority: rotatedAuthority.publicKey,
        })
        .signers([authorAuthority])
        .rpc(),
    );

    await program.methods
      .rotateRootAuthority({
        expectedIdentitySequence: new BN(6),
      })
      .accountsStrict({
        config,
        identity: authorIdentity,
        rootAuthority: authorAuthority.publicKey,
        newRootAuthority: rotatedAuthority.publicKey,
      })
      .signers([authorAuthority, rotatedAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .updateProfile({
          expectedSequence: new BN(7),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          manifestHash: digest("old-root-rejected"),
          manifestUri: manifestUri("old-root-rejected"),
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          rootAuthority: authorAuthority.publicKey,
        })
        .signers([authorAuthority])
        .rpc(),
    );

    const initialSlot = await provider.connection.getSlot("confirmed");
    await program.methods
      .createDelegation({
        expectedIdentitySequence: new BN(7),
        delegationSequence: new BN(1),
        delegateAuthority: profileDelegate.publicKey,
        scopes: SCOPE_PROFILE,
        expiresAtSlot: new BN(initialSlot + 1_000),
      })
      .accountsStrict({
        config,
        identity: authorIdentity,
        delegation: profileDelegation,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .updateProfileDelegated({
          expectedSequence: new BN(8),
          profileSchemaVersion: 1,
          manifestHash: digest("legacy-delegated-profile-schema"),
          manifestUri: manifestUri("legacy-delegated-profile-schema"),
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          delegation: profileDelegation,
          delegateAuthority: profileDelegate.publicKey,
        })
        .signers([profileDelegate])
        .rpc(),
      (error: unknown) => {
        const anchorError = error as {
          error?: { errorCode?: { code?: string } };
        };
        assert.equal(
          anchorError.error?.errorCode?.code,
          "UnsupportedProfileSchemaVersion",
        );
        return true;
      },
    );

    await program.methods
      .updateProfileDelegated({
        expectedSequence: new BN(8),
        profileSchemaVersion: PROFILE_SCHEMA_VERSION,
        manifestHash: digest("delegated-profile"),
        manifestUri: manifestUri("delegated-profile"),
      })
      .accountsStrict({
        config,
        identity: authorIdentity,
        delegation: profileDelegation,
        delegateAuthority: profileDelegate.publicKey,
      })
      .signers([profileDelegate])
      .rpc();

    await program.methods
      .createDelegation({
        expectedIdentitySequence: new BN(9),
        delegationSequence: new BN(2),
        delegateAuthority: socialDelegate.publicKey,
        scopes: SCOPE_SOCIAL,
        expiresAtSlot: new BN(initialSlot + 1_000),
      })
      .accountsStrict({
        config,
        identity: authorIdentity,
        delegation: socialDelegation,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .updateProfileDelegated({
          expectedSequence: new BN(10),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          manifestHash: digest("wrong-scope"),
          manifestUri: manifestUri("wrong-scope"),
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          delegation: socialDelegation,
          delegateAuthority: socialDelegate.publicKey,
        })
        .signers([socialDelegate])
        .rpc(),
    );

    const expiryBaseSlot = await provider.connection.getSlot("confirmed");
    const expiresAtSlot = expiryBaseSlot + 8;
    await program.methods
      .createDelegation({
        expectedIdentitySequence: new BN(10),
        delegationSequence: new BN(3),
        delegateAuthority: expiringDelegate.publicKey,
        scopes: SCOPE_PROFILE,
        expiresAtSlot: new BN(expiresAtSlot),
      })
      .accountsStrict({
        config,
        identity: authorIdentity,
        delegation: expiringDelegation,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();

    const expiryDeadline = Date.now() + 20_000;
    while (
      (await provider.connection.getSlot("confirmed")) <= expiresAtSlot &&
      Date.now() < expiryDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(
      (await provider.connection.getSlot("confirmed")) > expiresAtSlot,
      "local validator did not advance beyond delegation expiry",
    );

    await assert.rejects(
      program.methods
        .updateProfileDelegated({
          expectedSequence: new BN(11),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          manifestHash: digest("expired-delegation"),
          manifestUri: manifestUri("expired-delegation"),
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          delegation: expiringDelegation,
          delegateAuthority: expiringDelegate.publicKey,
        })
        .signers([expiringDelegate])
        .rpc(),
    );

    await program.methods
      .revokeDelegation({ expectedIdentitySequence: new BN(11) })
      .accountsStrict({
        config,
        identity: authorIdentity,
        delegation: profileDelegation,
        rootAuthority: rotatedAuthority.publicKey,
      })
      .signers([rotatedAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .updateProfileDelegated({
          expectedSequence: new BN(12),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          manifestHash: digest("revoked-delegation"),
          manifestUri: manifestUri("revoked-delegation"),
        })
        .accountsStrict({
          config,
          identity: authorIdentity,
          delegation: profileDelegation,
          delegateAuthority: profileDelegate.publicKey,
        })
        .signers([profileDelegate])
        .rpc(),
    );
    await assert.rejects(
      program.methods
        .revokeDelegation({ expectedIdentitySequence: new BN(12) })
        .accountsStrict({
          config,
          identity: authorIdentity,
          delegation: profileDelegation,
          rootAuthority: rotatedAuthority.publicKey,
        })
        .signers([rotatedAuthority])
        .rpc(),
    );

    const identityState = await program.account.identity.fetch(authorIdentity);
    const delegationState =
      await program.account.delegation.fetch(profileDelegation);
    assert.equal(
      identityState.originAuthority.toBase58(),
      authorAuthority.publicKey.toBase58(),
    );
    assert.equal(
      identityState.rootAuthority.toBase58(),
      rotatedAuthority.publicKey.toBase58(),
    );
    assert.equal(identityState.rootRotationCount.toNumber(), 1);
    assert.equal(identityState.delegationSequence.toNumber(), 3);
    assert.equal(identityState.sequence.toNumber(), 12);
    assert.equal(delegationState.active, false);
    assert.equal(
      delegationState.issuedAtRootRotationCount.toNumber(),
      1,
    );
    assert.notEqual(delegationState.revokedAtSlot, null);
  });

  it("invalidates delegations issued by a displaced root authority", async () => {
    await program.methods
      .createIdentity({ identityNonce: rotationIdentityNonce })
      .accountsStrict({
        config,
        identity: rotationIdentity,
        rootAuthority: rotationOriginalAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotationOriginalAuthority])
      .rpc();

    const initialSlot = await provider.connection.getSlot("confirmed");
    await program.methods
      .createDelegation({
        expectedIdentitySequence: new BN(0),
        delegationSequence: new BN(1),
        delegateAuthority: supersededDelegate.publicKey,
        scopes: SCOPE_PROFILE,
        expiresAtSlot: new BN(initialSlot + 1_000),
      })
      .accountsStrict({
        config,
        identity: rotationIdentity,
        delegation: supersededDelegation,
        rootAuthority: rotationOriginalAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotationOriginalAuthority])
      .rpc();

    await program.methods
      .updateProfileDelegated({
        expectedSequence: new BN(1),
        profileSchemaVersion: PROFILE_SCHEMA_VERSION,
        manifestHash: digest("pre-rotation-delegated-profile"),
        manifestUri: manifestUri("pre-rotation-delegated-profile"),
      })
      .accountsStrict({
        config,
        identity: rotationIdentity,
        delegation: supersededDelegation,
        delegateAuthority: supersededDelegate.publicKey,
      })
      .signers([supersededDelegate])
      .rpc();

    await program.methods
      .rotateRootAuthority({
        expectedIdentitySequence: new BN(2),
      })
      .accountsStrict({
        config,
        identity: rotationIdentity,
        rootAuthority: rotationOriginalAuthority.publicKey,
        newRootAuthority: rotationReplacementAuthority.publicKey,
      })
      .signers([rotationOriginalAuthority, rotationReplacementAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .updateProfileDelegated({
          expectedSequence: new BN(3),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          manifestHash: digest("superseded-delegation"),
          manifestUri: manifestUri("superseded-delegation"),
        })
        .accountsStrict({
          config,
          identity: rotationIdentity,
          delegation: supersededDelegation,
          delegateAuthority: supersededDelegate.publicKey,
        })
        .signers([supersededDelegate])
        .rpc(),
      (error: unknown) => {
        const anchorError = error as {
          error?: { errorCode?: { code?: string } };
        };
        assert.equal(
          anchorError.error?.errorCode?.code,
          "DelegationIssuerSuperseded",
        );
        return true;
      },
    );

    await program.methods
      .rotateRootAuthority({
        expectedIdentitySequence: new BN(3),
      })
      .accountsStrict({
        config,
        identity: rotationIdentity,
        rootAuthority: rotationReplacementAuthority.publicKey,
        newRootAuthority: rotationOriginalAuthority.publicKey,
      })
      .signers([rotationReplacementAuthority, rotationOriginalAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .updateProfileDelegated({
          expectedSequence: new BN(4),
          profileSchemaVersion: PROFILE_SCHEMA_VERSION,
          manifestHash: digest("superseded-delegation-after-rotate-back"),
          manifestUri: manifestUri(
            "superseded-delegation-after-rotate-back",
          ),
        })
        .accountsStrict({
          config,
          identity: rotationIdentity,
          delegation: supersededDelegation,
          delegateAuthority: supersededDelegate.publicKey,
        })
        .signers([supersededDelegate])
        .rpc(),
      (error: unknown) => {
        const anchorError = error as {
          error?: { errorCode?: { code?: string } };
        };
        assert.equal(
          anchorError.error?.errorCode?.code,
          "DelegationIssuerSuperseded",
        );
        return true;
      },
    );

    const identityState =
      await program.account.identity.fetch(rotationIdentity);
    const delegationState =
      await program.account.delegation.fetch(supersededDelegation);
    assert.equal(identityState.rootRotationCount.toNumber(), 2);
    assert.equal(delegationState.issuedAtRootRotationCount.toNumber(), 0);
  });

  it("replays block and community membership state without closing reusable PDAs", async () => {
    await program.methods
      .setBlock({
        expectedBlockerSequence: new BN(12),
        active: true,
      })
      .accountsStrict({
        config,
        blockerIdentity: authorIdentity,
        subjectIdentity,
        blockEdge,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .setBlock({
          expectedBlockerSequence: new BN(13),
          active: true,
        })
        .accountsStrict({
          config,
          blockerIdentity: authorIdentity,
          subjectIdentity,
          blockEdge,
          rootAuthority: rotatedAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([rotatedAuthority])
        .rpc(),
    );

    await program.methods
      .setBlock({
        expectedBlockerSequence: new BN(13),
        active: false,
      })
      .accountsStrict({
        config,
        blockerIdentity: authorIdentity,
        subjectIdentity,
        blockEdge,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();
    await program.methods
      .setBlock({
        expectedBlockerSequence: new BN(14),
        active: true,
      })
      .accountsStrict({
        config,
        blockerIdentity: authorIdentity,
        subjectIdentity,
        blockEdge,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .setBlock({
          expectedBlockerSequence: new BN(15),
          active: true,
        })
        .accountsStrict({
          config,
          blockerIdentity: authorIdentity,
          subjectIdentity: authorIdentity,
          blockEdge: selfBlockEdge,
          rootAuthority: rotatedAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([rotatedAuthority])
        .rpc(),
    );

    const communityManifestHash = digest("community-manifest-v1");
    const governanceHashV1 = digest("governance-strategy-v1");
    await program.methods
      .createCommunity({
        expectedCreatorSequence: new BN(15),
        communityNonce,
        manifestHash: communityManifestHash,
        manifestUri: manifestUri("community-manifest-v1"),
        governanceVersion: 1,
        governanceStrategyHash: governanceHashV1,
        visibility: { public: {} },
        membershipPolicy: { open: {} },
      })
      .accountsStrict({
        config,
        creatorIdentity: authorIdentity,
        community,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();

    let subjectSequence = (
      await program.account.identity.fetch(subjectIdentity)
    ).sequence.toNumber();
    let membershipStateSequence = 0;
    let communityMembershipSequence = 0;
    const joinSubject = async (label: string): Promise<void> => {
      await program.methods
        .joinCommunity({
          expectedMemberSequence: new BN(subjectSequence),
          expectedStateSequence: new BN(membershipStateSequence),
          expectedMembershipPolicySequence: new BN(1),
          expectedCommunityMembershipSequence: new BN(
            communityMembershipSequence,
          ),
          manifestHash: digest(label),
          manifestUri: manifestUri(label),
        })
        .accountsStrict({
          config,
          community,
          memberIdentity: subjectIdentity,
          membership,
          authority: subjectAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([subjectAuthority])
        .rpc();
      subjectSequence += 1;
      membershipStateSequence += 1;
      communityMembershipSequence += 1;
    };
    const leaveSubject = async (label: string): Promise<void> => {
      await program.methods
        .leaveCommunity({
          expectedMemberSequence: new BN(subjectSequence),
          expectedStateSequence: new BN(membershipStateSequence),
          expectedMembershipPolicySequence: new BN(1),
          expectedCommunityMembershipSequence: new BN(
            communityMembershipSequence,
          ),
          manifestHash: digest(label),
          manifestUri: manifestUri(label),
        })
        .accountsStrict({
          config,
          community,
          memberIdentity: subjectIdentity,
          membership,
          authority: subjectAuthority.publicKey,
          delegation: null,
        })
        .signers([subjectAuthority])
        .rpc();
      subjectSequence += 1;
      membershipStateSequence += 1;
      communityMembershipSequence += 1;
    };

    await joinSubject("community-membership-join-1");
    await assert.rejects(
      program.methods
        .joinCommunity({
          expectedMemberSequence: new BN(subjectSequence),
          expectedStateSequence: new BN(membershipStateSequence),
          expectedMembershipPolicySequence: new BN(1),
          expectedCommunityMembershipSequence: new BN(
            communityMembershipSequence,
          ),
          manifestHash: digest("community-membership-duplicate-join"),
          manifestUri: manifestUri("community-membership-duplicate-join"),
        })
        .accountsStrict({
          config,
          community,
          memberIdentity: subjectIdentity,
          membership,
          authority: subjectAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([subjectAuthority])
        .rpc(),
    );
    await leaveSubject("community-membership-leave-1");
    await joinSubject("community-membership-join-2");

    const delegationSlot = await provider.connection.getSlot("confirmed");
    await program.methods
      .createDelegation({
        expectedIdentitySequence: new BN(16),
        delegationSequence: new BN(4),
        delegateAuthority: communityDelegate.publicKey,
        scopes: SCOPE_COMMUNITY,
        expiresAtSlot: new BN(delegationSlot + 1_000),
      })
      .accountsStrict({
        config,
        identity: authorIdentity,
        delegation: communityDelegation,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();

    let creatorSequence = 17;
    for (let index = 0; index < 4; index += 1) {
      const label = `community-membership-remove-${index + 1}`;
      await program.methods
        .moderateCommunityMembership({
          expectedCreatorSequence: new BN(creatorSequence),
          expectedStateSequence: new BN(membershipStateSequence),
          expectedMembershipPolicySequence: new BN(1),
          expectedCommunityMembershipSequence: new BN(
            communityMembershipSequence,
          ),
          action: { remove: {} },
          manifestHash: digest(label),
          manifestUri: manifestUri(label),
        })
        .accountsStrict({
          config,
          creatorIdentity: authorIdentity,
          community,
          memberIdentity: subjectIdentity,
          membership,
          authority: communityDelegate.publicKey,
          delegation: communityDelegation,
        })
        .signers([communityDelegate])
        .rpc();
      creatorSequence += 1;
      membershipStateSequence += 1;
      communityMembershipSequence += 1;
      await joinSubject(`community-membership-rejoin-${index + 1}`);
    }

    await assert.rejects(
      program.methods
        .joinCommunity({
          expectedMemberSequence: new BN(creatorSequence),
          expectedStateSequence: new BN(membershipStateSequence),
          expectedMembershipPolicySequence: new BN(1),
          expectedCommunityMembershipSequence: new BN(
            communityMembershipSequence,
          ),
          manifestHash: digest("community-membership-substitution"),
          manifestUri: manifestUri("community-membership-substitution"),
        })
        .accountsStrict({
          config,
          community,
          memberIdentity: authorIdentity,
          membership,
          authority: rotatedAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          delegation: null,
        })
        .signers([rotatedAuthority])
        .rpc(),
    );

    await assert.rejects(
      program.methods
        .updateCommunityGovernance({
          expectedCreatorSequence: new BN(21),
          governanceVersion: 3,
          governanceStrategyHash: digest("skipped-governance-version"),
        })
        .accountsStrict({
          config,
          creatorIdentity: authorIdentity,
          community,
          rootAuthority: rotatedAuthority.publicKey,
        })
        .signers([rotatedAuthority])
        .rpc(),
    );

    const governanceHashV2 = digest("governance-strategy-v2");
    await program.methods
      .updateCommunityGovernance({
        expectedCreatorSequence: new BN(21),
        governanceVersion: 2,
        governanceStrategyHash: governanceHashV2,
      })
      .accountsStrict({
        config,
        creatorIdentity: authorIdentity,
        community,
        rootAuthority: rotatedAuthority.publicKey,
      })
      .signers([rotatedAuthority])
      .rpc();

    const blockState = await program.account.blockEdge.fetch(blockEdge);
    const communityState = await program.account.community.fetch(community);
    const membershipState =
      await program.account.communityMembership.fetch(membership);
    assert.equal(blockState.active, true);
    assert.equal(blockState.stateSequence.toNumber(), 3);
    assert.equal(communityState.memberCount.toNumber(), 1);
    assert.equal(communityState.governanceVersion, 2);
    assert.deepEqual(
      communityState.governanceStrategyHash,
      governanceHashV2,
    );
    assert.deepEqual(membershipState.state, { active: {} });
    assert.equal(membershipState.roles, COMMUNITY_ROLE_MEMBER);
    assert.equal(
      membershipState.stateSequence.toNumber(),
      membershipStateSequence,
    );
    assert.equal(
      membershipState.memberActionSequence.toNumber(),
      subjectSequence,
    );
    assert.equal(
      communityState.membershipSequence.toNumber(),
      communityMembershipSequence,
    );

    // The mismatched existing PDA above must remain the only membership account.
    assert.equal(
      await provider.connection.getAccountInfo(substitutedMembership),
      null,
    );
  });

  it("replays reaction removal and re-addition on one deterministic PDA", async () => {
    await program.methods
      .publishPost({
        expectedAuthorSequence: new BN(22),
        postNonce: secondPostNonce,
        manifestHash: secondPostHash,
        manifestUri: manifestUri("post-manifest-v2"),
      })
      .accountsStrict({
        config,
        authorIdentity,
        postReference: secondPostReference,
        rootAuthority: rotatedAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([rotatedAuthority])
      .rpc();

    await program.methods
      .setReaction({
        expectedReactorSequence: new BN(7),
        reactionKind: REACTION_LIKE,
        active: true,
      })
      .accountsStrict({
        config,
        reactorIdentity: subjectIdentity,
        targetPost: secondPostReference,
        reactionReference,
        rootAuthority: subjectAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([subjectAuthority])
      .rpc();

    await assert.rejects(
      program.methods
        .setReaction({
          expectedReactorSequence: new BN(8),
          reactionKind: REACTION_LIKE,
          active: true,
        })
        .accountsStrict({
          config,
          reactorIdentity: subjectIdentity,
          targetPost: secondPostReference,
          reactionReference,
          rootAuthority: subjectAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([subjectAuthority])
        .rpc(),
    );

    await assert.rejects(
      program.methods
        .setReaction({
          expectedReactorSequence: new BN(8),
          reactionKind: REACTION_LIKE,
          active: false,
        })
        .accountsStrict({
          config,
          reactorIdentity: subjectIdentity,
          targetPost: postReference,
          reactionReference,
          rootAuthority: subjectAuthority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .signers([subjectAuthority])
        .rpc(),
    );

    await program.methods
      .setReaction({
        expectedReactorSequence: new BN(8),
        reactionKind: REACTION_LIKE,
        active: false,
      })
      .accountsStrict({
        config,
        reactorIdentity: subjectIdentity,
        targetPost: secondPostReference,
        reactionReference,
        rootAuthority: subjectAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([subjectAuthority])
      .rpc();
    await program.methods
      .setReaction({
        expectedReactorSequence: new BN(9),
        reactionKind: REACTION_LIKE,
        active: true,
      })
      .accountsStrict({
        config,
        reactorIdentity: subjectIdentity,
        targetPost: secondPostReference,
        reactionReference,
        rootAuthority: subjectAuthority.publicKey,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([subjectAuthority])
      .rpc();

    const reactionState =
      await program.account.reactionReference.fetch(reactionReference);
    const configState = await program.account.protocolConfig.fetch(config);
    assert.equal(reactionState.active, true);
    assert.equal(reactionState.stateSequence.toNumber(), 3);
    assert.equal(reactionState.reactorSequence.toNumber(), 10);
    assert.equal(configState.delegationCount.toNumber(), 5);
    assert.equal(configState.blockEdgeCount.toNumber(), 1);
    assert.equal(configState.communityCount.toNumber(), 1);
    assert.equal(configState.membershipCount.toNumber(), 1);
    assert.equal(configState.reactionReferenceCount.toNumber(), 1);
    assert.equal(configState.postCount.toNumber(), 2);
  });

  it("keeps the representative publication path within transaction and compute budgets", async () => {
    const measuredAuthor = Keypair.generate();
    const measuredViewer = Keypair.generate();
    const measuredAuthorNonce = nonce(171);
    const measuredViewerNonce = nonce(191);
    const measuredPostNonce = nonce(211);
    const maximumCid = TEST_MANIFEST_CID;
    const maximumPrefix = "https://example.test/";
    const maximumDirectory = "a".repeat(
      200 - maximumPrefix.length - maximumCid.length - 1,
    );
    const maximumLengthUri =
      `${maximumPrefix}${maximumDirectory}/${maximumCid}`;
    const [measuredAuthorIdentity] = PublicKey.findProgramAddressSync(
      [
        PDA_PREFIX,
        PDA_VERSION,
        IDENTITY_SEED,
        measuredAuthor.publicKey.toBuffer(),
        Buffer.from(measuredAuthorNonce),
      ],
      program.programId,
    );
    const [measuredViewerIdentity] = PublicKey.findProgramAddressSync(
      [
        PDA_PREFIX,
        PDA_VERSION,
        IDENTITY_SEED,
        measuredViewer.publicKey.toBuffer(),
        Buffer.from(measuredViewerNonce),
      ],
      program.programId,
    );
    const [measuredPost] = PublicKey.findProgramAddressSync(
      [
        PDA_PREFIX,
        PDA_VERSION,
        POST_SEED,
        measuredAuthorIdentity.toBuffer(),
        Buffer.from(measuredPostNonce),
      ],
      program.programId,
    );
    const [measuredFollow] = PublicKey.findProgramAddressSync(
      [
        PDA_PREFIX,
        PDA_VERSION,
        FOLLOW_SEED,
        measuredViewerIdentity.toBuffer(),
        measuredAuthorIdentity.toBuffer(),
      ],
      program.programId,
    );
    const [measuredTombstone] = PublicKey.findProgramAddressSync(
      [
        PDA_PREFIX,
        PDA_VERSION,
        TOMBSTONE_SEED,
        measuredAuthorIdentity.toBuffer(),
        measuredPost.toBuffer(),
      ],
      program.programId,
    );

    const measurements: {
      label: string;
      transactionBytes: number;
      computeUnits: number;
    }[] = [];
    const measureAndSend = async (
      label: string,
      build: () => Promise<web3.Transaction>,
      signers: web3.Keypair[],
    ): Promise<void> => {
      const transaction = await build();
      const latestBlockhash = await provider.connection.getLatestBlockhash("confirmed");
      transaction.feePayer = provider.wallet.publicKey;
      transaction.recentBlockhash = latestBlockhash.blockhash;
      transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      if (signers.length > 0) {
        transaction.partialSign(...signers);
      }
      const signedTransaction = await provider.wallet.signTransaction(transaction);
      const serialized = signedTransaction.serialize();
      assert.ok(serialized.byteLength <= 1_100, `${label} exceeds the 1,100-byte budget`);
      assert.ok(serialized.byteLength <= 1_232, `${label} exceeds Solana packet size`);

      const simulation = await provider.connection.simulateTransaction(signedTransaction);
      assert.equal(
        simulation.value.err,
        null,
        `${label} simulation failed: ${JSON.stringify(simulation.value.err)}`,
      );
      assert.equal(typeof simulation.value.unitsConsumed, "number");
      assert.ok(
        (simulation.value.unitsConsumed ?? Number.POSITIVE_INFINITY) <= 150_000,
        `${label} simulation exceeds the 150,000-CU budget`,
      );

      const signature = await provider.connection.sendRawTransaction(serialized, {
        maxRetries: 3,
        skipPreflight: false,
      });
      const confirmation = await provider.connection.confirmTransaction(
        { ...latestBlockhash, signature },
        "confirmed",
      );
      assert.equal(
        confirmation.value.err,
        null,
        `${label} transaction failed: ${JSON.stringify(confirmation.value.err)}`,
      );
      let landed: Awaited<ReturnType<typeof provider.connection.getTransaction>> = null;
      for (let attempt = 0; attempt < 20 && landed === null; attempt += 1) {
        landed = await provider.connection.getTransaction(signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        });
        if (landed === null) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      const computeUnits = landed?.meta?.computeUnitsConsumed;
      assert.equal(typeof computeUnits, "number", `${label} has no compute measurement`);
      assert.ok(
        (computeUnits ?? Number.POSITIVE_INFINITY) <= 150_000,
        `${label} exceeds the 150,000-CU budget`,
      );
      measurements.push({
        label,
        transactionBytes: serialized.byteLength,
        computeUnits: computeUnits ?? 0,
      });
    };

    await measureAndSend(
      "create identity",
      () =>
        program.methods
          .createIdentity({ identityNonce: measuredAuthorNonce })
          .accountsStrict({
            config,
            identity: measuredAuthorIdentity,
            rootAuthority: measuredAuthor.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .transaction(),
      [measuredAuthor],
    );
    await measureAndSend(
      "create viewer identity",
      () =>
        program.methods
          .createIdentity({ identityNonce: measuredViewerNonce })
          .accountsStrict({
            config,
            identity: measuredViewerIdentity,
            rootAuthority: measuredViewer.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .transaction(),
      [measuredViewer],
    );
    await measureAndSend(
      "maximum-length profile reference",
      () =>
        program.methods
          .updateProfile({
            expectedSequence: new BN(0),
            profileSchemaVersion: PROFILE_SCHEMA_VERSION,
            manifestHash: digest("measured-profile"),
            manifestUri: maximumLengthUri,
          })
          .accountsStrict({
            config,
            identity: measuredAuthorIdentity,
            rootAuthority: measuredAuthor.publicKey,
          })
          .transaction(),
      [measuredAuthor],
    );
    await measureAndSend(
      "maximum-length post reference",
      () =>
        program.methods
          .publishPost({
            expectedAuthorSequence: new BN(1),
            postNonce: measuredPostNonce,
            manifestHash: digest("measured-post"),
            manifestUri: maximumLengthUri,
          })
          .accountsStrict({
            config,
            authorIdentity: measuredAuthorIdentity,
            postReference: measuredPost,
            rootAuthority: measuredAuthor.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .transaction(),
      [measuredAuthor],
    );
    await measureAndSend(
      "follow",
      () =>
        program.methods
          .follow({ expectedFollowerSequence: new BN(0) })
          .accountsStrict({
            config,
            followerIdentity: measuredViewerIdentity,
            subjectIdentity: measuredAuthorIdentity,
            followEdge: measuredFollow,
            rootAuthority: measuredViewer.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .transaction(),
      [measuredViewer],
    );
    await measureAndSend(
      "post tombstone",
      () =>
        program.methods
          .tombstonePost({
            expectedAuthorSequence: new BN(2),
            targetHash: digest("measured-post"),
            reason: { userRequest: {} },
          })
          .accountsStrict({
            config,
            authorIdentity: measuredAuthorIdentity,
            postReference: measuredPost,
            tombstone: measuredTombstone,
            rootAuthority: measuredAuthor.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .transaction(),
      [measuredAuthor],
    );

    assert.deepEqual(
      measurements.map(({ label }) => label),
      [
        "create identity",
        "create viewer identity",
        "maximum-length profile reference",
        "maximum-length post reference",
        "follow",
        "post tombstone",
      ],
    );
    const accountExpectations = [
      { address: config, label: "protocol config", space: 91 },
      { address: measuredAuthorIdentity, label: "identity", space: 407 },
      { address: measuredPost, label: "post reference", space: 351 },
      { address: measuredFollow, label: "follow edge", space: 139 },
      { address: measuredTombstone, label: "tombstone", space: 155 },
      { address: profileDelegation, label: "delegation", space: 190 },
      { address: blockEdge, label: "block edge", space: 139 },
      { address: community, label: "community", space: 410 },
      { address: membership, label: "community membership", space: 426 },
      { address: reactionReference, label: "reaction reference", space: 140 },
    ];
    const rentEvidence = [];
    for (const expectation of accountExpectations) {
      const [account, minimumRent] = await Promise.all([
        provider.connection.getAccountInfo(expectation.address, "confirmed"),
        provider.connection.getMinimumBalanceForRentExemption(expectation.space, "confirmed"),
      ]);
      assert.ok(account, `${expectation.label} account is missing`);
      assert.equal(account.data.byteLength, expectation.space, `${expectation.label} space drifted`);
      assert.ok(
        account.lamports >= minimumRent,
        `${expectation.label} is below rent-exempt minimum`,
      );
      rentEvidence.push({
        label: expectation.label,
        space: expectation.space,
        minimumRentLamports: minimumRent,
      });
    }
    process.stdout.write(
      `\ntransaction-cost-evidence ${JSON.stringify({ measurements, rentEvidence })}\n`,
    );
  });

  registerPhase2Tests({ config, program, provider });
  registerGovernanceTests({ config, program, provider });
  registerRecoveryTests({ config, program, provider });
  registerPaymentTests({ config, program, provider });
  registerIdentityDeactivationTests({ config, program, provider });
  registerCommunityMembershipTests({ config, program, provider });
});
