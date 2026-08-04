import postgres from 'postgres';
import { describe, expect, it } from 'vitest';

import { MemoryContentAddressedStorage } from '@wetdrool/storage';

import {
  ManifestVerifier,
  OpenIndexer,
  PostgresProjectionStore,
  WEEK_SECONDS,
} from '../src/index.js';
import { migrate } from '../src/migrate.js';
import { createPaymentFixture, publicKey, signature } from './payment-fixtures.js';
import { purgePostgresTestNetworks } from './postgres-test-cleanup.js';

const databaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_URL'] ??
  process.env['DATABASE_URL'] ??
  'postgresql://wetdrool_indexer_runtime:local-indexer-runtime-only@127.0.0.1:5432/wetdrool';
const migrationDatabaseUrl =
  process.env['INDEXER_INTEGRATION_DATABASE_MIGRATION_URL'] ??
  process.env['DATABASE_MIGRATION_URL'] ??
  'postgresql://wetdrool_indexer_migration:local-indexer-migration-only@127.0.0.1:5432/wetdrool';

describe('PostgreSQL payment projection integration', () => {
  it('migrates, validates transitions atomically, rebuilds, and isolates exact networks', async () => {
    await migrate(migrationDatabaseUrl);
    const first = await createPaymentFixture({ genesisSeed: 241, coordinateSeed: 1_000 });
    const second = await createPaymentFixture({ genesisSeed: 242, coordinateSeed: 2_000 });
    const projection = new PostgresProjectionStore(databaseUrl);
    const inspectionSql = postgres(databaseUrl, { max: 1 });
    const indexer = new OpenIndexer(
      projection,
      new ManifestVerifier(new MemoryContentAddressedStorage(), {
        authorize: () => Promise.resolve(false),
      }),
    );

    try {
      await purgePostgresTestNetworks(projection, migrationDatabaseUrl, [
        first.networkId,
        second.networkId,
      ]);
      for (const event of first.events.slice(0, 8)) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }

      await expect(
        indexer.ingest({
          ...first.subscriptionSettled,
          transactionSignature: signature(2_301),
          transactionIndex: 2_301,
          entitlementStateSequence: 2n,
          settlementCount: 2n,
        }),
      ).rejects.toMatchObject({ code: 'stale-event' });
      await expect(
        indexer.ingest({
          ...first.subscriptionSettled,
          transactionSignature: signature(2_302),
          transactionIndex: 2_302,
          entitlementFromTimestamp: first.paidAtTimestamp + 1n,
          entitlementUntilTimestamp: first.paidAtTimestamp + 1n + WEEK_SECONDS,
        }),
      ).rejects.toMatchObject({ code: 'stale-event' });
      await expect(
        projection.getPaymentReceipt(first.networkId, first.subscriptionReceiptAddress),
      ).resolves.toBeUndefined();
      await expect(
        projection.getSubscriptionEntitlement(first.networkId, first.entitlementAddress),
      ).resolves.toBeUndefined();
      await expect(projection.checkpoint(first.networkId)).resolves.toBe(8n);

      for (const event of first.events.slice(8)) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }
      await expect(indexer.ingest(first.subscriptionOfferingRetired)).resolves.toMatchObject({
        applied: false,
      });
      await expect(
        indexer.ingest({
          ...first.subscriptionOfferingRetired,
          blockTime: new Date(
            Date.parse(first.subscriptionOfferingRetired.blockTime) + 1_000,
          ).toISOString(),
        }),
      ).rejects.toMatchObject({ code: 'event-conflict' });

      const expected = stableJson({
        config: await projection.getPaymentConfig(first.networkId),
        offering: await projection.getSubscriptionOffering(first.networkId, first.offeringAddress),
        tip: await projection.getPaymentReceipt(first.networkId, first.tipReceiptAddress),
        subscription: await projection.getPaymentReceipt(
          first.networkId,
          first.subscriptionReceiptAddress,
        ),
        renewal: await projection.getPaymentReceipt(first.networkId, first.renewalReceiptAddress),
        entitlement: await projection.getSubscriptionEntitlement(
          first.networkId,
          first.entitlementAddress,
        ),
        checkpoint: await projection.checkpoint(first.networkId),
      });
      expect(expected).toContain('"recipientAmounts":["51","50"]');
      expect(expected).toContain('"settlementCount":"2"');
      expect(expected).toContain('"active":false');

      const provenance = await inspectionSql<
        {
          transaction_signature: string;
          transaction_index: number | null;
          log_index: number;
        }[]
      >`
        SELECT transaction_signature, transaction_index, log_index
        FROM payment_receipts
        WHERE network_id = ${first.networkId}
          AND receipt_address = ${first.subscriptionReceiptAddress}
      `;
      expect(provenance).toEqual([
        {
          transaction_signature: first.subscriptionSettled.transactionSignature,
          transaction_index: first.subscriptionSettled.transactionIndex as number,
          log_index: first.subscriptionSettled.logIndex,
        },
      ]);

      const rebuilt = await indexer.rebuild(first.networkId, [...first.events].reverse());
      expect(rebuilt).toHaveLength(first.events.length);
      expect(
        stableJson({
          config: await projection.getPaymentConfig(first.networkId),
          offering: await projection.getSubscriptionOffering(
            first.networkId,
            first.offeringAddress,
          ),
          tip: await projection.getPaymentReceipt(first.networkId, first.tipReceiptAddress),
          subscription: await projection.getPaymentReceipt(
            first.networkId,
            first.subscriptionReceiptAddress,
          ),
          renewal: await projection.getPaymentReceipt(first.networkId, first.renewalReceiptAddress),
          entitlement: await projection.getSubscriptionEntitlement(
            first.networkId,
            first.entitlementAddress,
          ),
          checkpoint: await projection.checkpoint(first.networkId),
        }),
      ).toBe(expected);

      for (const event of second.events) {
        await expect(indexer.ingest(event)).resolves.toMatchObject({ applied: true });
      }
      expect(second.offeringAddress).toBe(first.offeringAddress);
      expect(second.subscriptionReceiptAddress).toBe(first.subscriptionReceiptAddress);
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
        inspectionSql`
          INSERT INTO subscription_offering_splits (
            network_id, offering_address, split_index,
            recipient_identity_id, destination, basis_points
          ) VALUES (
            ${first.networkId}, ${first.offeringAddress}, 2,
            ${second.payerIdentityId}, ${publicKey(243)}, 1
          )
        `,
      ).rejects.toMatchObject({ code: '23503' });
      const splitCount = await inspectionSql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM subscription_offering_splits
        WHERE network_id = ${first.networkId}
          AND offering_address = ${first.offeringAddress}
      `;
      expect(splitCount[0]?.count).toBe('2');
    } finally {
      await purgePostgresTestNetworks(projection, migrationDatabaseUrl, [
        first.networkId,
        second.networkId,
      ]);
      await projection.close();
      await inspectionSql.end({ timeout: 5 });
    }
  });
});

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item,
  );
}
