import bs58 from 'bs58';

import { encodeMultibaseBase64Url, type NetworkId } from '@wokesocial/protocol';

import {
  calculatePaymentAllocation,
  derivePaymentConfigAddress,
  derivePaymentReceiptAddress,
  deriveSubscriptionEntitlementAddress,
  deriveSubscriptionOfferingAddress,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  WEEK_SECONDS,
  type PaymentAuthorityRotatedEvent,
  type PaymentConfigInitializedEvent,
  type PaymentConfigUpdatedEvent,
  type ProtocolEvent,
  type SubscriptionOfferingCreatedEvent,
  type SubscriptionOfferingRetiredEvent,
  type SubscriptionSettledEvent,
  type WokeTipSettledEvent,
} from '../src/index.js';

export interface PaymentFixtureOptions {
  readonly genesisSeed?: number;
  readonly coordinateSeed?: number;
}

export async function createPaymentFixture(options: PaymentFixtureOptions = {}) {
  const programId = SOCIAL_PROTOCOL_EVENT_LAYOUT.programId;
  const networkId = `wokenet:v1:${publicKey(options.genesisSeed ?? 1)}:${programId}` as NetworkId;
  const coordinateSeed = options.coordinateSeed ?? 0;
  const configAddress = publicKey(2);
  const creatorAddress = publicKey(10);
  const splitRecipientAddress = publicKey(20);
  const payerAddress = publicKey(30);
  const creatorIdentityId = identityId(networkId, creatorAddress);
  const splitRecipientIdentityId = identityId(networkId, splitRecipientAddress);
  const payerIdentityId = identityId(networkId, payerAddress);
  const creatorRoot = publicKey(41);
  const splitRecipientRoot = publicKey(42);
  const payerRoot = publicKey(43);
  const feeDestination = publicKey(60);
  const paymentAuthority = publicKey(61);
  const rotatedPaymentAuthority = publicKey(62);
  const upgradeAuthority = publicKey(63);
  const offeringNonce = bytes(16, 80);
  const tipReceiptNonce = bytes(16, 100);
  const subscriptionReceiptNonce = bytes(16, 120);
  const renewalReceiptNonce = bytes(16, 140);
  const manifestBytes = bytes(32, 160);
  const refundPolicyBytes = bytes(32, 190);
  const manifestHash = encodeMultibaseBase64Url(manifestBytes);
  const refundPolicyHash = encodeMultibaseBase64Url(refundPolicyBytes);
  const paymentConfigAddress = await derivePaymentConfigAddress(programId);
  const offeringAddress = await deriveSubscriptionOfferingAddress(
    programId,
    creatorAddress,
    offeringNonce,
  );
  const tipReceiptAddress = await derivePaymentReceiptAddress(
    programId,
    payerAddress,
    tipReceiptNonce,
  );
  const subscriptionReceiptAddress = await derivePaymentReceiptAddress(
    programId,
    payerAddress,
    subscriptionReceiptNonce,
  );
  const renewalReceiptAddress = await derivePaymentReceiptAddress(
    programId,
    payerAddress,
    renewalReceiptNonce,
  );
  const entitlementAddress = await deriveSubscriptionEntitlementAddress(
    programId,
    offeringAddress,
    payerAddress,
  );
  const recipientSplits = [
    {
      recipientIdentityId: creatorIdentityId,
      recipientIdentityAddress: creatorAddress,
      destination: creatorRoot,
      basisPoints: 5_000,
    },
    {
      recipientIdentityId: splitRecipientIdentityId,
      recipientIdentityAddress: splitRecipientAddress,
      destination: splitRecipientRoot,
      basisPoints: 5_000,
    },
  ] as const;
  const priceLamports = 102n;
  const feeBps = 100;
  const subscriptionAllocation = calculatePaymentAllocation(priceLamports, feeBps, recipientSplits);
  const tipAllocation = calculatePaymentAllocation(101n, feeBps, [
    {
      recipientIdentityId: creatorIdentityId,
      recipientIdentityAddress: creatorAddress,
      destination: creatorRoot,
      basisPoints: 10_000,
    },
  ]);
  const paidAtTimestamp = 1_800_000_000n;
  const renewalPaidAtTimestamp = paidAtTimestamp + 60n;
  const entitlementUntilTimestamp = paidAtTimestamp + WEEK_SECONDS;
  const renewalEntitlementUntilTimestamp = entitlementUntilTimestamp + WEEK_SECONDS;

  const eventBase = (slot: bigint) => ({
    networkId,
    programId,
    transactionSignature: signature(coordinateSeed + 100 + Number(slot)),
    transactionIndex: coordinateSeed + Number(slot),
    slot,
    logIndex: 0,
    blockTime: new Date(Date.UTC(2026, 6, 28, 20, 0, Number(slot))).toISOString(),
    finalized: true as const,
  });

  const protocolInitialized = {
    ...eventBase(1n),
    type: 'protocol-initialized',
    configAddress,
  } satisfies ProtocolEvent;
  const creatorIdentityCreated = {
    ...eventBase(2n),
    type: 'identity-created',
    identityId: creatorIdentityId,
    identityAddress: creatorAddress,
    rootAuthority: creatorRoot,
  } satisfies ProtocolEvent;
  const splitRecipientIdentityCreated = {
    ...eventBase(3n),
    type: 'identity-created',
    identityId: splitRecipientIdentityId,
    identityAddress: splitRecipientAddress,
    rootAuthority: splitRecipientRoot,
  } satisfies ProtocolEvent;
  const payerIdentityCreated = {
    ...eventBase(4n),
    type: 'identity-created',
    identityId: payerIdentityId,
    identityAddress: payerAddress,
    rootAuthority: payerRoot,
  } satisfies ProtocolEvent;
  const paymentConfigInitialized = {
    ...eventBase(5n),
    type: 'payment-config-initialized',
    paymentConfigAddress,
    upgradeAuthority,
    paymentAuthority,
    feeDestination,
    feeBps,
    policySequence: 1n,
    enabled: false,
  } satisfies PaymentConfigInitializedEvent;
  const paymentConfigUpdated = {
    ...eventBase(6n),
    type: 'payment-config-updated',
    paymentConfigAddress,
    authority: paymentAuthority,
    previousFeeDestination: feeDestination,
    feeDestination,
    previousFeeBps: feeBps,
    feeBps,
    previousEnabled: false,
    enabled: true,
    policySequence: 2n,
  } satisfies PaymentConfigUpdatedEvent;
  const paymentAuthorityRotated = {
    ...eventBase(7n),
    type: 'payment-authority-rotated',
    paymentConfigAddress,
    previousAuthority: paymentAuthority,
    newAuthority: rotatedPaymentAuthority,
    policySequence: 3n,
  } satisfies PaymentAuthorityRotatedEvent;
  const subscriptionOfferingCreated = {
    ...eventBase(8n),
    type: 'subscription-offering-created',
    paymentConfigAddress,
    offeringAddress,
    creatorIdentityId,
    rootAuthority: creatorRoot,
    offeringNonce: Buffer.from(offeringNonce).toString('hex'),
    manifestHash,
    manifestUri: 'ipfs://payment-offering',
    priceLamports,
    billingInterval: 'week',
    recipientSplits: recipientSplits.map(({ recipientIdentityId, destination, basisPoints }) => ({
      recipientIdentityId,
      destination,
      basisPoints,
    })),
    refundPolicyHash,
    maxProtocolFeeBps: feeBps,
    creatorRootRotationCount: 0n,
    creatorSequence: 1n,
    offeringStateSequence: 1n,
  } satisfies SubscriptionOfferingCreatedEvent;
  const wokeTipSettled = {
    ...eventBase(9n),
    type: 'woke-tip-settled',
    paymentConfigAddress,
    receiptAddress: tipReceiptAddress,
    payerIdentityId,
    payerAuthority: payerRoot,
    recipientIdentityId: creatorIdentityId,
    recipientDestination: creatorRoot,
    receiptNonce: Buffer.from(tipReceiptNonce).toString('hex'),
    paymentKind: 'woke-tip',
    payerRootRotationCount: 0n,
    paymentPolicySequence: 3n,
    grossLamports: 101n,
    feeBps,
    feeDestination,
    feeLamports: tipAllocation.feeLamports,
    distributableLamports: tipAllocation.distributableLamports,
    recipientLamports: tipAllocation.recipientAmounts[0] as bigint,
    paidAtTimestamp: paidAtTimestamp - 60n,
  } satisfies WokeTipSettledEvent;
  const subscriptionSettled = {
    ...eventBase(10n),
    type: 'subscription-settled',
    paymentConfigAddress,
    offeringAddress,
    receiptAddress: subscriptionReceiptAddress,
    entitlementAddress,
    creatorIdentityId,
    payerIdentityId,
    payerAuthority: payerRoot,
    receiptNonce: Buffer.from(subscriptionReceiptNonce).toString('hex'),
    paymentKind: 'weekly-subscription',
    payerRootRotationCount: 0n,
    paymentPolicySequence: 3n,
    offeringStateSequence: 1n,
    offeringManifestHash: manifestHash,
    refundPolicyHash,
    grossLamports: priceLamports,
    feeBps,
    feeDestination,
    feeLamports: subscriptionAllocation.feeLamports,
    distributableLamports: subscriptionAllocation.distributableLamports,
    recipientSplits: subscriptionOfferingCreated.recipientSplits,
    recipientAmounts: [...subscriptionAllocation.recipientAmounts],
    entitlementStateSequence: 1n,
    settlementCount: 1n,
    entitlementFromTimestamp: paidAtTimestamp,
    entitlementUntilTimestamp,
    paidAtTimestamp,
  } satisfies SubscriptionSettledEvent;
  const subscriptionRenewed = {
    ...eventBase(11n),
    type: 'subscription-settled',
    paymentConfigAddress,
    offeringAddress,
    receiptAddress: renewalReceiptAddress,
    entitlementAddress,
    creatorIdentityId,
    payerIdentityId,
    payerAuthority: payerRoot,
    receiptNonce: Buffer.from(renewalReceiptNonce).toString('hex'),
    paymentKind: 'weekly-subscription',
    payerRootRotationCount: 0n,
    paymentPolicySequence: 3n,
    offeringStateSequence: 1n,
    offeringManifestHash: manifestHash,
    refundPolicyHash,
    grossLamports: priceLamports,
    feeBps,
    feeDestination,
    feeLamports: subscriptionAllocation.feeLamports,
    distributableLamports: subscriptionAllocation.distributableLamports,
    recipientSplits: subscriptionOfferingCreated.recipientSplits,
    recipientAmounts: [...subscriptionAllocation.recipientAmounts],
    entitlementStateSequence: 2n,
    settlementCount: 2n,
    entitlementFromTimestamp: entitlementUntilTimestamp,
    entitlementUntilTimestamp: renewalEntitlementUntilTimestamp,
    paidAtTimestamp: renewalPaidAtTimestamp,
  } satisfies SubscriptionSettledEvent;
  const subscriptionOfferingRetired = {
    ...eventBase(12n),
    type: 'subscription-offering-retired',
    offeringAddress,
    creatorIdentityId,
    rootAuthority: creatorRoot,
    manifestHash,
    creatorSequence: 2n,
    offeringStateSequence: 2n,
  } satisfies SubscriptionOfferingRetiredEvent;
  const events: readonly ProtocolEvent[] = [
    protocolInitialized,
    creatorIdentityCreated,
    splitRecipientIdentityCreated,
    payerIdentityCreated,
    paymentConfigInitialized,
    paymentConfigUpdated,
    paymentAuthorityRotated,
    subscriptionOfferingCreated,
    wokeTipSettled,
    subscriptionSettled,
    subscriptionRenewed,
    subscriptionOfferingRetired,
  ];

  return {
    programId,
    networkId,
    configAddress,
    creatorAddress,
    splitRecipientAddress,
    payerAddress,
    creatorIdentityId,
    splitRecipientIdentityId,
    payerIdentityId,
    creatorRoot,
    splitRecipientRoot,
    payerRoot,
    feeDestination,
    paymentAuthority,
    rotatedPaymentAuthority,
    upgradeAuthority,
    offeringNonce,
    tipReceiptNonce,
    subscriptionReceiptNonce,
    renewalReceiptNonce,
    manifestBytes,
    refundPolicyBytes,
    manifestHash,
    refundPolicyHash,
    paymentConfigAddress,
    offeringAddress,
    tipReceiptAddress,
    subscriptionReceiptAddress,
    renewalReceiptAddress,
    entitlementAddress,
    recipientSplits,
    priceLamports,
    feeBps,
    subscriptionAllocation,
    tipAllocation,
    paidAtTimestamp,
    renewalPaidAtTimestamp,
    entitlementUntilTimestamp,
    renewalEntitlementUntilTimestamp,
    eventBase,
    protocolInitialized,
    creatorIdentityCreated,
    splitRecipientIdentityCreated,
    payerIdentityCreated,
    paymentConfigInitialized,
    paymentConfigUpdated,
    paymentAuthorityRotated,
    subscriptionOfferingCreated,
    wokeTipSettled,
    subscriptionSettled,
    subscriptionRenewed,
    subscriptionOfferingRetired,
    events,
  };
}

export function identityId(networkId: NetworkId, identityAddress: string): string {
  return `wokesocialid:v1:${networkId}:${identityAddress}`;
}

export function signature(seed: number): string {
  return bs58.encode(bytes(64, seed));
}

export function publicKey(seed: number): string {
  return bs58.encode(bytes(32, seed));
}

export function bytes(length: number, seed: number): Uint8Array {
  return Uint8Array.from({ length }, (_, index) => (seed + index) % 256);
}
