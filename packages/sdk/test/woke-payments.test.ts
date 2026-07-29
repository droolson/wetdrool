import { AccountRole } from '@solana/kit';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import {
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  WokePaymentError,
  assertWokePaymentSimulationMatches,
  buildCreateWokeSubscriptionOfferingInstruction,
  buildDeactivateWokeIdentityInstruction,
  buildInitializeWokePaymentConfigInstruction,
  buildRetireWokeSubscriptionOfferingInstruction,
  buildRotateWokePaymentAuthorityInstruction,
  buildSendWokeTipInstruction,
  buildSettleWokeSubscriptionInstruction,
  buildUpdateWokePaymentConfigInstruction,
  calculatePaymentPlan,
  calculateWokeNativePaymentPlan,
  createWokeNetContext,
  deriveWokeIdentityAddress,
  deriveWokePaymentConfigAddress,
  deriveWokePaymentReceiptAddress,
  deriveWokeProgramDataAddress,
  deriveWokeProtocolConfigAddress,
  deriveWokeSubscriptionEntitlementAddress,
  deriveWokeSubscriptionOfferingAddress,
  verifyFinalizedWokeSubscriptionProof,
  verifyFinalizedWokeTipReceipt,
  type BuiltWokeSubscriptionSettlementInstruction,
  type BuiltWokeTipInstruction,
  type PaymentPlanInput,
  type SettleWokeSubscriptionInput,
  type WokeFinalizedAccount,
  type WokeNetContext,
  type WokePaymentAccountReader,
  type WokePaymentReceiptRecord,
  type WokePaymentSimulation,
  type WokeSubscriptionEntitlementRecord,
  type WokeSubscriptionSettledEvent,
  type WokeTipSettledEvent,
} from '../src/index.js';

const key = (byte: number): string => bs58.encode(Uint8Array.from({ length: 32 }, () => byte));
const leadingByteKey = (byte: number): string => {
  const bytes = new Uint8Array(32);
  bytes[0] = byte;
  return bs58.encode(bytes);
};
const nonce = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
const secondNonce = Uint8Array.from({ length: 16 }, (_, index) => index + 17);
const manifestHash = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const refundHash = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const zeroHash = new Uint8Array(32);
const manifestCid = 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku';
const offeringManifestUri = `ipfs://${manifestCid}`;

const payerIdentity = key(4);
const payerAuthority = key(5);
const feeDestination = key(6);
const originAuthority = key(9);
const creatorIdentity = key(10);
const creatorDestination = key(11);
const recipientIdentityA = key(12);
const recipientDestinationA = key(13);
const recipientIdentityB = key(14);
const recipientDestinationB = key(15);
const rentPayer = key(16);
const paymentAuthority = key(17);
const upgradeAuthority = key(18);
const rotatedAuthority = key(19);

const context: WokeNetContext = {
  endpoint: 'https://rpc.network.woke.social',
  genesisHash: 'EahQmXc3rwhY3CH1g3ZgUx8L4vHTNmzpK1xtiQ1RAxq6',
  programAddress: 'EWn7dE93GeQJu72WEkEmC5MZpm5FhiJzkcJEf1xpRdWP',
};

const expectedContext = {
  ...context,
  endpoint: 'https://rpc.network.woke.social/',
};

const golden = {
  config: 'FeSjhoreagBTkGASC5AxV926Jir3pRuzj19W2iwZZvgN',
  paymentConfig: 'AewMCbKbVH69n78imNzEG5tmX9TNVK7hTuvf9gJRtEpY',
  identity: '9fu4mSTovjLnPUeBdtAeRKWFugsCK5Nd3up1ibjhiA2s',
  offering: '9YDbbCYWYV89wni3rApUJmJYHiw94pHvsFM83778wkBu',
  receipt: 'HSNdFGhZbSdj6rvLG2h71p9YWmZDPyE4ZEuDPYF66CDE',
  entitlement: '3HcPGWEwxsgREnoNprN1SJJgG9F9MFTBMegvbXxGuzPs',
  programData: 'Bu4Nc1osJDMhzpqdwaY6ep8vNtkqHN9TPz2Pawdnf6jv',
} as const;

function validPlanInput() {
  return {
    context,
    payerIdentity,
    payerAuthority,
    feeDestination,
    feeBasisPoints: 250,
    grossLamports: 101n,
    recipientSplits: [
      {
        recipientIdentity: recipientIdentityB,
        destination: recipientDestinationB,
        basisPoints: 5_000,
      },
      {
        recipientIdentity: recipientIdentityA,
        destination: recipientDestinationA,
        basisPoints: 5_000,
      },
    ],
  } as const;
}

function tipInput() {
  return {
    payerIdentity,
    payerAuthority,
    recipientIdentity: creatorIdentity,
    recipientDestination: creatorDestination,
    feeDestination,
    rentPayer,
    receiptNonce: nonce,
    expectedPaymentPolicySequence: 7n,
    expectedFeeBasisPoints: 250,
    expectedPayerRootRotationCount: 2n,
    grossLamports: 101n,
  } as const;
}

function subscriptionInput(
  entitlement: SettleWokeSubscriptionInput['entitlement'] = { kind: 'new' },
): SettleWokeSubscriptionInput {
  return {
    payerIdentity,
    payerAuthority,
    creatorIdentity,
    creatorDestination,
    offeringNonce: nonce,
    feeDestination,
    rentPayer,
    receiptNonce: secondNonce,
    expectedPaymentPolicySequence: 7n,
    expectedFeeBasisPoints: 250,
    expectedPayerRootRotationCount: 2n,
    expectedOfferingStateSequence: 4n,
    expectedOfferingManifestHash: manifestHash,
    expectedRefundPolicyHash: refundHash,
    expectedPriceLamports: 101n,
    entitlement,
    recipientSplits: [
      {
        recipientIdentity: recipientIdentityB,
        destination: recipientDestinationB,
        basisPoints: 2_500,
      },
      {
        recipientIdentity: creatorIdentity,
        destination: creatorDestination,
        basisPoints: 5_000,
      },
      {
        recipientIdentity: recipientIdentityA,
        destination: recipientDestinationA,
        basisPoints: 2_500,
      },
    ],
  };
}

describe('legacy SOL allocation', () => {
  it('requires an explicit endpoint, genesis hash, and program address', () => {
    expect(createWokeNetContext(context)).toEqual(expectedContext);
    expect(() =>
      createWokeNetContext({ ...context, endpoint: 'wss://rpc.network.woke.social' }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-context' }));
    expect(() =>
      createWokeNetContext({
        ...context,
        genesisHash: `solana:${context.genesisHash}`,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-address' }));
    expect(() =>
      createWokeNetContext({
        ...context,
        programAddress: WOKENET_SYSTEM_PROGRAM_ADDRESS,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-address' }));
  });

  it('uses fee-floor and Hamilton rounding ordered by decoded identity bytes', () => {
    const plan = calculateWokeNativePaymentPlan(validPlanInput());

    expect(plan).toMatchObject({
      asset: 'SOL',
      context: expectedContext,
      grossLamports: 101n,
      feeLamports: 2n,
      distributableLamports: 99n,
      roundingPolicy: 'largest-remainder-raw-identity-bytes',
    });
    expect(plan.recipientAllocations).toEqual([
      {
        recipientIdentity: recipientIdentityA,
        destination: recipientDestinationA,
        basisPoints: 5_000,
        lamports: 50n,
      },
      {
        recipientIdentity: recipientIdentityB,
        destination: recipientDestinationB,
        basisPoints: 5_000,
        lamports: 49n,
      },
    ]);
    expect(
      plan.transfers.map(({ kind, source, destination, lamports }) => ({
        kind,
        source,
        destination,
        lamports,
      })),
    ).toEqual([
      {
        kind: 'protocol-fee',
        source: payerAuthority,
        destination: feeDestination,
        lamports: 2n,
      },
      {
        kind: 'recipient',
        source: payerAuthority,
        destination: recipientDestinationA,
        lamports: 50n,
      },
      {
        kind: 'recipient',
        source: payerAuthority,
        destination: recipientDestinationB,
        lamports: 49n,
      },
    ]);
  });

  it('uses raw-byte order even when base58 string order is the opposite', () => {
    const rawLowerIdentity = leadingByteKey(1);
    const rawHigherIdentity = leadingByteKey(15);
    expect(rawHigherIdentity < rawLowerIdentity).toBe(true);

    const plan = calculateWokeNativePaymentPlan({
      ...validPlanInput(),
      grossLamports: 3n,
      feeBasisPoints: 0,
      recipientSplits: [
        {
          recipientIdentity: rawHigherIdentity,
          destination: recipientDestinationB,
          basisPoints: 5_000,
        },
        {
          recipientIdentity: rawLowerIdentity,
          destination: recipientDestinationA,
          basisPoints: 5_000,
        },
      ],
    });

    expect(plan.recipientAllocations).toMatchObject([
      { recipientIdentity: rawLowerIdentity, lamports: 2n },
      { recipientIdentity: rawHigherIdentity, lamports: 1n },
    ]);
  });

  it('conserves the unsigned-64 maximum through checked unsigned-128 intermediates', () => {
    const grossLamports = 18_446_744_073_709_551_615n;
    const plan = calculateWokeNativePaymentPlan({
      ...validPlanInput(),
      grossLamports,
      feeBasisPoints: 1_000,
      recipientSplits: [
        {
          recipientIdentity: recipientIdentityB,
          destination: recipientDestinationB,
          basisPoints: 3_333,
        },
        {
          recipientIdentity: creatorIdentity,
          destination: creatorDestination,
          basisPoints: 3_334,
        },
        {
          recipientIdentity: recipientIdentityA,
          destination: recipientDestinationA,
          basisPoints: 3_333,
        },
      ],
    });

    expect(
      plan.feeLamports +
        plan.recipientAllocations.reduce((sum, recipient) => sum + recipient.lamports, 0n),
    ).toBe(grossLamports);
    expect(plan.recipientAllocations.every((recipient) => recipient.lamports > 0n)).toBe(true);
  });

  it('rejects u64 overflow, recipient underflow, malformed splits, and every role alias', () => {
    expect(() =>
      calculateWokeNativePaymentPlan({
        ...validPlanInput(),
        grossLamports: 18_446_744_073_709_551_616n,
      }),
    ).toThrowError(expect.objectContaining({ code: 'amount-out-of-range' }));
    expect(() =>
      calculateWokeNativePaymentPlan({
        ...validPlanInput(),
        feeBasisPoints: 1_001,
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-fee' }));
    expect(() =>
      calculateWokeNativePaymentPlan({
        ...validPlanInput(),
        grossLamports: 1n,
      }),
    ).toThrowError(expect.objectContaining({ code: 'rounding-underflow' }));
    expect(() =>
      calculateWokeNativePaymentPlan({
        ...validPlanInput(),
        recipientSplits: [
          {
            recipientIdentity: recipientIdentityA,
            destination: recipientDestinationA,
            basisPoints: 9_999,
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-recipient' }));
    expect(() =>
      calculateWokeNativePaymentPlan({
        ...validPlanInput(),
        feeDestination: recipientIdentityA,
      }),
    ).toThrowError(expect.objectContaining({ code: 'alias' }));
    expect(() =>
      calculateWokeNativePaymentPlan({
        ...validPlanInput(),
        payerAuthority: recipientDestinationA,
      }),
    ).toThrowError(expect.objectContaining({ code: 'alias' }));
    expect(() =>
      calculateWokeNativePaymentPlan({
        ...validPlanInput(),
        payerIdentity: recipientIdentityA,
      }),
    ).toThrowError(expect.objectContaining({ code: 'alias' }));
  });

  it('rejects the retired portable native WOKE discriminator', () => {
    const legacyInput = {
      asset: { kind: 'woke' },
      grossAmount: '1',
      allowedAssets: [{ kind: 'woke' }],
      protocolFee: { basisPoints: 0, destination: feeDestination },
      recipientSplits: [
        {
          recipient: `wokesocialid:v1:wokenet:v1:${context.genesisHash}:${context.programAddress}:${creatorIdentity}`,
          destination: creatorDestination,
          basisPoints: 10_000,
        },
      ],
    } as unknown as PaymentPlanInput;

    expect(() => calculatePaymentPlan(legacyInput)).toThrow();
  });
});

describe('WokeSocial protocol PDA derivation', () => {
  it('matches the pinned protocol seed vectors', async () => {
    await expect(deriveWokeProtocolConfigAddress(context)).resolves.toBe(golden.config);
    await expect(deriveWokePaymentConfigAddress(context)).resolves.toBe(golden.paymentConfig);
    await expect(deriveWokeIdentityAddress(context, originAuthority, nonce)).resolves.toBe(
      golden.identity,
    );
    await expect(
      deriveWokeSubscriptionOfferingAddress(context, creatorIdentity, nonce),
    ).resolves.toBe(golden.offering);
    await expect(deriveWokePaymentReceiptAddress(context, payerIdentity, nonce)).resolves.toBe(
      golden.receipt,
    );
    await expect(
      deriveWokeSubscriptionEntitlementAddress(context, golden.offering, payerIdentity),
    ).resolves.toBe(golden.entitlement);
    await expect(deriveWokeProgramDataAddress(context)).resolves.toBe(golden.programData);
  });

  it('rejects zero and wrong-length nonces before deriving an address', async () => {
    await expect(
      deriveWokePaymentReceiptAddress(context, payerIdentity, new Uint8Array(16)),
    ).rejects.toMatchObject({ code: 'invalid-wire-value' });
    await expect(
      deriveWokeSubscriptionOfferingAddress(context, creatorIdentity, new Uint8Array(15)),
    ).rejects.toMatchObject({ code: 'invalid-wire-value' });
  });
});

describe('WokeSocial Anchor instruction builders', () => {
  it('builds one-way identity deactivation with exact IDL accounts and wire data', async () => {
    const instruction = await buildDeactivateWokeIdentityInstruction(context, {
      identity: creatorIdentity,
      rootAuthority: creatorDestination,
      expectedIdentitySequence: 7n,
    });

    expect(instruction.programAddress).toBe(context.programAddress);
    expect(instruction.accounts).toEqual([
      { address: golden.config, role: AccountRole.READONLY },
      { address: creatorIdentity, role: AccountRole.WRITABLE },
      { address: creatorDestination, role: AccountRole.READONLY_SIGNER },
    ]);
    expect([...instruction.data.slice(0, 8)]).toEqual([58, 175, 10, 246, 145, 179, 1, 179]);
    expect(readU64(instruction.data, 8)).toBe(7n);

    await expect(
      buildDeactivateWokeIdentityInstruction(context, {
        identity: creatorIdentity,
        rootAuthority: creatorDestination,
        expectedIdentitySequence: 18_446_744_073_709_551_615n,
      }),
    ).rejects.toMatchObject({ code: 'amount-out-of-range' });
    await expect(
      buildDeactivateWokeIdentityInstruction(context, {
        identity: creatorIdentity,
        rootAuthority: creatorIdentity,
        expectedIdentitySequence: 0n,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
  });

  it('builds initialize/update/rotate config instructions with exact IDL order and wire data', async () => {
    const initialized = await buildInitializeWokePaymentConfigInstruction(context, {
      upgradeAuthority,
      paymentAuthority,
      feeDestination,
      payer: rentPayer,
      feeBasisPoints: 250,
    });
    expect(initialized.programAddress).toBe(context.programAddress);
    expect(initialized.accounts).toEqual([
      { address: golden.config, role: AccountRole.READONLY },
      { address: golden.paymentConfig, role: AccountRole.WRITABLE },
      { address: context.programAddress, role: AccountRole.READONLY },
      { address: golden.programData, role: AccountRole.READONLY },
      { address: upgradeAuthority, role: AccountRole.READONLY_SIGNER },
      { address: paymentAuthority, role: AccountRole.READONLY_SIGNER },
      { address: feeDestination, role: AccountRole.READONLY },
      { address: rentPayer, role: AccountRole.WRITABLE_SIGNER },
      { address: WOKENET_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ]);
    expect([...initialized.data]).toEqual([38, 187, 7, 244, 201, 111, 164, 182, 250, 0]);

    const updated = await buildUpdateWokePaymentConfigInstruction(context, {
      authority: paymentAuthority,
      feeDestination,
      expectedPolicySequence: 7n,
      feeBasisPoints: 500,
      enabled: true,
    });
    expect(updated.accounts).toEqual([
      { address: golden.config, role: AccountRole.READONLY },
      { address: golden.paymentConfig, role: AccountRole.WRITABLE },
      { address: paymentAuthority, role: AccountRole.READONLY_SIGNER },
      { address: feeDestination, role: AccountRole.READONLY },
    ]);
    expect([...updated.data.slice(0, 8)]).toEqual([233, 162, 182, 43, 61, 208, 188, 169]);
    expect(readU64(updated.data, 8)).toBe(7n);
    expect([...updated.data.slice(16)]).toEqual([244, 1, 1]);

    const rotated = await buildRotateWokePaymentAuthorityInstruction(context, {
      currentAuthority: paymentAuthority,
      newAuthority: rotatedAuthority,
      expectedPolicySequence: 8n,
    });
    expect(rotated.accounts).toEqual([
      { address: golden.config, role: AccountRole.READONLY },
      { address: golden.paymentConfig, role: AccountRole.WRITABLE },
      { address: paymentAuthority, role: AccountRole.READONLY_SIGNER },
      { address: rotatedAuthority, role: AccountRole.READONLY_SIGNER },
    ]);
    expect([...rotated.data.slice(0, 8)]).toEqual([130, 220, 113, 212, 146, 91, 227, 218]);
    expect(readU64(rotated.data, 8)).toBe(8n);
  });

  it('builds create/retire offering instructions with sorted optional account pairs', async () => {
    const created = await buildCreateWokeSubscriptionOfferingInstruction(context, {
      creatorIdentity,
      rootAuthority: creatorDestination,
      payer: rentPayer,
      expectedCreatorSequence: 3n,
      offeringNonce: nonce,
      manifestHash,
      manifestUri: offeringManifestUri,
      priceLamports: 101n,
      refundPolicyHash: refundHash,
      maxProtocolFeeBasisPoints: 500,
      recipientSplits: subscriptionInput().recipientSplits,
    });

    expect(created.offeringAddress).toBe(golden.offering);
    expect(created.recipientSplits.map((split) => split.recipientIdentity)).toEqual([
      creatorIdentity,
      recipientIdentityA,
      recipientIdentityB,
    ]);
    expect(created.instruction.accounts).toEqual([
      { address: golden.config, role: AccountRole.READONLY },
      { address: golden.paymentConfig, role: AccountRole.READONLY },
      { address: creatorIdentity, role: AccountRole.WRITABLE },
      { address: golden.offering, role: AccountRole.WRITABLE },
      { address: creatorDestination, role: AccountRole.READONLY_SIGNER },
      { address: rentPayer, role: AccountRole.WRITABLE_SIGNER },
      { address: WOKENET_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: recipientIdentityA, role: AccountRole.READONLY },
      { address: recipientDestinationA, role: AccountRole.READONLY },
      { address: recipientIdentityB, role: AccountRole.READONLY },
      { address: recipientDestinationB, role: AccountRole.READONLY },
    ]);
    expect([...created.instruction.data.slice(0, 8)]).toEqual([
      176, 121, 188, 91, 87, 92, 113, 216,
    ]);
    expect(readU64(created.instruction.data, 8)).toBe(3n);
    expect(created.instruction.data.slice(16, 32)).toEqual(nonce);
    expect(created.instruction.data.slice(32, 64)).toEqual(manifestHash);
    expect(readU32(created.instruction.data, 64)).toBe(offeringManifestUri.length);
    const manifestUriEnd = 68 + offeringManifestUri.length;
    expect(new TextDecoder().decode(created.instruction.data.slice(68, manifestUriEnd))).toBe(
      offeringManifestUri,
    );
    expect(readU64(created.instruction.data, manifestUriEnd)).toBe(101n);

    const retired = await buildRetireWokeSubscriptionOfferingInstruction(context, {
      creatorIdentity,
      rootAuthority: creatorDestination,
      offeringNonce: nonce,
      expectedCreatorSequence: 4n,
      expectedOfferingStateSequence: 1n,
    });
    expect(retired.accounts).toEqual([
      { address: golden.config, role: AccountRole.READONLY },
      { address: creatorIdentity, role: AccountRole.WRITABLE },
      { address: golden.offering, role: AccountRole.WRITABLE },
      { address: creatorDestination, role: AccountRole.READONLY_SIGNER },
    ]);
    expect([...retired.data.slice(0, 8)]).toEqual([207, 71, 200, 23, 92, 151, 101, 99]);
    expect(readU64(retired.data, 8)).toBe(4n);
    expect(readU64(retired.data, 16)).toBe(1n);
  });

  it('emits readonly program-ID sentinels for every absent Anchor optional account', async () => {
    const creatorOnlySplits = [
      {
        recipientIdentity: creatorIdentity,
        destination: creatorDestination,
        basisPoints: 10_000,
      },
    ] as const;
    const twoRecipientSplits = [
      {
        recipientIdentity: creatorIdentity,
        destination: creatorDestination,
        basisPoints: 5_000,
      },
      {
        recipientIdentity: recipientIdentityA,
        destination: recipientDestinationA,
        basisPoints: 5_000,
      },
    ] as const;
    const optionalSentinel = {
      address: context.programAddress,
      role: AccountRole.READONLY,
    };
    const buildOffering = (recipientSplits: SettleWokeSubscriptionInput['recipientSplits']) =>
      buildCreateWokeSubscriptionOfferingInstruction(context, {
        creatorIdentity,
        rootAuthority: creatorDestination,
        payer: rentPayer,
        expectedCreatorSequence: 3n,
        offeringNonce: nonce,
        manifestHash,
        manifestUri: offeringManifestUri,
        priceLamports: 101n,
        refundPolicyHash: refundHash,
        maxProtocolFeeBasisPoints: 500,
        recipientSplits,
      });

    const [
      oneRecipientOffering,
      twoRecipientOffering,
      oneRecipientSettlement,
      twoRecipientSettlement,
    ] = await Promise.all([
      buildOffering(creatorOnlySplits),
      buildOffering(twoRecipientSplits),
      buildSettleWokeSubscriptionInstruction(context, {
        ...subscriptionInput(),
        recipientSplits: creatorOnlySplits,
      }),
      buildSettleWokeSubscriptionInstruction(context, {
        ...subscriptionInput(),
        recipientSplits: twoRecipientSplits,
      }),
    ]);

    expect(oneRecipientOffering.instruction.accounts.slice(7)).toEqual([
      optionalSentinel,
      optionalSentinel,
      optionalSentinel,
      optionalSentinel,
    ]);
    expect(twoRecipientOffering.instruction.accounts.slice(7)).toEqual([
      { address: recipientIdentityA, role: AccountRole.READONLY },
      { address: recipientDestinationA, role: AccountRole.READONLY },
      optionalSentinel,
      optionalSentinel,
    ]);
    expect(oneRecipientSettlement.instruction.accounts.slice(12)).toEqual([
      optionalSentinel,
      optionalSentinel,
      optionalSentinel,
      optionalSentinel,
    ]);
    expect(twoRecipientSettlement.instruction.accounts.slice(12)).toEqual([
      { address: recipientIdentityA, role: AccountRole.READONLY },
      { address: recipientDestinationA, role: AccountRole.WRITABLE },
      optionalSentinel,
      optionalSentinel,
    ]);
  });

  it('builds the exact send_woke_tip accounts, args, receipt PDA, and allocation', async () => {
    const built = await buildSendWokeTipInstruction(context, tipInput());

    expect(built.kind).toBe('woke-tip');
    expect(built.receiptAddress).toBe(golden.receipt);
    expect(built.receiptBump).toBe(255);
    expect(built.plan.asset).toBe('SOL');
    expect(built.plan.recipientAllocations[0]?.lamports).toBe(99n);
    expect(built.instruction.accounts).toEqual([
      { address: golden.config, role: AccountRole.READONLY },
      { address: golden.paymentConfig, role: AccountRole.READONLY },
      { address: payerIdentity, role: AccountRole.READONLY },
      { address: creatorIdentity, role: AccountRole.READONLY },
      { address: golden.receipt, role: AccountRole.WRITABLE },
      { address: payerAuthority, role: AccountRole.WRITABLE_SIGNER },
      { address: creatorDestination, role: AccountRole.WRITABLE },
      { address: feeDestination, role: AccountRole.WRITABLE },
      { address: rentPayer, role: AccountRole.WRITABLE_SIGNER },
      { address: WOKENET_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ]);
    expect([...built.instruction.data.slice(0, 8)]).toEqual([45, 180, 20, 31, 17, 4, 214, 17]);
    expect(built.instruction.data.slice(8, 24)).toEqual(nonce);
    expect(readU64(built.instruction.data, 24)).toBe(7n);
    expect(readU16(built.instruction.data, 32)).toBe(250);
    expect(bs58.encode(built.instruction.data.slice(34, 66))).toBe(feeDestination);
    expect(readU64(built.instruction.data, 66)).toBe(2n);
    expect(bs58.encode(built.instruction.data.slice(74, 106))).toBe(creatorIdentity);
    expect(bs58.encode(built.instruction.data.slice(106, 138))).toBe(creatorDestination);
    expect(readU64(built.instruction.data, 138)).toBe(101n);
  });

  it('builds settle_subscription with exact sorted optional pairs and snapshot sequence', async () => {
    const built = await buildSettleWokeSubscriptionInstruction(
      context,
      subscriptionInput({
        kind: 'existing',
        stateSequence: 8n,
        settlementCount: 3n,
        startedAtTimestamp: 500n,
        validUntilTimestamp: 2_000n,
      }),
    );

    expect(built.kind).toBe('weekly-subscription');
    expect(built.entitlementAddress).toBe(golden.entitlement);
    expect(built.entitlementBump).toBe(255);
    expect(built.plan.recipientAllocations.map((recipient) => recipient.lamports)).toEqual([
      49n,
      25n,
      25n,
    ]);
    expect(built.priorEntitlementStateSequence).toBe(8n);
    expect(built.priorSettlementCount).toBe(3n);
    expect(built.instruction.accounts).toEqual([
      { address: golden.config, role: AccountRole.READONLY },
      { address: golden.paymentConfig, role: AccountRole.READONLY },
      { address: payerIdentity, role: AccountRole.READONLY },
      { address: creatorIdentity, role: AccountRole.READONLY },
      { address: golden.offering, role: AccountRole.READONLY },
      { address: built.entitlementAddress, role: AccountRole.WRITABLE },
      { address: built.receiptAddress, role: AccountRole.WRITABLE },
      { address: payerAuthority, role: AccountRole.WRITABLE_SIGNER },
      { address: creatorDestination, role: AccountRole.WRITABLE },
      { address: feeDestination, role: AccountRole.WRITABLE },
      { address: rentPayer, role: AccountRole.WRITABLE_SIGNER },
      { address: WOKENET_SYSTEM_PROGRAM_ADDRESS, role: AccountRole.READONLY },
      { address: recipientIdentityA, role: AccountRole.READONLY },
      { address: recipientDestinationA, role: AccountRole.WRITABLE },
      { address: recipientIdentityB, role: AccountRole.READONLY },
      { address: recipientDestinationB, role: AccountRole.WRITABLE },
    ]);
    expect([...built.instruction.data.slice(0, 8)]).toEqual([140, 212, 22, 211, 219, 187, 4, 131]);
    expect(built.instruction.data.slice(8, 24)).toEqual(secondNonce);
    expect(readU64(built.instruction.data, 24)).toBe(7n);
    expect(readU16(built.instruction.data, 32)).toBe(250);
    expect(readU64(built.instruction.data, 66)).toBe(2n);
    expect(readU64(built.instruction.data, 74)).toBe(4n);
    expect(built.instruction.data.slice(82, 114)).toEqual(manifestHash);
    expect(built.instruction.data.slice(114, 146)).toEqual(refundHash);
    expect(readU64(built.instruction.data, 146)).toBe(101n);
    expect(readU64(built.instruction.data, 154)).toBe(8n);
  });

  it('rejects instruction snapshots the program would reject', async () => {
    await expect(
      buildRotateWokePaymentAuthorityInstruction(context, {
        currentAuthority: paymentAuthority,
        newAuthority: paymentAuthority,
        expectedPolicySequence: 1n,
      }),
    ).rejects.toMatchObject({ code: 'alias' });
    await expect(
      buildCreateWokeSubscriptionOfferingInstruction(context, {
        creatorIdentity,
        rootAuthority: creatorDestination,
        payer: rentPayer,
        expectedCreatorSequence: 1n,
        offeringNonce: nonce,
        manifestHash: zeroHash,
        manifestUri: 'javascript:alert(1)',
        priceLamports: 1n,
        refundPolicyHash: refundHash,
        maxProtocolFeeBasisPoints: 250,
        recipientSplits: [
          {
            recipientIdentity: creatorIdentity,
            destination: creatorDestination,
            basisPoints: 10_000,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: 'invalid-wire-value' });
    await expect(
      buildSettleWokeSubscriptionInstruction(
        context,
        subscriptionInput({
          kind: 'existing',
          stateSequence: 1n,
          settlementCount: 1n,
          startedAtTimestamp: 2_001n,
          validUntilTimestamp: 2_000n,
        }),
      ),
    ).rejects.toMatchObject({ code: 'invalid-wire-value' });
  });
});

describe('strict WOKE simulation verification', () => {
  it('accepts only the exact ordered System transfers and one correct tip event', async () => {
    const built = await buildSendWokeTipInstruction(context, tipInput());
    const simulation = tipSimulation(built);

    expect(() => assertWokePaymentSimulationMatches(built, simulation)).not.toThrow();
    expect(() =>
      assertWokePaymentSimulationMatches(built, {
        ...simulation,
        transfers: [...simulation.transfers].reverse(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'simulation-mismatch' }));
    expect(() =>
      assertWokePaymentSimulationMatches(built, {
        ...simulation,
        transfers: [
          ...simulation.transfers,
          {
            programAddress: WOKENET_SYSTEM_PROGRAM_ADDRESS,
            source: payerAuthority,
            destination: recipientDestinationA,
            lamports: 1n,
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'simulation-mismatch' }));
    expect(() =>
      assertWokePaymentSimulationMatches(built, {
        ...simulation,
        events: [
          simulation.events[0] as WokeTipSettledEvent,
          simulation.events[0] as WokeTipSettledEvent,
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid-event' }));
  });

  it('binds subscription simulation to context, plan, terms, event sequence, and one-week window', async () => {
    const built = await buildSettleWokeSubscriptionInstruction(
      context,
      subscriptionInput({
        kind: 'existing',
        stateSequence: 8n,
        settlementCount: 3n,
        startedAtTimestamp: 500n,
        validUntilTimestamp: 2_000n,
      }),
    );
    const simulation = subscriptionSimulation(built);

    expect(() => assertWokePaymentSimulationMatches(built, simulation)).not.toThrow();
    expect(() =>
      assertWokePaymentSimulationMatches(built, {
        ...simulation,
        genesisHash: key(220),
      }),
    ).toThrowError(expect.objectContaining({ code: 'context-mismatch' }));
    expect(() =>
      assertWokePaymentSimulationMatches(built, {
        ...simulation,
        events: [
          {
            ...(simulation.events[0] as WokeSubscriptionSettledEvent),
            entitlementUntilTimestamp: 606_799n,
          },
        ],
      }),
    ).toThrowError(WokePaymentError);
    expect(() =>
      assertWokePaymentSimulationMatches(built, {
        ...simulation,
        error: { InstructionError: [0, 'Custom'] },
      }),
    ).toThrowError(expect.objectContaining({ code: 'simulation-mismatch' }));

    const prepaid = await buildSettleWokeSubscriptionInstruction(
      context,
      subscriptionInput({
        kind: 'existing',
        stateSequence: 9n,
        settlementCount: 4n,
        startedAtTimestamp: 500n,
        validUntilTimestamp: 1_000n + 52n * 604_800n,
      }),
    );
    const prepaidSimulation = subscriptionSimulation(prepaid);
    const prepaidEvent = prepaidSimulation.events[0] as WokeSubscriptionSettledEvent;
    expect(() =>
      assertWokePaymentSimulationMatches(prepaid, {
        ...prepaidSimulation,
        events: [
          {
            ...prepaidEvent,
            entitlementFromTimestamp: prepaid.priorValidUntilTimestamp,
            entitlementUntilTimestamp: prepaid.priorValidUntilTimestamp + 604_800n,
          },
        ],
      }),
    ).toThrowError(WokePaymentError);
  });
});

describe('finalized WOKE receipt and entitlement proofs', () => {
  it('requests finalized context-bound data and verifies every tip receipt field', async () => {
    const built = await buildSendWokeTipInstruction(context, tipInput());
    const record = tipReceipt(built);
    const receiptAccount = finalizedAccount(built, built.receiptAddress, record, record.paidAtSlot);
    const readPaymentReceipt = vi.fn(async () => receiptAccount);
    const reader: WokePaymentAccountReader = {
      readPaymentReceipt,
      readSubscriptionEntitlement: async () => null,
    };

    await expect(verifyFinalizedWokeTipReceipt(built, reader)).resolves.toEqual({
      kind: 'woke-tip',
      receipt: receiptAccount,
    });
    expect(readPaymentReceipt).toHaveBeenCalledWith({
      ...expectedContext,
      address: built.receiptAddress,
      commitment: 'finalized',
    });

    const substituted = finalizedAccount(
      built,
      built.receiptAddress,
      { ...record, grossLamports: 100n },
      record.paidAtSlot,
    );
    await expect(
      verifyFinalizedWokeTipReceipt(built, {
        ...reader,
        readPaymentReceipt: async () => substituted,
      }),
    ).rejects.toMatchObject({ code: 'invalid-proof' });
  });

  it('requires matching finalized receipt and entitlement snapshots', async () => {
    const built = await buildSettleWokeSubscriptionInstruction(
      context,
      subscriptionInput({
        kind: 'existing',
        stateSequence: 8n,
        settlementCount: 3n,
        startedAtTimestamp: 500n,
        validUntilTimestamp: 2_000n,
      }),
    );
    const receipt = subscriptionReceipt(built);
    const entitlement = subscriptionEntitlement(built, receipt);
    const receiptAccount = finalizedAccount(built, built.receiptAddress, receipt, 78n);
    const entitlementAccount = finalizedAccount(built, built.entitlementAddress, entitlement, 78n);
    const reader: WokePaymentAccountReader = {
      readPaymentReceipt: async () => receiptAccount,
      readSubscriptionEntitlement: async () => entitlementAccount,
    };

    await expect(verifyFinalizedWokeSubscriptionProof(built, reader)).resolves.toEqual({
      kind: 'weekly-subscription',
      receipt: receiptAccount,
      entitlement: entitlementAccount,
    });

    await expect(
      verifyFinalizedWokeSubscriptionProof(built, {
        ...reader,
        readSubscriptionEntitlement: async () =>
          finalizedAccount(
            built,
            built.entitlementAddress,
            { ...entitlement, lastReceipt: key(222) },
            78n,
          ),
      }),
    ).rejects.toMatchObject({ code: 'invalid-proof' });
    await expect(
      verifyFinalizedWokeSubscriptionProof(built, {
        ...reader,
        readPaymentReceipt: async () => ({
          ...receiptAccount,
          genesisHash: key(223),
        }),
      }),
    ).rejects.toMatchObject({ code: 'context-mismatch' });
  });
});

function tipSimulation(built: BuiltWokeTipInstruction): WokePaymentSimulation {
  const allocation = built.plan.recipientAllocations[0];
  if (allocation === undefined) throw new Error('missing tip allocation');
  const event: WokeTipSettledEvent = {
    kind: 'woke-tip-settled',
    eventVersion: 1,
    config: built.configAddress,
    paymentConfig: built.paymentConfigAddress,
    receipt: built.receiptAddress,
    payerIdentity: built.plan.payerIdentity,
    payerAuthority: built.plan.payerAuthority,
    recipientIdentity: built.recipientIdentity,
    recipientDestination: built.recipientDestination,
    receiptNonce: built.receiptNonce,
    paymentKind: 'woke-tip',
    payerRootRotationCount: built.payerRootRotationCount,
    paymentPolicySequence: built.paymentPolicySequence,
    grossLamports: built.plan.grossLamports,
    feeBasisPoints: built.plan.feeBasisPoints,
    feeDestination: built.plan.feeDestination,
    feeLamports: built.plan.feeLamports,
    distributableLamports: built.plan.distributableLamports,
    recipientLamports: allocation.lamports,
    paidAtTimestamp: 1_000n,
    paidAtSlot: 77n,
  };
  return {
    source: 'simulateTransaction',
    ...expectedContext,
    error: null,
    transfers: built.plan.transfers.map((transfer) => ({
      programAddress: WOKENET_SYSTEM_PROGRAM_ADDRESS,
      source: transfer.source,
      destination: transfer.destination,
      lamports: transfer.lamports,
    })),
    events: [event],
  };
}

function subscriptionSimulation(
  built: BuiltWokeSubscriptionSettlementInstruction,
): WokePaymentSimulation {
  const event: WokeSubscriptionSettledEvent = {
    kind: 'subscription-settled',
    eventVersion: 1,
    config: built.configAddress,
    paymentConfig: built.paymentConfigAddress,
    offering: built.offeringAddress,
    receipt: built.receiptAddress,
    entitlement: built.entitlementAddress,
    creatorIdentity: built.creatorIdentity,
    payerIdentity: built.plan.payerIdentity,
    payerAuthority: built.plan.payerAuthority,
    receiptNonce: built.receiptNonce,
    paymentKind: 'weekly-subscription',
    payerRootRotationCount: built.payerRootRotationCount,
    paymentPolicySequence: built.paymentPolicySequence,
    offeringStateSequence: built.offeringStateSequence,
    offeringManifestHash: built.offeringManifestHash,
    refundPolicyHash: built.refundPolicyHash,
    grossLamports: built.plan.grossLamports,
    feeBasisPoints: built.plan.feeBasisPoints,
    feeDestination: built.plan.feeDestination,
    feeLamports: built.plan.feeLamports,
    distributableLamports: built.plan.distributableLamports,
    recipientSplits: built.plan.recipientAllocations.map(
      ({ recipientIdentity, destination, basisPoints }) => ({
        recipientIdentity,
        destination,
        basisPoints,
      }),
    ),
    recipientAmounts: built.plan.recipientAllocations.map(({ lamports }) => lamports),
    entitlementStateSequence: built.priorEntitlementStateSequence + 1n,
    settlementCount: built.priorSettlementCount + 1n,
    entitlementFromTimestamp: 2_000n,
    entitlementUntilTimestamp: 606_800n,
    paidAtTimestamp: 1_000n,
    paidAtSlot: 77n,
  };
  return {
    source: 'simulateTransaction',
    ...expectedContext,
    error: null,
    transfers: built.plan.transfers.map((transfer) => ({
      programAddress: WOKENET_SYSTEM_PROGRAM_ADDRESS,
      source: transfer.source,
      destination: transfer.destination,
      lamports: transfer.lamports,
    })),
    events: [event],
  };
}

function tipReceipt(built: BuiltWokeTipInstruction): WokePaymentReceiptRecord {
  const allocation = built.plan.recipientAllocations[0];
  if (allocation === undefined) throw new Error('missing tip allocation');
  return {
    version: 1,
    config: built.configAddress,
    paymentConfig: built.paymentConfigAddress,
    termsReference: built.recipientIdentity,
    payerIdentity: built.plan.payerIdentity,
    payerAuthority: built.plan.payerAuthority,
    subjectIdentity: built.recipientIdentity,
    primaryRecipientDestination: built.recipientDestination,
    feeDestination: built.plan.feeDestination,
    receiptNonce: built.receiptNonce,
    kind: 'woke-tip',
    paymentPolicySequence: built.paymentPolicySequence,
    termsStateSequence: 0n,
    termsManifestHash: zeroHash,
    payerRootRotationCount: built.payerRootRotationCount,
    grossLamports: built.plan.grossLamports,
    feeBasisPoints: built.plan.feeBasisPoints,
    feeLamports: built.plan.feeLamports,
    distributableLamports: built.plan.distributableLamports,
    recipientAmounts: [allocation.lamports],
    refundPolicyHash: zeroHash,
    entitlementFromTimestamp: 0n,
    entitlementUntilTimestamp: 0n,
    paidAtTimestamp: 1_000n,
    paidAtSlot: 77n,
    bump: built.receiptBump,
  };
}

function subscriptionReceipt(
  built: BuiltWokeSubscriptionSettlementInstruction,
): WokePaymentReceiptRecord {
  return {
    version: 1,
    config: built.configAddress,
    paymentConfig: built.paymentConfigAddress,
    termsReference: built.offeringAddress,
    payerIdentity: built.plan.payerIdentity,
    payerAuthority: built.plan.payerAuthority,
    subjectIdentity: built.plan.payerIdentity,
    primaryRecipientDestination: built.creatorDestination,
    feeDestination: built.plan.feeDestination,
    receiptNonce: built.receiptNonce,
    kind: 'weekly-subscription',
    paymentPolicySequence: built.paymentPolicySequence,
    termsStateSequence: built.offeringStateSequence,
    termsManifestHash: built.offeringManifestHash,
    payerRootRotationCount: built.payerRootRotationCount,
    grossLamports: built.plan.grossLamports,
    feeBasisPoints: built.plan.feeBasisPoints,
    feeLamports: built.plan.feeLamports,
    distributableLamports: built.plan.distributableLamports,
    recipientAmounts: built.plan.recipientAllocations.map(({ lamports }) => lamports),
    refundPolicyHash: built.refundPolicyHash,
    entitlementFromTimestamp: 2_000n,
    entitlementUntilTimestamp: 606_800n,
    paidAtTimestamp: 1_000n,
    paidAtSlot: 77n,
    bump: built.receiptBump,
  };
}

function subscriptionEntitlement(
  built: BuiltWokeSubscriptionSettlementInstruction,
  receipt: WokePaymentReceiptRecord,
): WokeSubscriptionEntitlementRecord {
  return {
    version: 1,
    config: built.configAddress,
    offering: built.offeringAddress,
    beneficiaryIdentity: built.plan.payerIdentity,
    startedAtTimestamp: built.priorStartedAtTimestamp ?? receipt.entitlementFromTimestamp,
    validUntilTimestamp: receipt.entitlementUntilTimestamp,
    settlementCount: built.priorSettlementCount + 1n,
    lastReceipt: built.receiptAddress,
    stateSequence: built.priorEntitlementStateSequence + 1n,
    lastSettledAtSlot: receipt.paidAtSlot,
    refundPolicyHash: built.refundPolicyHash,
    bump: built.entitlementBump,
  };
}

function finalizedAccount<T>(
  built: BuiltWokeTipInstruction | BuiltWokeSubscriptionSettlementInstruction,
  accountAddress: string,
  data: T,
  slot: bigint,
): WokeFinalizedAccount<T> {
  return {
    ...expectedContext,
    address: accountAddress,
    commitment: 'finalized',
    owner: built.context.programAddress,
    slot,
    data,
  };
}

function readU16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    (data[offset] ?? 0) |
    ((data[offset + 1] ?? 0) << 8) |
    ((data[offset + 2] ?? 0) << 16) |
    ((data[offset + 3] ?? 0) << 24)
  );
}

function readU64(data: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(data[offset + index] ?? 0);
  }
  return value;
}
