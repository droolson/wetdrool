import { strict as assert } from "node:assert";

import { BN, web3 } from "@coral-xyz/anchor";
import { describe, it } from "mocha";

import {
  assertAnchorError,
  assertRentExemptAccount,
  createIdentity,
  digest,
  manifestUri,
  measureAndSend,
  nonce,
  type IdentityFixture,
  type Phase2Context,
  type TransactionMeasurement,
} from "./phase2_test_helpers";
import { parsedEvents } from "./governance_test_helpers";
import {
  PAYMENT_CONFIG_SPACE,
  balanceAt,
  derivePaymentConfig,
  derivePaymentReceipt,
  deriveProgramData,
  deriveSubscriptionOffering,
  fundSystemAccounts,
  readBalances,
} from "./payment_test_helpers";

const { Keypair, SystemProgram } = web3;

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  return value as UnknownRecord;
}

function eventByName(
  events: { data: unknown; name: string }[],
  expectedName: string,
): UnknownRecord {
  const matching = events.filter(({ name }) => name === expectedName);
  assert.equal(matching.length, 1, `expected one ${expectedName} event`);
  return record(matching[0]?.data);
}

function publicKeyString(value: unknown): string {
  assert.ok(value instanceof web3.PublicKey);
  return value.toBase58();
}

function bnNumber(value: unknown): number {
  assert.ok(value instanceof BN);
  return (value as BN).toNumber();
}

function assertBalanceDelta(
  before: Map<string, number>,
  after: Map<string, number>,
  address: web3.PublicKey,
  expectedDelta: number,
): void {
  assert.equal(
    balanceAt(after, address) - balanceAt(before, address),
    expectedDelta,
    `unexpected balance delta for ${address.toBase58()}`,
  );
}

function assertBalancesUnchanged(
  before: Map<string, number>,
  after: Map<string, number>,
  addresses: web3.PublicKey[],
): void {
  for (const address of addresses) {
    assertBalanceDelta(before, after, address, 0);
  }
}

export function registerPaymentTests(context: Phase2Context): void {
  describe("quarantined legacy lamport payment ABI", () => {
    const { config, program, provider } = context;
    const paymentConfig = derivePaymentConfig(program.programId);
    const programData = deriveProgramData(program.programId);
    const paymentAuthority = Keypair.generate();
    const rotatedPaymentAuthority = Keypair.generate();
    const attacker = Keypair.generate();
    const feeDestination = Keypair.generate();
    const maintenanceFeeDestination = Keypair.generate();
    const feeBps = 250;
    const maintenanceFeeBps = 300;
    const grossLamports = 100_003;
    const measurements: TransactionMeasurement[] = [];
    const rentEvidence: {
      label: string;
      minimumRentLamports: number;
      space: number;
    }[] = [];

    let payer: IdentityFixture;
    let creator: IdentityFixture;

    it("bootstraps only from the deployed upgrade authority and starts disabled", async () => {
      await fundSystemAccounts(context, [
        { address: feeDestination.publicKey, lamports: 1_000_000 },
        { address: maintenanceFeeDestination.publicKey, lamports: 1_000_000 },
        { address: paymentAuthority.publicKey, lamports: 1_000_000 },
        { address: rotatedPaymentAuthority.publicKey, lamports: 1_000_000 },
        { address: attacker.publicKey, lamports: 1_000_000 },
      ]);

      await assertAnchorError(
        program.methods
          .initializePaymentConfig({ feeBps })
          .accountsStrict({
            config,
            paymentConfig,
            socialProtocolProgram: program.programId,
            programData,
            upgradeAuthority: attacker.publicKey,
            paymentAuthority: paymentAuthority.publicKey,
            feeDestination: feeDestination.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([attacker, paymentAuthority])
          .rpc(),
        "UnauthorizedPaymentBootstrap",
      );
      assert.equal(
        await provider.connection.getAccountInfo(paymentConfig, "confirmed"),
        null,
      );

      const initialized = await measureAndSend(
        context,
        "initialize disabled legacy payment config",
        () =>
          program.methods
            .initializePaymentConfig({ feeBps })
            .accountsStrict({
              config,
              paymentConfig,
              socialProtocolProgram: program.programId,
              programData,
              upgradeAuthority: provider.wallet.publicKey,
              paymentAuthority: paymentAuthority.publicKey,
              feeDestination: feeDestination.publicKey,
              payer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
            })
            .transaction(),
        [paymentAuthority],
      );
      measurements.push(initialized);

      const initializedEvent = eventByName(
        await parsedEvents(context, initialized.signature),
        "paymentConfigInitialized",
      );
      assert.equal(initializedEvent.eventVersion, 1);
      assert.equal(
        publicKeyString(initializedEvent.paymentConfig),
        paymentConfig.toBase58(),
      );
      assert.equal(
        publicKeyString(initializedEvent.upgradeAuthority),
        provider.wallet.publicKey.toBase58(),
      );
      assert.equal(
        publicKeyString(initializedEvent.paymentAuthority),
        paymentAuthority.publicKey.toBase58(),
      );
      assert.equal(initializedEvent.feeBps, feeBps);
      assert.equal(bnNumber(initializedEvent.policySequence), 1);
      assert.equal(initializedEvent.enabled, false);

      const state = await program.account.paymentConfig.fetch(paymentConfig);
      assert.equal(state.version, 1);
      assert.equal(state.authority.toBase58(), paymentAuthority.publicKey.toBase58());
      assert.equal(
        state.feeDestination.toBase58(),
        feeDestination.publicKey.toBase58(),
      );
      assert.equal(state.feeBps, feeBps);
      assert.equal(state.policySequence.toNumber(), 1);
      assert.equal(state.enabled, false);
      rentEvidence.push(
        await assertRentExemptAccount(
          context,
          paymentConfig,
          "disabled legacy payment config",
          PAYMENT_CONFIG_SPACE,
        ),
      );
    });

    it("rejects legacy tip and offering instructions without moving value or creating state", async () => {
      payer = await createIdentity(context, 23);
      creator = await createIdentity(context, 43);
      await fundSystemAccounts(context, [
        {
          address: payer.authority.publicKey,
          lamports: 5 * web3.LAMPORTS_PER_SOL,
        },
        { address: creator.authority.publicKey, lamports: 1_000_000 },
      ]);

      const tracked = [
        payer.authority.publicKey,
        creator.authority.publicKey,
        feeDestination.publicKey,
        paymentConfig,
      ];
      const tipReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        nonce(81),
      );
      const beforeTip = await readBalances(context, tracked);
      await assertAnchorError(
        program.methods
          .sendWokeTip({
            receiptNonce: nonce(81),
            expectedPaymentPolicySequence: new BN(1),
            expectedFeeBps: feeBps,
            expectedFeeDestination: feeDestination.publicKey,
            expectedPayerRootRotationCount: new BN(0),
            expectedRecipientIdentity: creator.address,
            expectedRecipientDestination: creator.authority.publicKey,
            grossLamports: new BN(grossLamports),
          })
          .accountsStrict({
            config,
            paymentConfig,
            payerIdentity: payer.address,
            recipientIdentity: creator.address,
            receipt: tipReceipt,
            payerAuthority: payer.authority.publicKey,
            recipientDestination: creator.authority.publicKey,
            feeDestination: feeDestination.publicKey,
            rentPayer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer.authority])
          .rpc(),
        "PaymentsDisabled",
      );
      const afterTip = await readBalances(context, tracked);
      assertBalancesUnchanged(beforeTip, afterTip, tracked);
      assert.equal(
        await provider.connection.getAccountInfo(tipReceipt, "confirmed"),
        null,
      );

      const offeringNonce = nonce(41);
      const offering = deriveSubscriptionOffering(
        program.programId,
        creator.address,
        offeringNonce,
      );
      const beforeOffering = await readBalances(context, tracked);
      await assertAnchorError(
        program.methods
          .createSubscriptionOffering({
            expectedCreatorSequence: new BN(0),
            offeringNonce,
            manifestHash: digest("quarantined-payment-offering"),
            manifestUri: manifestUri("quarantined-payment-offering"),
            priceLamports: new BN(grossLamports),
            refundPolicyHash: digest("quarantined-payment-refund-policy"),
            maxProtocolFeeBps: 500,
            creatorBasisPoints: 10_000,
            additionalRecipientBasisPoints: [],
          })
          .accountsStrict({
            config,
            paymentConfig,
            creatorIdentity: creator.address,
            offering,
            rootAuthority: creator.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            recipientIdentity0: null,
            recipientDestination0: null,
            recipientIdentity1: null,
            recipientDestination1: null,
          })
          .signers([creator.authority])
          .rpc(),
        "PaymentsDisabled",
      );
      const afterOffering = await readBalances(context, tracked);
      assertBalancesUnchanged(beforeOffering, afterOffering, tracked);
      assert.equal(
        await provider.connection.getAccountInfo(offering, "confirmed"),
        null,
      );
    });

    it("rotates the policy authority without enabling the legacy ABI", async () => {
      await assertAnchorError(
        program.methods
          .rotatePaymentAuthority({
            expectedPolicySequence: new BN(1),
          })
          .accountsStrict({
            config,
            paymentConfig,
            currentAuthority: attacker.publicKey,
            newAuthority: rotatedPaymentAuthority.publicKey,
          })
          .signers([attacker, rotatedPaymentAuthority])
          .rpc(),
        "UnauthorizedPaymentConfig",
      );

      const rotated = await measureAndSend(
        context,
        "rotate disabled legacy payment authority",
        () =>
          program.methods
            .rotatePaymentAuthority({
              expectedPolicySequence: new BN(1),
            })
            .accountsStrict({
              config,
              paymentConfig,
              currentAuthority: paymentAuthority.publicKey,
              newAuthority: rotatedPaymentAuthority.publicKey,
            })
            .transaction(),
        [paymentAuthority, rotatedPaymentAuthority],
      );
      measurements.push(rotated);

      const rotatedEvent = eventByName(
        await parsedEvents(context, rotated.signature),
        "paymentAuthorityRotated",
      );
      assert.equal(
        publicKeyString(rotatedEvent.previousAuthority),
        paymentAuthority.publicKey.toBase58(),
      );
      assert.equal(
        publicKeyString(rotatedEvent.newAuthority),
        rotatedPaymentAuthority.publicKey.toBase58(),
      );
      assert.equal(bnNumber(rotatedEvent.policySequence), 2);

      const state = await program.account.paymentConfig.fetch(paymentConfig);
      assert.equal(
        state.authority.toBase58(),
        rotatedPaymentAuthority.publicKey.toBase58(),
      );
      assert.equal(state.policySequence.toNumber(), 2);
      assert.equal(state.enabled, false);

      await assertAnchorError(
        program.methods
          .updatePaymentConfig({
            expectedPolicySequence: new BN(2),
            feeBps,
            enabled: true,
          })
          .accountsStrict({
            config,
            paymentConfig,
            authority: paymentAuthority.publicKey,
            feeDestination: feeDestination.publicKey,
          })
          .signers([paymentAuthority])
          .rpc(),
        "UnauthorizedPaymentConfig",
      );
    });

    it("rejects unpausing and leaves policy, receipts, and value unchanged", async () => {
      const tracked = [
        payer.authority.publicKey,
        creator.authority.publicKey,
        feeDestination.publicKey,
        maintenanceFeeDestination.publicKey,
        paymentConfig,
      ];
      const balancesBeforeUnpause = await readBalances(context, tracked);
      const stateBeforeUnpause =
        await program.account.paymentConfig.fetch(paymentConfig);

      await assertAnchorError(
        program.methods
          .updatePaymentConfig({
            expectedPolicySequence: new BN(2),
            feeBps,
            enabled: true,
          })
          .accountsStrict({
            config,
            paymentConfig,
            authority: rotatedPaymentAuthority.publicKey,
            feeDestination: feeDestination.publicKey,
          })
          .signers([rotatedPaymentAuthority])
          .rpc(),
        "PaymentsDisabled",
      );

      const balancesAfterUnpause = await readBalances(context, tracked);
      assertBalancesUnchanged(
        balancesBeforeUnpause,
        balancesAfterUnpause,
        tracked,
      );
      const stateAfterUnpause =
        await program.account.paymentConfig.fetch(paymentConfig);
      assert.equal(stateAfterUnpause.enabled, false);
      assert.equal(
        stateAfterUnpause.authority.toBase58(),
        stateBeforeUnpause.authority.toBase58(),
      );
      assert.equal(
        stateAfterUnpause.feeDestination.toBase58(),
        stateBeforeUnpause.feeDestination.toBase58(),
      );
      assert.equal(stateAfterUnpause.feeBps, stateBeforeUnpause.feeBps);
      assert.equal(
        stateAfterUnpause.policySequence.toString(),
        stateBeforeUnpause.policySequence.toString(),
      );
      assert.equal(
        stateAfterUnpause.updatedAtSlot.toString(),
        stateBeforeUnpause.updatedAtSlot.toString(),
      );

      const receiptNonce = nonce(101);
      const receipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        receiptNonce,
      );
      const balancesBeforeTip = await readBalances(context, tracked);
      await assertAnchorError(
        program.methods
          .sendWokeTip({
            receiptNonce,
            expectedPaymentPolicySequence: new BN(2),
            expectedFeeBps: feeBps,
            expectedFeeDestination: feeDestination.publicKey,
            expectedPayerRootRotationCount: new BN(0),
            expectedRecipientIdentity: creator.address,
            expectedRecipientDestination: creator.authority.publicKey,
            grossLamports: new BN(grossLamports),
          })
          .accountsStrict({
            config,
            paymentConfig,
            payerIdentity: payer.address,
            recipientIdentity: creator.address,
            receipt,
            payerAuthority: payer.authority.publicKey,
            recipientDestination: creator.authority.publicKey,
            feeDestination: feeDestination.publicKey,
            rentPayer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer.authority])
          .rpc(),
        "PaymentsDisabled",
      );
      const balancesAfterTip = await readBalances(context, tracked);
      assertBalancesUnchanged(balancesBeforeTip, balancesAfterTip, tracked);
      assert.equal(
        await provider.connection.getAccountInfo(receipt, "confirmed"),
        null,
      );
    });

    it("permits disabled policy maintenance with compare-and-swap semantics", async () => {
      const tracked = [
        feeDestination.publicKey,
        maintenanceFeeDestination.publicKey,
        paymentConfig,
      ];
      const balancesBefore = await readBalances(context, tracked);
      const maintained = await measureAndSend(
        context,
        "maintain disabled legacy payment config",
        () =>
          program.methods
            .updatePaymentConfig({
              expectedPolicySequence: new BN(2),
              feeBps: maintenanceFeeBps,
              enabled: false,
            })
            .accountsStrict({
              config,
              paymentConfig,
              authority: rotatedPaymentAuthority.publicKey,
              feeDestination: maintenanceFeeDestination.publicKey,
            })
            .transaction(),
        [rotatedPaymentAuthority],
      );
      measurements.push(maintained);
      const balancesAfter = await readBalances(context, tracked);
      assertBalancesUnchanged(balancesBefore, balancesAfter, tracked);

      const updatedEvent = eventByName(
        await parsedEvents(context, maintained.signature),
        "paymentConfigUpdated",
      );
      assert.equal(
        publicKeyString(updatedEvent.authority),
        rotatedPaymentAuthority.publicKey.toBase58(),
      );
      assert.equal(updatedEvent.previousEnabled, false);
      assert.equal(updatedEvent.enabled, false);
      assert.equal(updatedEvent.feeBps, maintenanceFeeBps);
      assert.equal(bnNumber(updatedEvent.policySequence), 3);

      const state = await program.account.paymentConfig.fetch(paymentConfig);
      assert.equal(state.enabled, false);
      assert.equal(state.feeBps, maintenanceFeeBps);
      assert.equal(
        state.feeDestination.toBase58(),
        maintenanceFeeDestination.publicKey.toBase58(),
      );
      assert.equal(state.policySequence.toNumber(), 3);

      await assertAnchorError(
        program.methods
          .updatePaymentConfig({
            expectedPolicySequence: new BN(2),
            feeBps: maintenanceFeeBps + 1,
            enabled: false,
          })
          .accountsStrict({
            config,
            paymentConfig,
            authority: rotatedPaymentAuthority.publicKey,
            feeDestination: maintenanceFeeDestination.publicKey,
          })
          .signers([rotatedPaymentAuthority])
          .rpc(),
        "PaymentPolicySequenceMismatch",
      );
      const stateAfterStaleUpdate =
        await program.account.paymentConfig.fetch(paymentConfig);
      assert.equal(stateAfterStaleUpdate.enabled, false);
      assert.equal(stateAfterStaleUpdate.feeBps, maintenanceFeeBps);
      assert.equal(stateAfterStaleUpdate.policySequence.toNumber(), 3);
    });

    it("records cost evidence only for non-value-moving control-plane operations", async () => {
      assert.deepEqual(
        measurements.map(({ label }) => label).sort(),
        [
          "initialize disabled legacy payment config",
          "maintain disabled legacy payment config",
          "rotate disabled legacy payment authority",
        ],
      );
      assert.equal(measurements.length, 3);
      assert.ok(
        measurements.every(
          ({ computeUnits, transactionBytes }) =>
            computeUnits > 0 &&
            computeUnits <= 150_000 &&
            transactionBytes > 0 &&
            transactionBytes <= 1_100,
        ),
      );
      assert.deepEqual(rentEvidence.map(({ space }) => space), [
        PAYMENT_CONFIG_SPACE,
      ]);
      process.stdout.write(
        `\nlegacy-payment-quarantine-evidence ${JSON.stringify({
          measurements,
          rentEvidence,
        })}\n`,
      );
    });
  });
}
