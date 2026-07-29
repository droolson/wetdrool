import bs58 from 'bs58';
import { describe, expect, it } from 'vitest';

import type { NetworkId } from '@wokesocial/protocol';
import { MemoryContentAddressedStorage } from '@wokesocial/storage';

import {
  AnchorEventDecodingError,
  buildIndexerApp,
  calculatePaymentAllocation,
  calculateSubscriptionWindow,
  decodeAnchorEventLog,
  derivePaymentReceiptAddress,
  ManifestVerifier,
  MemoryProjectionStore,
  openApiDocument,
  OpenIndexer,
  SOCIAL_PROTOCOL_EVENT_LAYOUT,
  SolanaEventMaterializer,
  WEEK_SECONDS,
  type SolanaEventMaterializationError,
} from '../src/index.js';
import { bytes, createPaymentFixture, publicKey, signature } from './payment-fixtures.js';

describe('payment Anchor events', () => {
  it('strictly decodes and materializes all seven final IDL event layouts', async () => {
    const fixture = await createPaymentFixture();
    const projection = new MemoryProjectionStore();
    await projection.apply(fixture.protocolInitialized);
    const materializer = new SolanaEventMaterializer(
      new MemoryContentAddressedStorage(),
      projection,
    );
    const cases = paymentAnchorCases(fixture);

    expect(Object.keys(SOCIAL_PROTOCOL_EVENT_LAYOUT.events)).toHaveLength(33);
    for (const [index, item] of cases.entries()) {
      const decoded = decodeAnchorEventLog(item.encoded);
      expect(decoded.kind).toBe(item.kind);
      await expect(
        materializer.materialize(decoded, materializationContext(fixture, item.slot, 300 + index)),
      ).resolves.toMatchObject({ type: item.kind });
    }
  });

  it('rejects enum drift, trailing bytes, slot drift, and substituted payment PDAs', async () => {
    const fixture = await createPaymentFixture();
    const projection = new MemoryProjectionStore();
    await projection.apply(fixture.protocolInitialized);
    const materializer = new SolanaEventMaterializer(
      new MemoryContentAddressedStorage(),
      projection,
    );
    const cases = paymentAnchorCases(fixture);
    const tip = cases.find((item) => item.kind === 'woke-tip-settled');
    const offering = cases.find((item) => item.kind === 'subscription-offering-created');
    const subscription = cases.find((item) => item.kind === 'subscription-settled');
    if (tip === undefined || offering === undefined || subscription === undefined) {
      throw new Error('Payment Anchor fixtures are incomplete.');
    }

    const trailing = Buffer.concat([Buffer.from(tip.encoded, 'base64'), Buffer.from([0])]).toString(
      'base64',
    );
    expect(() => decodeAnchorEventLog(trailing)).toThrow(/trailing bytes/u);
    expect(() => decodeAnchorEventLog(paymentTipAnchorEvent(fixture, { paymentKind: 1 }))).toThrow(
      AnchorEventDecodingError,
    );

    await expect(
      materializer.materialize(
        decodeAnchorEventLog(paymentConfigInitializedAnchorEvent(fixture, publicKey(210))),
        materializationContext(fixture, 5n, 321),
      ),
    ).rejects.toMatchObject({
      code: 'account-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(
          subscriptionOfferingAnchorEvent(fixture, { offeringAddress: publicKey(211) }),
        ),
        materializationContext(fixture, 8n, 322),
      ),
    ).rejects.toMatchObject({
      code: 'account-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(paymentTipAnchorEvent(fixture, { receiptAddress: publicKey(212) })),
        materializationContext(fixture, 9n, 323),
      ),
    ).rejects.toMatchObject({
      code: 'account-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(
          subscriptionSettlementAnchorEvent(fixture, {
            entitlementAddress: publicKey(213),
          }),
        ),
        materializationContext(fixture, 10n, 324),
      ),
    ).rejects.toMatchObject({
      code: 'account-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
    await expect(
      materializer.materialize(
        decodeAnchorEventLog(tip.encoded),
        materializationContext(fixture, 10n, 325),
      ),
    ).rejects.toMatchObject({
      code: 'slot-mismatch',
    } satisfies Partial<SolanaEventMaterializationError>);
  });
});

describe('payment projection', () => {
  it('enforces helper-level key, nonce, integer, and timestamp boundaries', async () => {
    const fixture = await createPaymentFixture();
    expect(
      calculatePaymentAllocation(3n, 0, [
        {
          recipientIdentityId: fixture.creatorIdentityId,
          recipientIdentityAddress: fixture.creatorAddress,
          destination: fixture.creatorRoot,
          basisPoints: 5_000,
        },
        {
          recipientIdentityId: fixture.splitRecipientIdentityId,
          recipientIdentityAddress: fixture.splitRecipientAddress,
          destination: fixture.splitRecipientRoot,
          basisPoints: 5_000,
        },
      ]),
    ).toEqual({
      feeLamports: 0n,
      distributableLamports: 3n,
      recipientAmounts: [2n, 1n],
    });
    expect(() =>
      calculatePaymentAllocation(1n, 0, [
        {
          recipientIdentityId: fixture.creatorIdentityId,
          recipientIdentityAddress: 'abc',
          destination: fixture.creatorRoot,
          basisPoints: 10_000,
        },
      ]),
    ).toThrow(/exactly 32 bytes/u);
    expect(() =>
      calculatePaymentAllocation(18_446_744_073_709_551_616n, 0, [
        {
          recipientIdentityId: fixture.creatorIdentityId,
          recipientIdentityAddress: fixture.creatorAddress,
          destination: fixture.creatorRoot,
          basisPoints: 10_000,
        },
      ]),
    ).toThrow(/positive u64/u);
    await expect(
      derivePaymentReceiptAddress(fixture.programId, fixture.payerAddress, bytes(16, 0).fill(0)),
    ).rejects.toThrow(/cannot be zero/u);
    expect(() =>
      calculateSubscriptionWindow(9_223_372_036_854_775_807n, 9_223_372_036_854_775_807n),
    ).toThrow(/timestamp range/u);
  });

  it('projects config, offerings, permanent receipts, renewal state, and Hamilton residuals', async () => {
    const fixture = await createPaymentFixture();
    const projection = new MemoryProjectionStore();
    const indexer = createIndexer(projection);

    for (const event of fixture.events) {
      await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
    }
    await expect(indexer.ingest(fixture.subscriptionRenewed)).resolves.toMatchObject({
      applied: false,
    });

    expect(fixture.subscriptionAllocation).toEqual({
      feeLamports: 1n,
      distributableLamports: 101n,
      recipientAmounts: [51n, 50n],
    });
    await expect(projection.getPaymentConfig(fixture.networkId)).resolves.toMatchObject({
      paymentConfigAddress: fixture.paymentConfigAddress,
      authority: fixture.rotatedPaymentAuthority,
      policySequence: 3n,
      enabled: true,
      transactionSignature: fixture.paymentAuthorityRotated.transactionSignature,
      logIndex: 0,
    });
    await expect(
      projection.getSubscriptionOffering(fixture.networkId, fixture.offeringAddress),
    ).resolves.toMatchObject({
      creatorIdentityId: fixture.creatorIdentityId,
      stateSequence: 2n,
      active: false,
      retiredSlot: 12n,
      recipientSplits: [
        {
          recipientIdentityId: fixture.creatorIdentityId,
          destination: fixture.creatorRoot,
          basisPoints: 5_000,
        },
        {
          recipientIdentityId: fixture.splitRecipientIdentityId,
          destination: fixture.splitRecipientRoot,
          basisPoints: 5_000,
        },
      ],
    });
    await expect(
      projection.getPaymentReceipt(fixture.networkId, fixture.tipReceiptAddress),
    ).resolves.toMatchObject({
      paymentKind: 'woke-tip',
      termsStateSequence: 0n,
      grossLamports: 101n,
      recipientAmounts: [100n],
      transactionSignature: fixture.wokeTipSettled.transactionSignature,
    });
    await expect(
      projection.getPaymentReceipt(fixture.networkId, fixture.subscriptionReceiptAddress),
    ).resolves.toMatchObject({
      paymentKind: 'weekly-subscription',
      termsReference: fixture.offeringAddress,
      recipientAmounts: [51n, 50n],
      entitlementFromTimestamp: fixture.paidAtTimestamp,
      entitlementUntilTimestamp: fixture.entitlementUntilTimestamp,
    });
    await expect(
      projection.getPaymentReceipt(fixture.networkId, fixture.renewalReceiptAddress),
    ).resolves.toMatchObject({
      paymentKind: 'weekly-subscription',
      entitlementFromTimestamp: fixture.entitlementUntilTimestamp,
      entitlementUntilTimestamp: fixture.renewalEntitlementUntilTimestamp,
    });
    await expect(
      projection.getSubscriptionEntitlement(fixture.networkId, fixture.entitlementAddress),
    ).resolves.toMatchObject({
      beneficiaryIdentityId: fixture.payerIdentityId,
      settlementCount: 2n,
      stateSequence: 2n,
      lastReceiptAddress: fixture.renewalReceiptAddress,
      validUntilTimestamp: fixture.renewalEntitlementUntilTimestamp,
      transactionSignature: fixture.subscriptionRenewed.transactionSignature,
    });
  });

  it('isolates identical payment addresses and nonces by exact network', async () => {
    const first = await createPaymentFixture({ genesisSeed: 1 });
    const second = await createPaymentFixture({ genesisSeed: 201 });
    const projection = new MemoryProjectionStore();
    const indexer = createIndexer(projection);

    for (const event of [...first.events, ...second.events]) {
      await indexer.ingest(event);
    }

    expect(second.paymentConfigAddress).toBe(first.paymentConfigAddress);
    expect(second.offeringAddress).toBe(first.offeringAddress);
    expect(second.subscriptionReceiptAddress).toBe(first.subscriptionReceiptAddress);
    expect(second.entitlementAddress).toBe(first.entitlementAddress);
    await expect(projection.getPaymentConfig(first.networkId)).resolves.toMatchObject({
      networkId: first.networkId,
    });
    await expect(projection.getPaymentConfig(second.networkId)).resolves.toMatchObject({
      networkId: second.networkId,
    });
    await expect(
      projection.getPaymentReceipt(first.networkId, first.subscriptionReceiptAddress),
    ).resolves.toMatchObject({
      networkId: first.networkId,
      payerIdentityId: first.payerIdentityId,
    });
    await expect(
      projection.getPaymentReceipt(second.networkId, second.subscriptionReceiptAddress),
    ).resolves.toMatchObject({
      networkId: second.networkId,
      payerIdentityId: second.payerIdentityId,
    });
    await expect(
      projection.getPaymentReceipt(second.networkId, first.tipReceiptAddress),
    ).resolves.toMatchObject({ networkId: second.networkId });
    await expect(
      projection.getSubscriptionOfferingsByCreator(first.networkId, first.creatorIdentityId),
    ).resolves.toHaveLength(1);
    await expect(
      projection.getSubscriptionOfferingsByCreator(second.networkId, first.creatorIdentityId),
    ).resolves.toHaveLength(0);
  });

  it('fails closed on replay conflicts, substitution, stale sequences, and invalid windows', async () => {
    const fixture = await createPaymentFixture();
    const projection = new MemoryProjectionStore();
    const indexer = createIndexer(projection);

    for (const event of fixture.events.slice(0, 5)) {
      await indexer.ingest(event);
    }
    await expect(
      indexer.ingest({
        ...fixture.paymentConfigUpdated,
        transactionSignature: signature(230),
        transactionIndex: 230,
        policySequence: 3n,
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });
    await indexer.ingest(fixture.paymentConfigUpdated);
    await indexer.ingest(fixture.paymentAuthorityRotated);

    await expect(
      indexer.ingest({
        ...fixture.subscriptionOfferingCreated,
        transactionSignature: signature(231),
        transactionIndex: 231,
        offeringAddress: publicKey(231),
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });
    await expect(
      projection.getSubscriptionOffering(fixture.networkId, publicKey(231)),
    ).resolves.toBeUndefined();
    await indexer.ingest(fixture.subscriptionOfferingCreated);

    await expect(indexer.ingest(fixture.wokeTipSettled)).resolves.toMatchObject({
      applied: true,
    });
    await expect(indexer.ingest(fixture.wokeTipSettled)).resolves.toMatchObject({
      applied: false,
    });
    await expect(
      indexer.ingest({
        ...fixture.wokeTipSettled,
        blockTime: new Date(Date.parse(fixture.wokeTipSettled.blockTime) + 1_000).toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'event-conflict' });
    await expect(
      indexer.ingest({
        ...fixture.wokeTipSettled,
        transactionSignature: signature(232),
        transactionIndex: 232,
        receiptAddress: publicKey(232),
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });

    await expect(
      indexer.ingest({
        ...fixture.subscriptionSettled,
        transactionSignature: signature(233),
        transactionIndex: 233,
        entitlementStateSequence: 2n,
        settlementCount: 2n,
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });
    await expect(
      indexer.ingest({
        ...fixture.subscriptionSettled,
        transactionSignature: signature(234),
        transactionIndex: 234,
        recipientAmounts: [50n, 51n],
      }),
    ).rejects.toThrow(/Hamilton allocation/u);
    await indexer.ingest(fixture.subscriptionSettled);
    await expect(
      indexer.ingest({
        ...fixture.subscriptionRenewed,
        transactionSignature: signature(235),
        transactionIndex: 235,
        entitlementFromTimestamp: fixture.renewalPaidAtTimestamp,
        entitlementUntilTimestamp: fixture.renewalPaidAtTimestamp + WEEK_SECONDS,
      }),
    ).rejects.toMatchObject({ code: 'stale-event' });
    await indexer.ingest(fixture.subscriptionRenewed);

    await expect(
      projection.getSubscriptionEntitlement(fixture.networkId, fixture.entitlementAddress),
    ).resolves.toMatchObject({
      stateSequence: 2n,
      settlementCount: 2n,
      validUntilTimestamp: fixture.renewalEntitlementUntilTimestamp,
    });
    expect(() =>
      calculateSubscriptionWindow(
        fixture.paidAtTimestamp,
        fixture.paidAtTimestamp + WEEK_SECONDS * 52n,
      ),
    ).toThrow(/52 weeks/u);
  });
});

describe('payment HTTP contract', () => {
  it('serves exact-network projections with recursive bigint encoding and no inferred success', async () => {
    const fixture = await createPaymentFixture();
    const projection = new MemoryProjectionStore();
    const indexer = createIndexer(projection);
    for (const event of fixture.events) {
      await indexer.ingest(event);
    }
    const app = await buildIndexerApp({ projection, logger: false });

    try {
      expect(openApiDocument.paths).toHaveProperty('/v1/payments/config');
      expect(openApiDocument.paths).toHaveProperty('/v1/payments/offerings/{offeringAddress}');
      expect(openApiDocument.paths).toHaveProperty('/v1/payments/receipts/{receiptAddress}');
      expect(openApiDocument.paths).toHaveProperty(
        '/v1/payments/entitlements/{entitlementAddress}',
      );
      const configResponse = await app.inject({
        method: 'GET',
        url: `/v1/payments/config?network=${fixture.networkId}`,
      });
      expect(configResponse.statusCode).toBe(200);
      expect(configResponse.json()).toMatchObject({
        canonical: false,
        paymentConfig: { policySequence: '3' },
      });

      const offeringResponse = await app.inject({
        method: 'GET',
        url: `/v1/payments/offerings/${fixture.offeringAddress}?network=${fixture.networkId}`,
      });
      expect(offeringResponse.statusCode).toBe(200);
      expect(offeringResponse.json()).toMatchObject({
        offering: {
          priceLamports: '102',
          stateSequence: '2',
          recipientSplits: [{ basisPoints: 5_000 }, { basisPoints: 5_000 }],
        },
      });

      const listResponse = await app.inject({
        method: 'GET',
        url:
          `/v1/payments/identities/${fixture.creatorIdentityId}/offerings` +
          `?network=${fixture.networkId}`,
      });
      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toMatchObject({
        creatorIdentityId: fixture.creatorIdentityId,
        offerings: [{ offeringAddress: fixture.offeringAddress }],
      });

      const receiptResponse = await app.inject({
        method: 'GET',
        url:
          `/v1/payments/receipts/${fixture.subscriptionReceiptAddress}` +
          `?network=${fixture.networkId}`,
      });
      expect(receiptResponse.statusCode).toBe(200);
      const receiptBody = receiptResponse.json();
      expect(receiptBody).toMatchObject({
        canonical: false,
        settlementOutcomeInferred: false,
        receipt: {
          grossLamports: '102',
          recipientAmounts: ['51', '50'],
          paymentKind: 'weekly-subscription',
        },
      });
      expect(receiptBody).not.toHaveProperty('success');
      expect(receiptBody.receipt).not.toHaveProperty('success');

      const entitlementResponse = await app.inject({
        method: 'GET',
        url:
          `/v1/payments/entitlements/${fixture.entitlementAddress}` +
          `?network=${fixture.networkId}`,
      });
      expect(entitlementResponse.statusCode).toBe(200);
      expect(entitlementResponse.json()).toMatchObject({
        canonical: false,
        currentEligibilityEvaluated: false,
        entitlement: {
          settlementCount: '2',
          validUntilTimestamp: fixture.renewalEntitlementUntilTimestamp.toString(),
        },
      });

      const wrongNetwork = `wokenet:v1:${publicKey(220)}:${fixture.programId}` as NetworkId;
      const wrongNetworkResponse = await app.inject({
        method: 'GET',
        url:
          `/v1/payments/receipts/${fixture.subscriptionReceiptAddress}` +
          `?network=${wrongNetwork}`,
      });
      expect(wrongNetworkResponse.statusCode).toBe(404);
      const mismatchedIdentityResponse = await app.inject({
        method: 'GET',
        url:
          `/v1/payments/identities/${fixture.creatorIdentityId}/offerings` +
          `?network=${wrongNetwork}`,
      });
      expect(mismatchedIdentityResponse.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });
});

function createIndexer(projection: MemoryProjectionStore): OpenIndexer {
  return new OpenIndexer(
    projection,
    new ManifestVerifier(new MemoryContentAddressedStorage(), {
      authorize: () => Promise.resolve(false),
    }),
  );
}

type PaymentFixture = Awaited<ReturnType<typeof createPaymentFixture>>;

function paymentAnchorCases(fixture: PaymentFixture) {
  return [
    {
      kind: 'payment-config-initialized',
      slot: 5n,
      encoded: paymentConfigInitializedAnchorEvent(fixture),
    },
    {
      kind: 'payment-config-updated',
      slot: 6n,
      encoded: paymentConfigUpdatedAnchorEvent(fixture),
    },
    {
      kind: 'payment-authority-rotated',
      slot: 7n,
      encoded: paymentAuthorityRotatedAnchorEvent(fixture),
    },
    {
      kind: 'subscription-offering-created',
      slot: 8n,
      encoded: subscriptionOfferingAnchorEvent(fixture),
    },
    {
      kind: 'woke-tip-settled',
      slot: 9n,
      encoded: paymentTipAnchorEvent(fixture),
    },
    {
      kind: 'subscription-settled',
      slot: 10n,
      encoded: subscriptionSettlementAnchorEvent(fixture),
    },
    {
      kind: 'subscription-offering-retired',
      slot: 12n,
      encoded: subscriptionOfferingRetiredAnchorEvent(fixture),
    },
  ] as const;
}

function paymentConfigInitializedAnchorEvent(
  fixture: PaymentFixture,
  paymentConfigAddress = fixture.paymentConfigAddress,
): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PaymentConfigInitialized,
    u16(1),
    pubkey(fixture.configAddress),
    pubkey(paymentConfigAddress),
    pubkey(fixture.upgradeAuthority),
    pubkey(fixture.paymentAuthority),
    pubkey(fixture.feeDestination),
    u16(fixture.feeBps),
    u64(1n),
    Uint8Array.of(0),
    u64(5n),
  );
}

function paymentConfigUpdatedAnchorEvent(fixture: PaymentFixture): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PaymentConfigUpdated,
    u16(1),
    pubkey(fixture.configAddress),
    pubkey(fixture.paymentConfigAddress),
    pubkey(fixture.paymentAuthority),
    pubkey(fixture.feeDestination),
    pubkey(fixture.feeDestination),
    u16(fixture.feeBps),
    u16(fixture.feeBps),
    Uint8Array.of(0),
    Uint8Array.of(1),
    u64(2n),
    u64(6n),
  );
}

function paymentAuthorityRotatedAnchorEvent(fixture: PaymentFixture): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.PaymentAuthorityRotated,
    u16(1),
    pubkey(fixture.configAddress),
    pubkey(fixture.paymentConfigAddress),
    pubkey(fixture.paymentAuthority),
    pubkey(fixture.rotatedPaymentAuthority),
    u64(3n),
    u64(7n),
  );
}

function subscriptionOfferingAnchorEvent(
  fixture: PaymentFixture,
  overrides: { readonly offeringAddress?: string } = {},
): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.SubscriptionOfferingCreated,
    u16(1),
    pubkey(fixture.configAddress),
    pubkey(fixture.paymentConfigAddress),
    pubkey(overrides.offeringAddress ?? fixture.offeringAddress),
    pubkey(fixture.creatorAddress),
    pubkey(fixture.creatorRoot),
    fixture.offeringNonce,
    fixture.manifestBytes,
    stringValue('ipfs://payment-offering'),
    u64(fixture.priceLamports),
    Uint8Array.of(0),
    paymentSplitVector(fixture),
    fixture.refundPolicyBytes,
    u16(fixture.feeBps),
    u64(0n),
    u64(1n),
    u64(1n),
    u64(8n),
  );
}

function subscriptionOfferingRetiredAnchorEvent(fixture: PaymentFixture): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.SubscriptionOfferingRetired,
    u16(1),
    pubkey(fixture.configAddress),
    pubkey(fixture.offeringAddress),
    pubkey(fixture.creatorAddress),
    pubkey(fixture.creatorRoot),
    fixture.manifestBytes,
    u64(2n),
    u64(2n),
    u64(12n),
  );
}

function paymentTipAnchorEvent(
  fixture: PaymentFixture,
  overrides: {
    readonly receiptAddress?: string;
    readonly paymentKind?: number;
  } = {},
): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.WokeTipSettled,
    u16(1),
    pubkey(fixture.configAddress),
    pubkey(fixture.paymentConfigAddress),
    pubkey(overrides.receiptAddress ?? fixture.tipReceiptAddress),
    pubkey(fixture.payerAddress),
    pubkey(fixture.payerRoot),
    pubkey(fixture.creatorAddress),
    pubkey(fixture.creatorRoot),
    fixture.tipReceiptNonce,
    Uint8Array.of(overrides.paymentKind ?? 0),
    u64(0n),
    u64(3n),
    u64(101n),
    u16(fixture.feeBps),
    pubkey(fixture.feeDestination),
    u64(fixture.tipAllocation.feeLamports),
    u64(fixture.tipAllocation.distributableLamports),
    u64(fixture.tipAllocation.recipientAmounts[0] as bigint),
    i64(fixture.paidAtTimestamp - 60n),
    u64(9n),
  );
}

function subscriptionSettlementAnchorEvent(
  fixture: PaymentFixture,
  overrides: { readonly entitlementAddress?: string } = {},
): string {
  return eventData(
    SOCIAL_PROTOCOL_EVENT_LAYOUT.events.SubscriptionSettled,
    u16(1),
    pubkey(fixture.configAddress),
    pubkey(fixture.paymentConfigAddress),
    pubkey(fixture.offeringAddress),
    pubkey(fixture.subscriptionReceiptAddress),
    pubkey(overrides.entitlementAddress ?? fixture.entitlementAddress),
    pubkey(fixture.creatorAddress),
    pubkey(fixture.payerAddress),
    pubkey(fixture.payerRoot),
    fixture.subscriptionReceiptNonce,
    Uint8Array.of(1),
    u64(0n),
    u64(3n),
    u64(1n),
    fixture.manifestBytes,
    fixture.refundPolicyBytes,
    u64(fixture.priceLamports),
    u16(fixture.feeBps),
    pubkey(fixture.feeDestination),
    u64(fixture.subscriptionAllocation.feeLamports),
    u64(fixture.subscriptionAllocation.distributableLamports),
    paymentSplitVector(fixture),
    u64Vector(fixture.subscriptionAllocation.recipientAmounts),
    u64(1n),
    u64(1n),
    i64(fixture.paidAtTimestamp),
    i64(fixture.entitlementUntilTimestamp),
    i64(fixture.paidAtTimestamp),
    u64(10n),
  );
}

function paymentSplitVector(fixture: PaymentFixture): Uint8Array {
  return Buffer.concat([
    Buffer.from(u32(fixture.recipientSplits.length)),
    ...fixture.recipientSplits.map((split) =>
      Buffer.concat([
        Buffer.from(pubkey(split.recipientIdentityAddress)),
        Buffer.from(pubkey(split.destination)),
        Buffer.from(u16(split.basisPoints)),
      ]),
    ),
  ]);
}

function u64Vector(values: readonly bigint[]): Uint8Array {
  return Buffer.concat([
    Buffer.from(u32(values.length)),
    ...values.map((value) => Buffer.from(u64(value))),
  ]);
}

function materializationContext(fixture: PaymentFixture, slot: bigint, seed: number) {
  return {
    networkId: fixture.networkId,
    programId: fixture.programId,
    transactionSignature: signature(seed),
    transactionIndex: seed,
    slot,
    logIndex: 0,
    blockTime: Date.UTC(2026, 6, 28, 20, 0, Number(slot)) / 1_000,
  };
}

function eventData(discriminator: readonly number[], ...fields: readonly Uint8Array[]): string {
  return Buffer.concat([
    Buffer.from(discriminator),
    ...fields.map((field) => Buffer.from(field)),
  ]).toString('base64');
}

function stringValue(value: string): Uint8Array {
  const encoded = Buffer.from(value, 'utf8');
  return Buffer.concat([Buffer.from(u32(encoded.byteLength)), encoded]);
}

function u16(value: number): Uint8Array {
  const result = new Uint8Array(2);
  new DataView(result.buffer).setUint16(0, value, true);
  return result;
}

function u32(value: number): Uint8Array {
  const result = new Uint8Array(4);
  new DataView(result.buffer).setUint32(0, value, true);
  return result;
}

function u64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigUint64(0, value, true);
  return result;
}

function i64(value: bigint): Uint8Array {
  const result = new Uint8Array(8);
  new DataView(result.buffer).setBigInt64(0, value, true);
  return result;
}

function pubkey(value: string): Uint8Array {
  return bs58.decode(value);
}
