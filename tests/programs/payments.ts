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
  PAYMENT_RECEIPT_SPACE,
  SUBSCRIPTION_ENTITLEMENT_SPACE,
  SUBSCRIPTION_OFFERING_SPACE,
  WEEK_SECONDS,
  balanceAt,
  calculateNativeAllocation,
  derivePaymentConfig,
  derivePaymentReceipt,
  deriveProgramData,
  deriveSubscriptionEntitlement,
  deriveSubscriptionOffering,
  fundSystemAccounts,
  readBalances,
  type PaymentSplitFixture,
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

function bnNumbers(value: unknown): number[] {
  assert.ok(Array.isArray(value));
  return value.map((entry) => bnNumber(entry));
}

function bigintAt(values: bigint[], index: number): bigint {
  const value = values[index];
  assert.notEqual(value, undefined, `missing bigint at index ${index}`);
  return value ?? 0n;
}

function bytes(value: unknown): number[] {
  assert.ok(Array.isArray(value) || Buffer.isBuffer(value));
  return Array.from(value as number[] | Buffer);
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
  describe("native WOKE tips and weekly subscriptions", () => {
    const { config, program, provider } = context;
    const paymentConfig = derivePaymentConfig(program.programId);
    const programData = deriveProgramData(program.programId);
    const paymentAuthority = Keypair.generate();
    const rotatedPaymentAuthority = Keypair.generate();
    const attacker = Keypair.generate();
    const feeDestination = Keypair.generate();
    const rotatedCreatorAuthority = Keypair.generate();
    const feeBps = 250;
    const grossLamports = 100_003;
    const offeringManifestHash = digest("payment-weekly-offering-v1");
    const offeringRefundPolicyHash = digest("payment-refund-policy-v1");
    const offeringNonce = nonce(41);
    const secondOfferingNonce = nonce(61);
    const tipReceiptNonce = nonce(81);
    const subscriptionReceiptNonce = nonce(101);
    const renewalReceiptNonce = nonce(121);
    const measurements: TransactionMeasurement[] = [];
    const rentEvidence: {
      label: string;
      minimumRentLamports: number;
      space: number;
    }[] = [];

    let payer: IdentityFixture;
    let creator: IdentityFixture;
    let additionalRecipient0: IdentityFixture;
    let additionalRecipient1: IdentityFixture;
    let substituteRecipient: IdentityFixture;
    let primaryOffering: web3.PublicKey;
    let secondaryOffering: web3.PublicKey;
    let entitlement: web3.PublicKey;
    let tipReceipt: web3.PublicKey;
    let firstSubscriptionReceipt: web3.PublicKey;
    let orderedSplits: PaymentSplitFixture[];

    it("bootstraps only from the deployed upgrade authority and starts disabled", async () => {
      await fundSystemAccounts(context, [
        { address: feeDestination.publicKey, lamports: 1_000_000 },
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
        "initialize payment config",
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
          "payment config",
          PAYMENT_CONFIG_SPACE,
        ),
      );
    });

    it("rejects native payment while disabled without moving value", async () => {
      payer = await createIdentity(context, 23);
      creator = await createIdentity(context, 43);
      additionalRecipient0 = await createIdentity(context, 63);
      additionalRecipient1 = await createIdentity(context, 83);
      substituteRecipient = await createIdentity(context, 103);
      await fundSystemAccounts(context, [
        {
          address: payer.authority.publicKey,
          lamports: 5 * web3.LAMPORTS_PER_SOL,
        },
        { address: creator.authority.publicKey, lamports: 1_000_000 },
        {
          address: additionalRecipient0.authority.publicKey,
          lamports: 1_000_000,
        },
        {
          address: additionalRecipient1.authority.publicKey,
          lamports: 1_000_000,
        },
        {
          address: substituteRecipient.authority.publicKey,
          lamports: 1_000_000,
        },
        { address: rotatedCreatorAuthority.publicKey, lamports: 1_000_000 },
      ]);

      tipReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        tipReceiptNonce,
      );
      const tracked = [
        payer.authority.publicKey,
        creator.authority.publicKey,
        feeDestination.publicKey,
      ];
      const before = await readBalances(context, tracked);
      await assertAnchorError(
        program.methods
          .sendWokeTip({
            receiptNonce: tipReceiptNonce,
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
      const after = await readBalances(context, tracked);
      assertBalancesUnchanged(before, after, tracked);
      assert.equal(
        await provider.connection.getAccountInfo(tipReceipt, "confirmed"),
        null,
      );
    });

    it("rotates payment policy authority with both authorities signing", async () => {
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
        "rotate payment authority",
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

    it("enables payment settlement with compare-and-swap policy state", async () => {
      const enabled = await measureAndSend(
        context,
        "update payment config",
        () =>
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
            .transaction(),
        [rotatedPaymentAuthority],
      );
      measurements.push(enabled);

      const updatedEvent = eventByName(
        await parsedEvents(context, enabled.signature),
        "paymentConfigUpdated",
      );
      assert.equal(
        publicKeyString(updatedEvent.authority),
        rotatedPaymentAuthority.publicKey.toBase58(),
      );
      assert.equal(updatedEvent.previousEnabled, false);
      assert.equal(updatedEvent.enabled, true);
      assert.equal(updatedEvent.feeBps, feeBps);
      assert.equal(bnNumber(updatedEvent.policySequence), 3);

      const state = await program.account.paymentConfig.fetch(paymentConfig);
      assert.equal(state.enabled, true);
      assert.equal(state.policySequence.toNumber(), 3);

      await assertAnchorError(
        program.methods
          .updatePaymentConfig({
            expectedPolicySequence: new BN(2),
            feeBps,
            enabled: false,
          })
          .accountsStrict({
            config,
            paymentConfig,
            authority: rotatedPaymentAuthority.publicKey,
            feeDestination: feeDestination.publicKey,
          })
          .signers([rotatedPaymentAuthority])
          .rpc(),
        "PaymentPolicySequenceMismatch",
      );
    });

    it("rejects aliased or substituted tip recipients and settles exact WOKE", async () => {
      const aliasNonce = nonce(141);
      const aliasReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        aliasNonce,
      );
      const substitutionNonce = nonce(161);
      const substitutionReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        substitutionNonce,
      );
      const tracked = [
        payer.authority.publicKey,
        creator.authority.publicKey,
        substituteRecipient.authority.publicKey,
        feeDestination.publicKey,
      ];
      const beforeFailures = await readBalances(context, tracked);

      await assertAnchorError(
        program.methods
          .sendWokeTip({
            receiptNonce: aliasNonce,
            expectedPaymentPolicySequence: new BN(3),
            expectedFeeBps: feeBps,
            expectedFeeDestination: feeDestination.publicKey,
            expectedPayerRootRotationCount: new BN(0),
            expectedRecipientIdentity: payer.address,
            expectedRecipientDestination: payer.authority.publicKey,
            grossLamports: new BN(grossLamports),
          })
          .accountsStrict({
            config,
            paymentConfig,
            payerIdentity: payer.address,
            recipientIdentity: payer.address,
            receipt: aliasReceipt,
            payerAuthority: payer.authority.publicKey,
            recipientDestination: payer.authority.publicKey,
            feeDestination: feeDestination.publicKey,
            rentPayer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer.authority])
          .rpc(),
        "PaymentDestinationAlias",
      );

      await assertAnchorError(
        program.methods
          .sendWokeTip({
            receiptNonce: substitutionNonce,
            expectedPaymentPolicySequence: new BN(3),
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
            recipientIdentity: substituteRecipient.address,
            receipt: substitutionReceipt,
            payerAuthority: payer.authority.publicKey,
            recipientDestination: substituteRecipient.authority.publicKey,
            feeDestination: feeDestination.publicKey,
            rentPayer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .signers([payer.authority])
          .rpc(),
        "PaymentRecipientSubstitution",
      );
      const afterFailures = await readBalances(context, tracked);
      assertBalancesUnchanged(beforeFailures, afterFailures, tracked);
      assert.equal(
        await provider.connection.getAccountInfo(aliasReceipt, "confirmed"),
        null,
      );
      assert.equal(
        await provider.connection.getAccountInfo(
          substitutionReceipt,
          "confirmed",
        ),
        null,
      );

      const before = await readBalances(context, tracked);
      const settled = await measureAndSend(
        context,
        "send WOKE tip",
        () =>
          program.methods
            .sendWokeTip({
              receiptNonce: tipReceiptNonce,
              expectedPaymentPolicySequence: new BN(3),
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
            .transaction(),
        [payer.authority],
      );
      measurements.push(settled);
      const after = await readBalances(context, tracked);
      const allocation = calculateNativeAllocation(BigInt(grossLamports), feeBps, [
        {
          identity: creator.address,
          destination: creator.authority.publicKey,
          basisPoints: 10_000,
        },
      ]);
      assertBalanceDelta(
        before,
        after,
        payer.authority.publicKey,
        -grossLamports,
      );
      assertBalanceDelta(
        before,
        after,
        feeDestination.publicKey,
        Number(allocation.feeLamports),
      );
      assertBalanceDelta(
        before,
        after,
        creator.authority.publicKey,
        Number(bigintAt(allocation.recipientAmounts, 0)),
      );
      assertBalanceDelta(
        before,
        after,
        substituteRecipient.authority.publicKey,
        0,
      );

      const settledEvent = eventByName(
        await parsedEvents(context, settled.signature),
        "wokeTipSettled",
      );
      assert.equal(
        publicKeyString(settledEvent.receipt),
        tipReceipt.toBase58(),
      );
      assert.equal(
        publicKeyString(settledEvent.recipientIdentity),
        creator.address.toBase58(),
      );
      assert.deepEqual(settledEvent.paymentKind, { wokeTip: {} });
      assert.equal(bnNumber(settledEvent.grossLamports), grossLamports);
      assert.equal(
        bnNumber(settledEvent.feeLamports),
        Number(allocation.feeLamports),
      );
      assert.equal(
        bnNumber(settledEvent.distributableLamports),
        Number(allocation.distributableLamports),
      );
      assert.equal(
        bnNumber(settledEvent.recipientLamports),
        Number(bigintAt(allocation.recipientAmounts, 0)),
      );

      const receipt = await program.account.paymentReceipt.fetch(tipReceipt);
      assert.deepEqual(receipt.kind, { wokeTip: {} });
      assert.equal(receipt.grossLamports.toNumber(), grossLamports);
      assert.equal(receipt.feeLamports.toNumber(), Number(allocation.feeLamports));
      assert.equal(
        receipt.distributableLamports.toNumber(),
        Number(allocation.distributableLamports),
      );
      assert.deepEqual(receipt.recipientAmounts.map((amount) => amount.toNumber()), [
        Number(bigintAt(allocation.recipientAmounts, 0)),
      ]);
      rentEvidence.push(
        await assertRentExemptAccount(
          context,
          tipReceipt,
          "WOKE tip receipt",
          PAYMENT_RECEIPT_SPACE,
        ),
      );

      const beforeReplay = await readBalances(context, tracked);
      await assertAnchorError(
        program.methods
          .sendWokeTip({
            receiptNonce: tipReceiptNonce,
            expectedPaymentPolicySequence: new BN(3),
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
        "PaymentReceiptAlreadyExists",
      );
      const afterReplay = await readBalances(context, tracked);
      assertBalancesUnchanged(beforeReplay, afterReplay, tracked);
    });

    it("commits immutable canonical weekly terms and rejects malformed creation", async () => {
      primaryOffering = deriveSubscriptionOffering(
        program.programId,
        creator.address,
        offeringNonce,
      );
      const splitFixtures: PaymentSplitFixture[] = [
        {
          identity: creator.address,
          destination: creator.authority.publicKey,
          basisPoints: 5_000,
        },
        {
          identity: additionalRecipient0.address,
          destination: additionalRecipient0.authority.publicKey,
          basisPoints: 3_000,
        },
        {
          identity: additionalRecipient1.address,
          destination: additionalRecipient1.authority.publicKey,
          basisPoints: 2_000,
        },
      ];
      orderedSplits = calculateNativeAllocation(
        BigInt(grossLamports),
        feeBps,
        splitFixtures,
      ).orderedSplits;

      await assertAnchorError(
        program.methods
          .createSubscriptionOffering({
            expectedCreatorSequence: new BN(0),
            offeringNonce,
            manifestHash: offeringManifestHash,
            manifestUri: manifestUri("payment-weekly-offering-v1"),
            priceLamports: new BN(grossLamports),
            refundPolicyHash: offeringRefundPolicyHash,
            maxProtocolFeeBps: 500,
            creatorBasisPoints: 5_000,
            additionalRecipientBasisPoints: [3_000, 2_000],
          })
          .accountsStrict({
            config,
            paymentConfig,
            creatorIdentity: creator.address,
            offering: primaryOffering,
            rootAuthority: attacker.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            recipientIdentity0: additionalRecipient0.address,
            recipientDestination0: additionalRecipient0.authority.publicKey,
            recipientIdentity1: additionalRecipient1.address,
            recipientDestination1: additionalRecipient1.authority.publicKey,
          })
          .signers([attacker])
          .rpc(),
        "Unauthorized",
      );
      assert.equal(
        await provider.connection.getAccountInfo(primaryOffering, "confirmed"),
        null,
      );

      await assertAnchorError(
        program.methods
          .createSubscriptionOffering({
            expectedCreatorSequence: new BN(0),
            offeringNonce,
            manifestHash: offeringManifestHash,
            manifestUri: manifestUri("payment-weekly-offering-v1"),
            priceLamports: new BN(grossLamports),
            refundPolicyHash: offeringRefundPolicyHash,
            maxProtocolFeeBps: 500,
            creatorBasisPoints: 5_000,
            additionalRecipientBasisPoints: [3_000, 1_999],
          })
          .accountsStrict({
            config,
            paymentConfig,
            creatorIdentity: creator.address,
            offering: primaryOffering,
            rootAuthority: creator.authority.publicKey,
            payer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            recipientIdentity0: additionalRecipient0.address,
            recipientDestination0: additionalRecipient0.authority.publicKey,
            recipientIdentity1: additionalRecipient1.address,
            recipientDestination1: additionalRecipient1.authority.publicKey,
          })
          .signers([creator.authority])
          .rpc(),
        "InvalidPaymentSplits",
      );
      assert.equal(
        await provider.connection.getAccountInfo(primaryOffering, "confirmed"),
        null,
      );

      const created = await measureAndSend(
        context,
        "create subscription offering",
        () =>
          program.methods
            .createSubscriptionOffering({
              expectedCreatorSequence: new BN(0),
              offeringNonce,
              manifestHash: offeringManifestHash,
              manifestUri: manifestUri("payment-weekly-offering-v1"),
              priceLamports: new BN(grossLamports),
              refundPolicyHash: offeringRefundPolicyHash,
              maxProtocolFeeBps: 500,
              creatorBasisPoints: 5_000,
              additionalRecipientBasisPoints: [3_000, 2_000],
            })
            .accountsStrict({
              config,
              paymentConfig,
              creatorIdentity: creator.address,
              offering: primaryOffering,
              rootAuthority: creator.authority.publicKey,
              payer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
              recipientIdentity0: additionalRecipient0.address,
              recipientDestination0: additionalRecipient0.authority.publicKey,
              recipientIdentity1: additionalRecipient1.address,
              recipientDestination1: additionalRecipient1.authority.publicKey,
            })
            .transaction(),
        [creator.authority],
      );
      measurements.push(created);

      const createdEvent = eventByName(
        await parsedEvents(context, created.signature),
        "subscriptionOfferingCreated",
      );
      assert.equal(
        publicKeyString(createdEvent.offering),
        primaryOffering.toBase58(),
      );
      assert.deepEqual(bytes(createdEvent.offeringNonce), offeringNonce);
      assert.deepEqual(bytes(createdEvent.manifestHash), offeringManifestHash);
      assert.deepEqual(
        bytes(createdEvent.refundPolicyHash),
        offeringRefundPolicyHash,
      );
      assert.deepEqual(createdEvent.billingInterval, { week: {} });
      assert.equal(bnNumber(createdEvent.priceLamports), grossLamports);
      assert.equal(bnNumber(createdEvent.creatorSequence), 1);
      assert.equal(bnNumber(createdEvent.offeringStateSequence), 1);
      assert.ok(Array.isArray(createdEvent.recipientSplits));
      const createdSplits = createdEvent.recipientSplits.map((value) =>
        record(value),
      );
      assert.deepEqual(
        createdSplits.map((split) => publicKeyString(split.recipientIdentity)),
        orderedSplits.map((split) => split.identity.toBase58()),
      );
      assert.deepEqual(
        createdSplits.map((split) => split.basisPoints),
        orderedSplits.map((split) => split.basisPoints),
      );

      const state =
        await program.account.creatorSubscriptionOffering.fetch(primaryOffering);
      assert.equal(state.active, true);
      assert.equal(state.retiredAtSlot, null);
      assert.deepEqual(state.billingInterval, { week: {} });
      assert.deepEqual(Array.from(state.manifestHash), offeringManifestHash);
      assert.deepEqual(
        Array.from(state.refundPolicyHash),
        offeringRefundPolicyHash,
      );
      assert.equal(state.priceLamports.toNumber(), grossLamports);
      assert.equal(state.creatorRootRotationCount.toNumber(), 0);
      assert.equal(state.creatorSequence.toNumber(), 1);
      assert.equal(state.stateSequence.toNumber(), 1);
      assert.deepEqual(
        state.recipientSplits.map((split) =>
          split.recipientIdentity.toBase58(),
        ),
        orderedSplits.map((split) => split.identity.toBase58()),
      );
      rentEvidence.push(
        await assertRentExemptAccount(
          context,
          primaryOffering,
          "creator subscription offering",
          SUBSCRIPTION_OFFERING_SPACE,
        ),
      );
    });

    it("settles a three-way weekly subscription with exact conservation", async () => {
      firstSubscriptionReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        subscriptionReceiptNonce,
      );
      entitlement = deriveSubscriptionEntitlement(
        program.programId,
        primaryOffering,
        payer.address,
      );
      const tracked = [
        payer.authority.publicKey,
        feeDestination.publicKey,
        creator.authority.publicKey,
        additionalRecipient0.authority.publicKey,
        additionalRecipient1.authority.publicKey,
      ];
      const before = await readBalances(context, tracked);
      const settled = await measureAndSend(
        context,
        "settle subscription",
        () =>
          program.methods
            .settleSubscription({
              receiptNonce: subscriptionReceiptNonce,
              expectedPaymentPolicySequence: new BN(3),
              expectedFeeBps: feeBps,
              expectedFeeDestination: feeDestination.publicKey,
              expectedPayerRootRotationCount: new BN(0),
              expectedOfferingStateSequence: new BN(1),
              expectedOfferingManifestHash: offeringManifestHash,
              expectedRefundPolicyHash: offeringRefundPolicyHash,
              expectedPriceLamports: new BN(grossLamports),
              expectedEntitlementStateSequence: new BN(0),
            })
            .accountsStrict({
              config,
              paymentConfig,
              payerIdentity: payer.address,
              creatorIdentity: creator.address,
              offering: primaryOffering,
              entitlement,
              receipt: firstSubscriptionReceipt,
              payerAuthority: payer.authority.publicKey,
              creatorDestination: creator.authority.publicKey,
              feeDestination: feeDestination.publicKey,
              rentPayer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
              recipientIdentity0: additionalRecipient0.address,
              recipientDestination0: additionalRecipient0.authority.publicKey,
              recipientIdentity1: additionalRecipient1.address,
              recipientDestination1: additionalRecipient1.authority.publicKey,
            })
            .transaction(),
        [payer.authority],
      );
      measurements.push(settled);
      const after = await readBalances(context, tracked);
      const allocation = calculateNativeAllocation(
        BigInt(grossLamports),
        feeBps,
        orderedSplits,
      );
      assertBalanceDelta(
        before,
        after,
        payer.authority.publicKey,
        -grossLamports,
      );
      assertBalanceDelta(
        before,
        after,
        feeDestination.publicKey,
        Number(allocation.feeLamports),
      );
      for (const [index, split] of allocation.orderedSplits.entries()) {
        assertBalanceDelta(
          before,
          after,
          split.destination,
          Number(bigintAt(allocation.recipientAmounts, index)),
        );
      }
      const recipientTotal = allocation.recipientAmounts.reduce(
        (total, amount) => total + amount,
        0n,
      );
      assert.equal(
        allocation.feeLamports + recipientTotal,
        BigInt(grossLamports),
      );

      const settledEvent = eventByName(
        await parsedEvents(context, settled.signature),
        "subscriptionSettled",
      );
      assert.equal(
        publicKeyString(settledEvent.offering),
        primaryOffering.toBase58(),
      );
      assert.equal(
        publicKeyString(settledEvent.receipt),
        firstSubscriptionReceipt.toBase58(),
      );
      assert.equal(
        publicKeyString(settledEvent.entitlement),
        entitlement.toBase58(),
      );
      assert.deepEqual(settledEvent.paymentKind, {
        weeklySubscription: {},
      });
      assert.deepEqual(
        bytes(settledEvent.offeringManifestHash),
        offeringManifestHash,
      );
      assert.deepEqual(
        bytes(settledEvent.refundPolicyHash),
        offeringRefundPolicyHash,
      );
      assert.equal(bnNumber(settledEvent.grossLamports), grossLamports);
      assert.equal(
        bnNumber(settledEvent.feeLamports),
        Number(allocation.feeLamports),
      );
      assert.equal(
        bnNumber(settledEvent.distributableLamports),
        Number(allocation.distributableLamports),
      );
      assert.deepEqual(
        bnNumbers(settledEvent.recipientAmounts),
        allocation.recipientAmounts.map(Number),
      );
      assert.equal(bnNumber(settledEvent.entitlementStateSequence), 1);
      assert.equal(bnNumber(settledEvent.settlementCount), 1);
      assert.equal(
        bnNumber(settledEvent.entitlementUntilTimestamp) -
          bnNumber(settledEvent.entitlementFromTimestamp),
        WEEK_SECONDS,
      );
      assert.equal(
        bnNumber(settledEvent.entitlementFromTimestamp),
        bnNumber(settledEvent.paidAtTimestamp),
      );

      const receipt = await program.account.paymentReceipt.fetch(
        firstSubscriptionReceipt,
      );
      assert.deepEqual(receipt.kind, { weeklySubscription: {} });
      assert.equal(
        receipt.termsReference.toBase58(),
        primaryOffering.toBase58(),
      );
      assert.equal(receipt.paymentPolicySequence.toNumber(), 3);
      assert.equal(receipt.termsStateSequence.toNumber(), 1);
      assert.equal(receipt.grossLamports.toNumber(), grossLamports);
      assert.equal(receipt.feeLamports.toNumber(), Number(allocation.feeLamports));
      assert.deepEqual(
        receipt.recipientAmounts.map((amount) => amount.toNumber()),
        allocation.recipientAmounts.map(Number),
      );
      assert.equal(
        receipt.entitlementUntilTimestamp.toNumber() -
          receipt.entitlementFromTimestamp.toNumber(),
        WEEK_SECONDS,
      );
      assert.equal(
        receipt.entitlementFromTimestamp.toNumber(),
        receipt.paidAtTimestamp.toNumber(),
      );

      const entitlementState =
        await program.account.subscriptionEntitlement.fetch(entitlement);
      assert.equal(
        entitlementState.offering.toBase58(),
        primaryOffering.toBase58(),
      );
      assert.equal(
        entitlementState.beneficiaryIdentity.toBase58(),
        payer.address.toBase58(),
      );
      assert.equal(entitlementState.stateSequence.toNumber(), 1);
      assert.equal(entitlementState.settlementCount.toNumber(), 1);
      assert.equal(
        entitlementState.lastReceipt.toBase58(),
        firstSubscriptionReceipt.toBase58(),
      );
      assert.equal(
        entitlementState.validUntilTimestamp.toNumber() -
          entitlementState.startedAtTimestamp.toNumber(),
        WEEK_SECONDS,
      );
      rentEvidence.push(
        await assertRentExemptAccount(
          context,
          firstSubscriptionReceipt,
          "weekly subscription receipt",
          PAYMENT_RECEIPT_SPACE,
        ),
      );
      rentEvidence.push(
        await assertRentExemptAccount(
          context,
          entitlement,
          "weekly subscription entitlement",
          SUBSCRIPTION_ENTITLEMENT_SPACE,
        ),
      );
    });

    it("rejects cross-kind replay, stale entitlement CAS, and account substitution", async () => {
      const staleNonce = nonce(181);
      const staleReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        staleNonce,
      );
      const substitutedNonce = nonce(201);
      const substitutedReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        substitutedNonce,
      );
      const feeSubstitutionNonce = nonce(221);
      const feeSubstitutionReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        feeSubstitutionNonce,
      );
      const tracked = [
        payer.authority.publicKey,
        feeDestination.publicKey,
        creator.authority.publicKey,
        additionalRecipient0.authority.publicKey,
        additionalRecipient1.authority.publicKey,
        substituteRecipient.authority.publicKey,
      ];
      const attempt = (
        receiptNonce: number[],
        receipt: web3.PublicKey,
        expectedEntitlementStateSequence: number,
        recipientDestination0: web3.PublicKey,
        suppliedFeeDestination: web3.PublicKey,
      ) =>
        program.methods
          .settleSubscription({
            receiptNonce,
            expectedPaymentPolicySequence: new BN(3),
            expectedFeeBps: feeBps,
            expectedFeeDestination: feeDestination.publicKey,
            expectedPayerRootRotationCount: new BN(0),
            expectedOfferingStateSequence: new BN(1),
            expectedOfferingManifestHash: offeringManifestHash,
            expectedRefundPolicyHash: offeringRefundPolicyHash,
            expectedPriceLamports: new BN(grossLamports),
            expectedEntitlementStateSequence: new BN(
              expectedEntitlementStateSequence,
            ),
          })
          .accountsStrict({
            config,
            paymentConfig,
            payerIdentity: payer.address,
            creatorIdentity: creator.address,
            offering: primaryOffering,
            entitlement,
            receipt,
            payerAuthority: payer.authority.publicKey,
            creatorDestination: creator.authority.publicKey,
            feeDestination: suppliedFeeDestination,
            rentPayer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            recipientIdentity0: additionalRecipient0.address,
            recipientDestination0,
            recipientIdentity1: additionalRecipient1.address,
            recipientDestination1: additionalRecipient1.authority.publicKey,
          })
          .signers([payer.authority])
          .rpc();

      const before = await readBalances(context, tracked);
      await assertAnchorError(
        attempt(
          tipReceiptNonce,
          tipReceipt,
          1,
          additionalRecipient0.authority.publicKey,
          feeDestination.publicKey,
        ),
        "PaymentReceiptAlreadyExists",
      );
      await assertAnchorError(
        attempt(
          staleNonce,
          staleReceipt,
          0,
          additionalRecipient0.authority.publicKey,
          feeDestination.publicKey,
        ),
        "EntitlementSequenceMismatch",
      );
      await assertAnchorError(
        attempt(
          substitutedNonce,
          substitutedReceipt,
          1,
          substituteRecipient.authority.publicKey,
          feeDestination.publicKey,
        ),
        "PaymentRecipientSubstitution",
      );
      await assertAnchorError(
        attempt(
          feeSubstitutionNonce,
          feeSubstitutionReceipt,
          1,
          additionalRecipient0.authority.publicKey,
          substituteRecipient.authority.publicKey,
        ),
        "PaymentConfigSubstitution",
      );
      const after = await readBalances(context, tracked);
      assertBalancesUnchanged(before, after, tracked);

      for (const failedReceipt of [
        staleReceipt,
        substitutedReceipt,
        feeSubstitutionReceipt,
      ]) {
        assert.equal(
          await provider.connection.getAccountInfo(failedReceipt, "confirmed"),
          null,
        );
      }
      const entitlementState =
        await program.account.subscriptionEntitlement.fetch(entitlement);
      assert.equal(entitlementState.stateSequence.toNumber(), 1);
      assert.equal(entitlementState.settlementCount.toNumber(), 1);
    });

    it("renews from paid-through time and extends the entitlement by one week", async () => {
      const renewalReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        renewalReceiptNonce,
      );
      const priorEntitlement =
        await program.account.subscriptionEntitlement.fetch(entitlement);
      const priorValidUntil = priorEntitlement.validUntilTimestamp.toNumber();
      const tracked = [
        payer.authority.publicKey,
        feeDestination.publicKey,
        creator.authority.publicKey,
        additionalRecipient0.authority.publicKey,
        additionalRecipient1.authority.publicKey,
      ];
      const before = await readBalances(context, tracked);
      const renewal = await measureAndSend(
        context,
        "renew subscription",
        () =>
          program.methods
            .settleSubscription({
              receiptNonce: renewalReceiptNonce,
              expectedPaymentPolicySequence: new BN(3),
              expectedFeeBps: feeBps,
              expectedFeeDestination: feeDestination.publicKey,
              expectedPayerRootRotationCount: new BN(0),
              expectedOfferingStateSequence: new BN(1),
              expectedOfferingManifestHash: offeringManifestHash,
              expectedRefundPolicyHash: offeringRefundPolicyHash,
              expectedPriceLamports: new BN(grossLamports),
              expectedEntitlementStateSequence: new BN(1),
            })
            .accountsStrict({
              config,
              paymentConfig,
              payerIdentity: payer.address,
              creatorIdentity: creator.address,
              offering: primaryOffering,
              entitlement,
              receipt: renewalReceipt,
              payerAuthority: payer.authority.publicKey,
              creatorDestination: creator.authority.publicKey,
              feeDestination: feeDestination.publicKey,
              rentPayer: provider.wallet.publicKey,
              systemProgram: SystemProgram.programId,
              recipientIdentity0: additionalRecipient0.address,
              recipientDestination0: additionalRecipient0.authority.publicKey,
              recipientIdentity1: additionalRecipient1.address,
              recipientDestination1: additionalRecipient1.authority.publicKey,
            })
            .transaction(),
        [payer.authority],
      );
      const after = await readBalances(context, tracked);
      const allocation = calculateNativeAllocation(
        BigInt(grossLamports),
        feeBps,
        orderedSplits,
      );
      assertBalanceDelta(
        before,
        after,
        payer.authority.publicKey,
        -grossLamports,
      );
      assertBalanceDelta(
        before,
        after,
        feeDestination.publicKey,
        Number(allocation.feeLamports),
      );
      for (const [index, split] of allocation.orderedSplits.entries()) {
        assertBalanceDelta(
          before,
          after,
          split.destination,
          Number(bigintAt(allocation.recipientAmounts, index)),
        );
      }

      const renewedEvent = eventByName(
        await parsedEvents(context, renewal.signature),
        "subscriptionSettled",
      );
      assert.equal(bnNumber(renewedEvent.entitlementStateSequence), 2);
      assert.equal(bnNumber(renewedEvent.settlementCount), 2);
      assert.equal(
        bnNumber(renewedEvent.entitlementFromTimestamp),
        priorValidUntil,
      );
      assert.equal(
        bnNumber(renewedEvent.entitlementUntilTimestamp),
        priorValidUntil + WEEK_SECONDS,
      );

      const renewed =
        await program.account.subscriptionEntitlement.fetch(entitlement);
      assert.equal(renewed.stateSequence.toNumber(), 2);
      assert.equal(renewed.settlementCount.toNumber(), 2);
      assert.equal(renewed.validUntilTimestamp.toNumber(), priorValidUntil + WEEK_SECONDS);
      assert.equal(renewed.lastReceipt.toBase58(), renewalReceipt.toBase58());
    });

    it("pauses settlement atomically and requires the new policy snapshot", async () => {
      await program.methods
        .updatePaymentConfig({
          expectedPolicySequence: new BN(3),
          feeBps,
          enabled: false,
        })
        .accountsStrict({
          config,
          paymentConfig,
          authority: rotatedPaymentAuthority.publicKey,
          feeDestination: feeDestination.publicKey,
        })
        .signers([rotatedPaymentAuthority])
        .rpc();

      const pausedNonce = nonce(241);
      const pausedReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        pausedNonce,
      );
      const tracked = [
        payer.authority.publicKey,
        feeDestination.publicKey,
        creator.authority.publicKey,
        additionalRecipient0.authority.publicKey,
        additionalRecipient1.authority.publicKey,
      ];
      const before = await readBalances(context, tracked);
      await assertAnchorError(
        program.methods
          .settleSubscription({
            receiptNonce: pausedNonce,
            expectedPaymentPolicySequence: new BN(4),
            expectedFeeBps: feeBps,
            expectedFeeDestination: feeDestination.publicKey,
            expectedPayerRootRotationCount: new BN(0),
            expectedOfferingStateSequence: new BN(1),
            expectedOfferingManifestHash: offeringManifestHash,
            expectedRefundPolicyHash: offeringRefundPolicyHash,
            expectedPriceLamports: new BN(grossLamports),
            expectedEntitlementStateSequence: new BN(2),
          })
          .accountsStrict({
            config,
            paymentConfig,
            payerIdentity: payer.address,
            creatorIdentity: creator.address,
            offering: primaryOffering,
            entitlement,
            receipt: pausedReceipt,
            payerAuthority: payer.authority.publicKey,
            creatorDestination: creator.authority.publicKey,
            feeDestination: feeDestination.publicKey,
            rentPayer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            recipientIdentity0: additionalRecipient0.address,
            recipientDestination0: additionalRecipient0.authority.publicKey,
            recipientIdentity1: additionalRecipient1.address,
            recipientDestination1: additionalRecipient1.authority.publicKey,
          })
          .signers([payer.authority])
          .rpc(),
        "PaymentsDisabled",
      );
      const after = await readBalances(context, tracked);
      assertBalancesUnchanged(before, after, tracked);
      assert.equal(
        await provider.connection.getAccountInfo(pausedReceipt, "confirmed"),
        null,
      );

      await program.methods
        .updatePaymentConfig({
          expectedPolicySequence: new BN(4),
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
        .rpc();
      const state = await program.account.paymentConfig.fetch(paymentConfig);
      assert.equal(state.enabled, true);
      assert.equal(state.policySequence.toNumber(), 5);
    });

    it("makes retirement terminal and creator root rotation stale", async () => {
      const secondManifestHash = digest("payment-weekly-offering-v2");
      const secondRefundPolicyHash = digest("payment-refund-policy-v2");
      const secondPriceLamports = 120_001;
      secondaryOffering = deriveSubscriptionOffering(
        program.programId,
        creator.address,
        secondOfferingNonce,
      );
      await program.methods
        .createSubscriptionOffering({
          expectedCreatorSequence: new BN(1),
          offeringNonce: secondOfferingNonce,
          manifestHash: secondManifestHash,
          manifestUri: manifestUri("payment-weekly-offering-v2"),
          priceLamports: new BN(secondPriceLamports),
          refundPolicyHash: secondRefundPolicyHash,
          maxProtocolFeeBps: 500,
          creatorBasisPoints: 10_000,
          additionalRecipientBasisPoints: [],
        })
        .accountsStrict({
          config,
          paymentConfig,
          creatorIdentity: creator.address,
          offering: secondaryOffering,
          rootAuthority: creator.authority.publicKey,
          payer: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
          recipientIdentity0: null,
          recipientDestination0: null,
          recipientIdentity1: null,
          recipientDestination1: null,
        })
        .signers([creator.authority])
        .rpc();

      const retired = await measureAndSend(
        context,
        "retire subscription offering",
        () =>
          program.methods
            .retireSubscriptionOffering({
              expectedCreatorSequence: new BN(2),
              expectedOfferingStateSequence: new BN(1),
            })
            .accountsStrict({
              config,
              creatorIdentity: creator.address,
              offering: primaryOffering,
              rootAuthority: creator.authority.publicKey,
            })
            .transaction(),
        [creator.authority],
      );
      measurements.push(retired);
      const retiredEvent = eventByName(
        await parsedEvents(context, retired.signature),
        "subscriptionOfferingRetired",
      );
      assert.equal(
        publicKeyString(retiredEvent.offering),
        primaryOffering.toBase58(),
      );
      assert.equal(bnNumber(retiredEvent.creatorSequence), 3);
      assert.equal(bnNumber(retiredEvent.offeringStateSequence), 2);

      const retiredState =
        await program.account.creatorSubscriptionOffering.fetch(primaryOffering);
      assert.equal(retiredState.active, false);
      assert.notEqual(retiredState.retiredAtSlot, null);
      assert.equal(retiredState.stateSequence.toNumber(), 2);

      const retiredAttemptNonce = nonce(5);
      const retiredAttemptReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        retiredAttemptNonce,
      );
      const tracked = [
        payer.authority.publicKey,
        feeDestination.publicKey,
        creator.authority.publicKey,
        additionalRecipient0.authority.publicKey,
        additionalRecipient1.authority.publicKey,
      ];
      const beforeRetiredAttempt = await readBalances(context, tracked);
      await assertAnchorError(
        program.methods
          .settleSubscription({
            receiptNonce: retiredAttemptNonce,
            expectedPaymentPolicySequence: new BN(5),
            expectedFeeBps: feeBps,
            expectedFeeDestination: feeDestination.publicKey,
            expectedPayerRootRotationCount: new BN(0),
            expectedOfferingStateSequence: new BN(2),
            expectedOfferingManifestHash: offeringManifestHash,
            expectedRefundPolicyHash: offeringRefundPolicyHash,
            expectedPriceLamports: new BN(grossLamports),
            expectedEntitlementStateSequence: new BN(2),
          })
          .accountsStrict({
            config,
            paymentConfig,
            payerIdentity: payer.address,
            creatorIdentity: creator.address,
            offering: primaryOffering,
            entitlement,
            receipt: retiredAttemptReceipt,
            payerAuthority: payer.authority.publicKey,
            creatorDestination: creator.authority.publicKey,
            feeDestination: feeDestination.publicKey,
            rentPayer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            recipientIdentity0: additionalRecipient0.address,
            recipientDestination0: additionalRecipient0.authority.publicKey,
            recipientIdentity1: additionalRecipient1.address,
            recipientDestination1: additionalRecipient1.authority.publicKey,
          })
          .signers([payer.authority])
          .rpc(),
        "SubscriptionOfferingInactive",
      );
      const afterRetiredAttempt = await readBalances(context, tracked);
      assertBalancesUnchanged(
        beforeRetiredAttempt,
        afterRetiredAttempt,
        tracked,
      );

      await program.methods
        .rotateRootAuthority({
          expectedIdentitySequence: new BN(3),
        })
        .accountsStrict({
          config,
          identity: creator.address,
          rootAuthority: creator.authority.publicKey,
          newRootAuthority: rotatedCreatorAuthority.publicKey,
        })
        .signers([creator.authority, rotatedCreatorAuthority])
        .rpc();

      const secondaryEntitlement = deriveSubscriptionEntitlement(
        program.programId,
        secondaryOffering,
        payer.address,
      );
      const staleCreatorNonce = nonce(25);
      const staleCreatorReceipt = derivePaymentReceipt(
        program.programId,
        payer.address,
        staleCreatorNonce,
      );
      const staleTracked = [
        payer.authority.publicKey,
        feeDestination.publicKey,
        creator.authority.publicKey,
        rotatedCreatorAuthority.publicKey,
      ];
      const beforeStaleAttempt = await readBalances(context, staleTracked);
      await assertAnchorError(
        program.methods
          .settleSubscription({
            receiptNonce: staleCreatorNonce,
            expectedPaymentPolicySequence: new BN(5),
            expectedFeeBps: feeBps,
            expectedFeeDestination: feeDestination.publicKey,
            expectedPayerRootRotationCount: new BN(0),
            expectedOfferingStateSequence: new BN(1),
            expectedOfferingManifestHash: secondManifestHash,
            expectedRefundPolicyHash: secondRefundPolicyHash,
            expectedPriceLamports: new BN(secondPriceLamports),
            expectedEntitlementStateSequence: new BN(0),
          })
          .accountsStrict({
            config,
            paymentConfig,
            payerIdentity: payer.address,
            creatorIdentity: creator.address,
            offering: secondaryOffering,
            entitlement: secondaryEntitlement,
            receipt: staleCreatorReceipt,
            payerAuthority: payer.authority.publicKey,
            creatorDestination: rotatedCreatorAuthority.publicKey,
            feeDestination: feeDestination.publicKey,
            rentPayer: provider.wallet.publicKey,
            systemProgram: SystemProgram.programId,
            recipientIdentity0: null,
            recipientDestination0: null,
            recipientIdentity1: null,
            recipientDestination1: null,
          })
          .signers([payer.authority])
          .rpc(),
        "SubscriptionOfferingStaleCreator",
      );
      const afterStaleAttempt = await readBalances(context, staleTracked);
      assertBalancesUnchanged(
        beforeStaleAttempt,
        afterStaleAttempt,
        staleTracked,
      );
      assert.equal(
        await provider.connection.getAccountInfo(
          retiredAttemptReceipt,
          "confirmed",
        ),
        null,
      );
      assert.equal(
        await provider.connection.getAccountInfo(staleCreatorReceipt, "confirmed"),
        null,
      );
      assert.equal(
        await provider.connection.getAccountInfo(
          secondaryEntitlement,
          "confirmed",
        ),
        null,
      );
    });

    it("records account rent, transaction bytes, and compute evidence", async () => {
      rentEvidence.push(
        await assertRentExemptAccount(
          context,
          secondaryOffering,
          "stale creator subscription offering",
          SUBSCRIPTION_OFFERING_SPACE,
        ),
      );
      assert.deepEqual(
        measurements.map(({ label }) => label).sort(),
        [
          "create subscription offering",
          "initialize payment config",
          "retire subscription offering",
          "rotate payment authority",
          "send WOKE tip",
          "settle subscription",
          "update payment config",
        ],
      );
      assert.equal(measurements.length, 7);
      assert.ok(
        measurements.every(
          ({ computeUnits, transactionBytes }) =>
            computeUnits > 0 &&
            computeUnits <= 150_000 &&
            transactionBytes > 0 &&
            transactionBytes <= 1_100,
        ),
      );
      assert.deepEqual(
        [...new Set(rentEvidence.map(({ space }) => space))].sort(
          (left, right) => left - right,
        ),
        [
          PAYMENT_CONFIG_SPACE,
          SUBSCRIPTION_ENTITLEMENT_SPACE,
          PAYMENT_RECEIPT_SPACE,
          SUBSCRIPTION_OFFERING_SPACE,
        ].sort((left, right) => left - right),
      );
      process.stdout.write(
        `\npayment-cost-evidence ${JSON.stringify({
          measurements,
          rentEvidence,
        })}\n`,
      );
    });
  });
}
