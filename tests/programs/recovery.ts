import { strict as assert } from "node:assert";

import { BN, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import {
  SCOPE_PROFILE,
  assertAnchorError,
  assertRentExemptAccount,
  createDelegation,
  createIdentity,
  digest,
  manifestUri,
  measureAndSend,
  nonce,
  type IdentityFixture,
  type Phase2Context,
  type TransactionMeasurement,
} from "./phase2_test_helpers";
import { parsedEvents, waitUntilSlot } from "./governance_test_helpers";

const { Keypair, PublicKey, SystemProgram } = web3;

const PDA_PREFIX = Buffer.from("wetdrool");
const PDA_VERSION = Buffer.from([1]);
const PROFILE_SCHEMA_VERSION = 2;
const RECOVERY_POLICY_SEED = Buffer.from("recovery_policy");
const RECOVERY_REQUEST_SEED = Buffer.from("recovery_request");

export const RECOVERY_POLICY_SPACE = 264;
export const RECOVERY_REQUEST_SPACE = 272;

type UnknownRecord = Record<string, unknown>;

interface RecoveryFixture {
  guardians: web3.Keypair[];
  identity: IdentityFixture;
  policy: web3.PublicKey;
}

function record(value: unknown): UnknownRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as UnknownRecord;
}

function eventByName(
  events: { data: unknown; name: string }[],
  expectedName: string,
): UnknownRecord {
  const matches = events.filter(({ name }) => name === expectedName);
  assert.equal(matches.length, 1, `expected one ${expectedName} event`);
  return record(matches[0]?.data);
}

export function deriveRecoveryPolicy(
  programId: web3.PublicKey,
  identity: web3.PublicKey,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      RECOVERY_POLICY_SEED,
      identity.toBuffer(),
    ],
    programId,
  )[0];
}

export function deriveRecoveryRequest(
  programId: web3.PublicKey,
  identity: web3.PublicKey,
  requestNonce: number[],
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      RECOVERY_REQUEST_SEED,
      identity.toBuffer(),
      Buffer.from(requestNonce),
    ],
    programId,
  )[0];
}

async function createRecoveryFixture(
  context: Phase2Context,
  nonceStart: number,
  guardianCount = 3,
): Promise<RecoveryFixture> {
  const identity = await createIdentity(context, nonceStart);
  const guardians = Array.from({ length: guardianCount }, () =>
    Keypair.generate(),
  );
  return {
    guardians,
    identity,
    policy: deriveRecoveryPolicy(context.program.programId, identity.address),
  };
}

async function configurePolicy(
  context: Phase2Context,
  fixture: RecoveryFixture,
  options: {
    delaySlots?: number;
    expectedIdentitySequence?: number;
    expectedPolicySequence?: number;
    guardians?: web3.Keypair[];
    threshold?: number;
  } = {},
): Promise<string> {
  const guardians = options.guardians ?? fixture.guardians;
  return context.program.methods
    .configureRecoveryPolicy({
      expectedIdentitySequence: new BN(
        options.expectedIdentitySequence ?? 0,
      ),
      expectedPolicySequence: new BN(options.expectedPolicySequence ?? 0),
      guardians: guardians.map(({ publicKey }) => publicKey),
      threshold: options.threshold ?? 2,
      delaySlots: new BN(options.delaySlots ?? 2),
    })
    .accountsStrict({
      config: context.config,
      identity: fixture.identity.address,
      recoveryPolicy: fixture.policy,
      rootAuthority: fixture.identity.authority.publicKey,
      payer: context.provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([fixture.identity.authority])
    .rpc();
}

async function requestRecovery(
  context: Phase2Context,
  fixture: RecoveryFixture,
  requestNonce: number[],
  targetRoot: web3.PublicKey,
  options: {
    expectedIdentitySequence?: number;
    expectedPolicySequence?: number;
    expectedRootRotationCount?: number;
    guardian?: web3.Keypair;
  } = {},
): Promise<{ address: web3.PublicKey; signature: string }> {
  const guardian = options.guardian ?? fixture.guardians[0];
  assert.ok(guardian);
  const address = deriveRecoveryRequest(
    context.program.programId,
    fixture.identity.address,
    requestNonce,
  );
  const signature = await context.program.methods
    .requestRecovery({
      requestNonce,
      expectedPolicySequence: new BN(options.expectedPolicySequence ?? 1),
      expectedIdentitySequence: new BN(options.expectedIdentitySequence ?? 1),
      expectedRootRotationCount: new BN(
        options.expectedRootRotationCount ?? 0,
      ),
      targetRootAuthority: targetRoot,
    })
    .accountsStrict({
      config: context.config,
      identity: fixture.identity.address,
      recoveryPolicy: fixture.policy,
      recoveryRequest: address,
      guardian: guardian.publicKey,
      payer: context.provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([guardian])
    .rpc();
  return { address, signature };
}

function approveRecovery(
  context: Phase2Context,
  fixture: RecoveryFixture,
  recoveryRequest: web3.PublicKey,
  guardian: web3.Keypair,
): Promise<string> {
  return context.program.methods
    .approveRecovery()
    .accountsStrict({
      config: context.config,
      identity: fixture.identity.address,
      recoveryPolicy: fixture.policy,
      recoveryRequest,
      guardian: guardian.publicKey,
    })
    .signers([guardian])
    .rpc();
}

function executeRecovery(
  context: Phase2Context,
  fixture: RecoveryFixture,
  recoveryRequest: web3.PublicKey,
  executor: web3.Keypair,
  newRoot: web3.Keypair,
): Promise<string> {
  return context.program.methods
    .executeRecovery()
    .accountsStrict({
      config: context.config,
      identity: fixture.identity.address,
      recoveryPolicy: fixture.policy,
      recoveryRequest,
      executor: executor.publicKey,
      newRootAuthority: newRoot.publicKey,
    })
    .signers([executor, newRoot])
    .rpc();
}

export function registerRecoveryTests(context: Phase2Context): void {
  const { config, program, provider } = context;

  describe("delayed guardian recovery", () => {
    it("restricts policy configuration and emits exact versioned configure/disable events", async () => {
      const fixture = await createRecoveryFixture(context, 231, 2);
      const attacker = Keypair.generate();

      await assertAnchorError(
        program.methods
          .configureRecoveryPolicy({
            expectedIdentitySequence: new BN(0),
            expectedPolicySequence: new BN(0),
            guardians: fixture.guardians.map(({ publicKey }) => publicKey),
            threshold: 2,
            delaySlots: new BN(2),
          })
          .accountsStrict({
            config,
            identity: fixture.identity.address,
            recoveryPolicy: fixture.policy,
            rootAuthority: attacker.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized",
      );

      const duplicateGuardian = fixture.guardians[0];
      assert.ok(duplicateGuardian);
      await assertAnchorError(
        program.methods
          .configureRecoveryPolicy({
            expectedIdentitySequence: new BN(0),
            expectedPolicySequence: new BN(0),
            guardians: [
              duplicateGuardian.publicKey,
              duplicateGuardian.publicKey,
            ],
            threshold: 2,
            delaySlots: new BN(2),
          })
          .accountsStrict({
            config,
            identity: fixture.identity.address,
            recoveryPolicy: fixture.policy,
            rootAuthority: fixture.identity.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([fixture.identity.authority])
          .rpc(),
        "DuplicateRecoveryGuardian",
      );

      const configureSignature = await configurePolicy(context, fixture);
      const configured = eventByName(
        await parsedEvents(context, configureSignature),
        "recoveryPolicyConfigured",
      );
      assert.equal(configured.eventVersion, 1);
      assert.equal(
        (configured.recoveryPolicy as web3.PublicKey).toBase58(),
        fixture.policy.toBase58(),
      );
      assert.equal((configured.policySequence as BN).toNumber(), 1);
      assert.equal((configured.identitySequence as BN).toNumber(), 1);
      assert.equal(configured.threshold, 2);
      assert.equal((configured.delaySlots as BN).toNumber(), 2);

      const disableSignature = await program.methods
        .disableRecoveryPolicy({
          expectedIdentitySequence: new BN(1),
          expectedPolicySequence: new BN(1),
        })
        .accountsStrict({
          config,
          identity: fixture.identity.address,
          recoveryPolicy: fixture.policy,
          rootAuthority: fixture.identity.authority.publicKey,
        })
        .signers([fixture.identity.authority])
        .rpc();
      const disabled = eventByName(
        await parsedEvents(context, disableSignature),
        "recoveryPolicyDisabled",
      );
      assert.equal(disabled.eventVersion, 1);
      assert.equal((disabled.policySequence as BN).toNumber(), 2);
      assert.equal((disabled.identitySequence as BN).toNumber(), 2);

      const disabledPolicy =
        await program.account.recoveryPolicy.fetch(fixture.policy);
      assert.equal(disabledPolicy.active, false);
      assert.equal(disabledPolicy.policySequence.toNumber(), 2);

      const blockedRequestNonce = nonce(232);
      const blockedRequest = deriveRecoveryRequest(
        program.programId,
        fixture.identity.address,
        blockedRequestNonce,
      );
      const firstGuardian = fixture.guardians[0];
      assert.ok(firstGuardian);
      await assertAnchorError(
        program.methods
          .requestRecovery({
            requestNonce: blockedRequestNonce,
            expectedPolicySequence: new BN(2),
            expectedIdentitySequence: new BN(2),
            expectedRootRotationCount: new BN(0),
            targetRootAuthority: Keypair.generate().publicKey,
          })
          .accountsStrict({
            config,
            identity: fixture.identity.address,
            recoveryPolicy: fixture.policy,
            recoveryRequest: blockedRequest,
            guardian: firstGuardian.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([firstGuardian])
          .rpc(),
        "RecoveryPolicyDisabled",
      );
      assert.equal(
        await provider.connection.getAccountInfo(blockedRequest, "confirmed"),
        null,
      );
    });

    it("executes only after distinct threshold approvals and target proof, then invalidates old delegations and replay", async () => {
      const fixture = await createRecoveryFixture(context, 241);
      const newRoot = Keypair.generate();
      const executor = Keypair.generate();
      const outsider = Keypair.generate();
      const wrongTarget = Keypair.generate();
      const delegate = Keypair.generate();
      const delaySlots = 20;

      const configureSignature = await configurePolicy(context, fixture, {
        delaySlots,
      });
      const configured = eventByName(
        await parsedEvents(context, configureSignature),
        "recoveryPolicyConfigured",
      );
      assert.equal(configured.eventVersion, 1);

      const delegation = await createDelegation(
        context,
        fixture.identity,
        delegate,
        SCOPE_PROFILE,
        { expectedIdentitySequence: 1 },
      );
      const requestNonce = nonce(242);
      const requested = await requestRecovery(
        context,
        fixture,
        requestNonce,
        newRoot.publicKey,
        { expectedIdentitySequence: 2 },
      );
      const requestedEvent = eventByName(
        await parsedEvents(context, requested.signature),
        "recoveryRequested",
      );
      assert.equal(requestedEvent.eventVersion, 1);
      assert.equal((requestedEvent.approvalCount as number), 1);
      assert.equal((requestedEvent.threshold as number), 2);
      assert.equal(
        (requestedEvent.currentRootAuthority as web3.PublicKey).toBase58(),
        fixture.identity.authority.publicKey.toBase58(),
      );
      assert.equal(
        (requestedEvent.targetRootAuthority as web3.PublicKey).toBase58(),
        newRoot.publicKey.toBase58(),
      );

      await assertAnchorError(
        approveRecovery(context, fixture, requested.address, outsider),
        "RecoveryGuardianNotAuthorized",
      );
      const firstGuardian = fixture.guardians[0];
      const secondGuardian = fixture.guardians[1];
      assert.ok(firstGuardian);
      assert.ok(secondGuardian);
      await assertAnchorError(
        approveRecovery(context, fixture, requested.address, firstGuardian),
        "RecoveryGuardianAlreadyApproved",
      );
      await assertAnchorError(
        executeRecovery(
          context,
          fixture,
          requested.address,
          executor,
          newRoot,
        ),
        "RecoveryTooEarly",
      );

      const singlyApproved =
        await program.account.recoveryRequest.fetch(requested.address);
      assert.equal(singlyApproved.approvalsMask, 0b001);
      assert.equal(singlyApproved.approvalCount, 1);
      await waitUntilSlot(
        provider,
        singlyApproved.executeAfterSlot.toNumber(),
      );
      await assertAnchorError(
        executeRecovery(
          context,
          fixture,
          requested.address,
          executor,
          newRoot,
        ),
        "RecoveryThresholdNotMet",
      );

      const approvalSignature = await approveRecovery(
        context,
        fixture,
        requested.address,
        secondGuardian,
      );
      const approved = eventByName(
        await parsedEvents(context, approvalSignature),
        "recoveryApproved",
      );
      assert.equal(approved.eventVersion, 1);
      assert.equal(approved.guardianIndex, 1);
      assert.equal(approved.approvalCount, 2);

      const pending =
        await program.account.recoveryRequest.fetch(requested.address);
      assert.deepEqual(pending.state, { pending: {} });
      assert.equal(pending.approvalsMask, 0b011);
      assert.equal(pending.approvalCount, 2);

      await assert.rejects(
        program.methods
          .executeRecovery()
          .accountsStrict({
            config,
            identity: fixture.identity.address,
            recoveryPolicy: fixture.policy,
            recoveryRequest: requested.address,
            executor: executor.publicKey,
            newRootAuthority: newRoot.publicKey,
          })
          .signers([executor])
          .rpc(),
      );
      await assertAnchorError(
        executeRecovery(
          context,
          fixture,
          requested.address,
          executor,
          wrongTarget,
        ),
        "InvalidRecoveryTarget",
      );

      const executeSignature = await executeRecovery(
        context,
        fixture,
        requested.address,
        executor,
        newRoot,
      );
      const executionEvents = await parsedEvents(context, executeSignature);
      assert.deepEqual(
        executionEvents.map(({ name }) => name),
        ["rootAuthorityRotated", "recoveryExecuted"],
      );
      const executed = eventByName(executionEvents, "recoveryExecuted");
      assert.equal(executed.eventVersion, 1);
      assert.equal(
        (executed.executor as web3.PublicKey).toBase58(),
        executor.publicKey.toBase58(),
      );
      assert.equal(
        (executed.newRootAuthority as web3.PublicKey).toBase58(),
        newRoot.publicKey.toBase58(),
      );
      assert.equal((executed.identitySequence as BN).toNumber(), 3);
      assert.equal((executed.rotationCount as BN).toNumber(), 1);

      const [recoveredIdentity, terminalRequest] = await Promise.all([
        program.account.identity.fetch(fixture.identity.address),
        program.account.recoveryRequest.fetch(requested.address),
      ]);
      assert.equal(
        recoveredIdentity.rootAuthority.toBase58(),
        newRoot.publicKey.toBase58(),
      );
      assert.equal(recoveredIdentity.sequence.toNumber(), 3);
      assert.equal(recoveredIdentity.rootRotationCount.toNumber(), 1);
      assert.deepEqual(terminalRequest.state, { executed: {} });
      assert.notEqual(terminalRequest.terminalAtSlot, null);

      await assertAnchorError(
        program.methods
          .updateProfileDelegated({
            expectedSequence: new BN(3),
            profileSchemaVersion: PROFILE_SCHEMA_VERSION,
            manifestHash: digest("recovery-old-delegation-rejected"),
            manifestUri: manifestUri("recovery-old-delegation-rejected"),
          })
          .accountsStrict({
            config,
            identity: fixture.identity.address,
            delegation: delegation.address,
            delegateAuthority: delegate.publicKey,
          })
          .signers([delegate])
          .rpc(),
        "DelegationIssuerSuperseded",
      );
      await assertAnchorError(
        executeRecovery(
          context,
          fixture,
          requested.address,
          executor,
          newRoot,
        ),
        "RecoveryRequestAlreadyTerminal",
      );
      assert.notEqual(
        await provider.connection.getAccountInfo(
          requested.address,
          "confirmed",
        ),
        null,
      );
    });

    it("stales a pending request after ordinary rotation and lets only the current root terminally cancel it", async () => {
      const fixture = await createRecoveryFixture(context, 251);
      const ordinaryNewRoot = Keypair.generate();
      const recoveryTarget = Keypair.generate();
      const executor = Keypair.generate();
      await configurePolicy(context, fixture, { delaySlots: 2 });
      const requested = await requestRecovery(
        context,
        fixture,
        nonce(252),
        recoveryTarget.publicKey,
      );

      await program.methods
        .rotateRootAuthority({ expectedIdentitySequence: new BN(1) })
        .accountsStrict({
          config,
          identity: fixture.identity.address,
          rootAuthority: fixture.identity.authority.publicKey,
          newRootAuthority: ordinaryNewRoot.publicKey,
        })
        .signers([fixture.identity.authority, ordinaryNewRoot])
        .rpc();

      const secondGuardian = fixture.guardians[1];
      assert.ok(secondGuardian);
      await assertAnchorError(
        approveRecovery(context, fixture, requested.address, secondGuardian),
        "RecoveryRequestStaleRoot",
      );
      await assertAnchorError(
        program.methods
          .cancelRecovery({ expectedIdentitySequence: new BN(2) })
          .accountsStrict({
            config,
            identity: fixture.identity.address,
            recoveryRequest: requested.address,
            rootAuthority: fixture.identity.authority.publicKey,
          })
          .signers([fixture.identity.authority])
          .rpc(),
        "Unauthorized",
      );

      const cancelSignature = await program.methods
        .cancelRecovery({ expectedIdentitySequence: new BN(2) })
        .accountsStrict({
          config,
          identity: fixture.identity.address,
          recoveryRequest: requested.address,
          rootAuthority: ordinaryNewRoot.publicKey,
        })
        .signers([ordinaryNewRoot])
        .rpc();
      const cancelled = eventByName(
        await parsedEvents(context, cancelSignature),
        "recoveryCancelled",
      );
      assert.equal(cancelled.eventVersion, 1);
      assert.equal(
        (cancelled.cancelledByRootAuthority as web3.PublicKey).toBase58(),
        ordinaryNewRoot.publicKey.toBase58(),
      );
      assert.equal((cancelled.identitySequence as BN).toNumber(), 3);
      assert.equal((cancelled.rootRotationCount as BN).toNumber(), 1);

      const cancelledRequest =
        await program.account.recoveryRequest.fetch(requested.address);
      assert.deepEqual(cancelledRequest.state, { cancelled: {} });
      assert.notEqual(cancelledRequest.terminalAtSlot, null);
      await assertAnchorError(
        executeRecovery(
          context,
          fixture,
          requested.address,
          executor,
          recoveryTarget,
        ),
        "RecoveryRequestAlreadyTerminal",
      );
    });

    it("stales requests after policy sequence changes and rejects recovery PDA substitution", async () => {
      const fixture = await createRecoveryFixture(context, 5);
      const target = Keypair.generate();
      await configurePolicy(context, fixture);
      const requested = await requestRecovery(
        context,
        fixture,
        nonce(6),
        target.publicKey,
      );
      await configurePolicy(context, fixture, {
        expectedIdentitySequence: 1,
        expectedPolicySequence: 1,
        delaySlots: 3,
      });

      const secondGuardian = fixture.guardians[1];
      assert.ok(secondGuardian);
      await assertAnchorError(
        approveRecovery(context, fixture, requested.address, secondGuardian),
        "RecoveryRequestStalePolicy",
      );

      const substitutedFixture = await createRecoveryFixture(context, 15);
      await configurePolicy(context, substitutedFixture);
      const substitutedGuardian = substitutedFixture.guardians[1];
      assert.ok(substitutedGuardian);
      await assertAnchorError(
        program.methods
          .approveRecovery()
          .accountsStrict({
            config,
            identity: substitutedFixture.identity.address,
            recoveryPolicy: substitutedFixture.policy,
            recoveryRequest: requested.address,
            guardian: substitutedGuardian.publicKey,
          })
          .signers([substitutedGuardian])
          .rpc(),
        "ConstraintSeeds",
      );

      await program.methods
        .cancelRecovery({ expectedIdentitySequence: new BN(2) })
        .accountsStrict({
          config,
          identity: fixture.identity.address,
          recoveryRequest: requested.address,
          rootAuthority: fixture.identity.authority.publicKey,
        })
        .signers([fixture.identity.authority])
        .rpc();
      const terminal =
        await program.account.recoveryRequest.fetch(requested.address);
      assert.deepEqual(terminal.state, { cancelled: {} });
    });

    it("keeps every recovery instruction within account, packet, transaction, and compute ceilings", async () => {
      const executeFixture = await createRecoveryFixture(context, 25, 5);
      const newRoot = Keypair.generate();
      const executor = Keypair.generate();
      const requestNonce = nonce(26);
      const recoveryRequest = deriveRecoveryRequest(
        program.programId,
        executeFixture.identity.address,
        requestNonce,
      );
      const measurements: TransactionMeasurement[] = [];

      measurements.push(
        await measureAndSend(
          context,
          "configure recovery policy",
          () =>
            program.methods
              .configureRecoveryPolicy({
                expectedIdentitySequence: new BN(0),
                expectedPolicySequence: new BN(0),
                guardians: executeFixture.guardians.map(
                  ({ publicKey }) => publicKey,
                ),
                threshold: 3,
                delaySlots: new BN(2),
              })
              .accountsStrict({
                config,
                identity: executeFixture.identity.address,
                recoveryPolicy: executeFixture.policy,
                rootAuthority: executeFixture.identity.authority.publicKey,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [executeFixture.identity.authority],
        ),
      );
      const firstGuardian = executeFixture.guardians[0];
      const secondGuardian = executeFixture.guardians[1];
      const thirdGuardian = executeFixture.guardians[2];
      assert.ok(firstGuardian);
      assert.ok(secondGuardian);
      assert.ok(thirdGuardian);
      measurements.push(
        await measureAndSend(
          context,
          "request recovery",
          () =>
            program.methods
              .requestRecovery({
                requestNonce,
                expectedPolicySequence: new BN(1),
                expectedIdentitySequence: new BN(1),
                expectedRootRotationCount: new BN(0),
                targetRootAuthority: newRoot.publicKey,
              })
              .accountsStrict({
                config,
                identity: executeFixture.identity.address,
                recoveryPolicy: executeFixture.policy,
                recoveryRequest,
                guardian: firstGuardian.publicKey,
                payer: provider.wallet.publicKey,
                systemProgram: SystemProgram.programId,
              })
              .transaction(),
          [firstGuardian],
        ),
      );
      measurements.push(
        await measureAndSend(
          context,
          "approve recovery",
          () =>
            program.methods
              .approveRecovery()
              .accountsStrict({
                config,
                identity: executeFixture.identity.address,
                recoveryPolicy: executeFixture.policy,
                recoveryRequest,
                guardian: secondGuardian.publicKey,
              })
              .transaction(),
          [secondGuardian],
        ),
      );
      await approveRecovery(
        context,
        executeFixture,
        recoveryRequest,
        thirdGuardian,
      );
      const pending =
        await program.account.recoveryRequest.fetch(recoveryRequest);
      await waitUntilSlot(provider, pending.executeAfterSlot.toNumber());
      measurements.push(
        await measureAndSend(
          context,
          "execute recovery",
          () =>
            program.methods
              .executeRecovery()
              .accountsStrict({
                config,
                identity: executeFixture.identity.address,
                recoveryPolicy: executeFixture.policy,
                recoveryRequest,
                executor: executor.publicKey,
                newRootAuthority: newRoot.publicKey,
              })
              .transaction(),
          [executor, newRoot],
        ),
      );

      const cancelFixture = await createRecoveryFixture(context, 35, 2);
      await configurePolicy(context, cancelFixture);
      const cancelTarget = Keypair.generate();
      const cancelRequest = await requestRecovery(
        context,
        cancelFixture,
        nonce(36),
        cancelTarget.publicKey,
      );
      measurements.push(
        await measureAndSend(
          context,
          "cancel recovery",
          () =>
            program.methods
              .cancelRecovery({ expectedIdentitySequence: new BN(1) })
              .accountsStrict({
                config,
                identity: cancelFixture.identity.address,
                recoveryRequest: cancelRequest.address,
                rootAuthority: cancelFixture.identity.authority.publicKey,
              })
              .transaction(),
          [cancelFixture.identity.authority],
        ),
      );

      const disableFixture = await createRecoveryFixture(context, 45, 2);
      await configurePolicy(context, disableFixture);
      measurements.push(
        await measureAndSend(
          context,
          "disable recovery policy",
          () =>
            program.methods
              .disableRecoveryPolicy({
                expectedIdentitySequence: new BN(1),
                expectedPolicySequence: new BN(1),
              })
              .accountsStrict({
                config,
                identity: disableFixture.identity.address,
                recoveryPolicy: disableFixture.policy,
                rootAuthority: disableFixture.identity.authority.publicKey,
              })
              .transaction(),
          [disableFixture.identity.authority],
        ),
      );

      const [policyRent, requestRent] = await Promise.all([
        assertRentExemptAccount(
          context,
          executeFixture.policy,
          "recovery policy",
          RECOVERY_POLICY_SPACE,
        ),
        assertRentExemptAccount(
          context,
          recoveryRequest,
          "recovery request",
          RECOVERY_REQUEST_SPACE,
        ),
      ]);
      assert.deepEqual(
        measurements.map(({ label }) => label),
        [
          "configure recovery policy",
          "request recovery",
          "approve recovery",
          "execute recovery",
          "cancel recovery",
          "disable recovery policy",
        ],
      );
      process.stdout.write(
        `\nrecovery-transaction-cost-evidence ${JSON.stringify({
          measurements,
          rentEvidence: [policyRent, requestRent],
        })}\n`,
      );
    });
  });
}
