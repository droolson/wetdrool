import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ModerationKeyRing } from '../src/encryption.js';
import { migrateModeration } from '../src/migrate.js';
import { PostgresModerationStore } from '../src/postgres-store.js';
import { ModerationService } from '../src/service.js';
import { knownKeyAuthorizer, makeAppeal, makeLabel, makeReport, serviceNow } from './fixtures.js';
import { actionInput, operator } from './ledger-fixtures.js';

const databaseUrl =
  process.env['MODERATION_INTEGRATION_DATABASE_URL'] ??
  process.env['MODERATION_DATABASE_URL'] ??
  'postgresql://wetdrool_moderation_runtime:local-moderation-runtime-only@127.0.0.1:5432/wetdrool';
const migrationDatabaseUrl =
  process.env['MODERATION_INTEGRATION_DATABASE_MIGRATION_URL'] ??
  process.env['MODERATION_DATABASE_MIGRATION_URL'] ??
  'postgresql://wetdrool_moderation_migration:local-moderation-migration-only@127.0.0.1:5432/wetdrool';
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const migrationSql = postgres(migrationDatabaseUrl, { max: 1, onnotice: () => undefined });
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 31);
const keyRing = () => new ModerationKeyRing({ activeKeyId: 'test-v1', keys: { 'test-v1': key } });

beforeAll(async () => {
  await Promise.all([
    migrateModeration(migrationDatabaseUrl),
    migrateModeration(migrationDatabaseUrl),
  ]);
});

afterAll(async () => {
  await Promise.all([sql.end({ timeout: 5 }), migrationSql.end({ timeout: 5 })]);
});

describe('PostgreSQL moderation case ledger', () => {
  it('fails readiness when required runtime write access is revoked', async () => {
    const store = new PostgresModerationStore(databaseUrl, keyRing());
    const runtimeRows = await sql<{ current_user: string }[]>`SELECT current_user`;
    const runtimeRole = runtimeRows[0]?.current_user;
    if (runtimeRole === undefined) throw new Error('Expected a moderation runtime role.');

    try {
      await expect(store.readiness()).resolves.toBeUndefined();
      await migrationSql`
        REVOKE INSERT ON moderation_restricted_objects
        FROM ${migrationSql(runtimeRole)}
      `;
      await expect(store.readiness()).rejects.toMatchObject({
        code: 'database-unavailable',
      });
    } finally {
      await migrationSql`
        GRANT INSERT ON moderation_restricted_objects
        TO ${migrationSql(runtimeRole)}
      `;
      await store.close();
    }
  });

  it('replays migrations and durably separates public labels from encrypted restricted cases', async () => {
    await migrateModeration(migrationDatabaseUrl);
    const migrationRows = await sql<{ count: string; checksum_valid: boolean }[]>`
      SELECT
        count(*)::text AS count,
        bool_and(checksum ~ '^[0-9a-f]{64}$') AS checksum_valid
      FROM moderation_schema_migrations
      WHERE version = '0001_moderation_case_ledger.sql'
    `;
    expect(migrationRows[0]?.count).toBe('1');
    expect(migrationRows[0]?.checksum_valid).toBe(true);
    const retentionMigrationRows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM moderation_schema_migrations
      WHERE version = '0002_append_only_retention.sql'
    `;
    expect(retentionMigrationRows[0]?.count).toBe('1');
    const guardedRetentionRows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM moderation_schema_migrations
      WHERE version = '0003_guarded_retention.sql'
    `;
    expect(guardedRetentionRows[0]?.count).toBe('1');

    const store = new PostgresModerationStore(databaseUrl, keyRing());
    const service = new ModerationService({
      store,
      authorizeObject: knownKeyAuthorizer,
      now: () => serviceNow,
    });
    const report = makeReport({ summary: 'sentinel-pg-private-report-summary' });
    let storedReportId: string | undefined;
    let labelId: string | undefined;
    try {
      const receipts = await Promise.all([
        service.ingestReport(report),
        service.ingestReport(report),
      ]);
      expect(receipts.map((receipt) => receipt.duplicate).sort()).toEqual([false, true]);
      storedReportId = receipts[0]?.objectId;
      if (storedReportId === undefined) throw new Error('Expected a report object ID.');

      const label = await service.ingestLabel(makeLabel());
      labelId = label.objectId;
      const placement = await sql<
        {
          public_report: string;
          restricted_report: string;
          public_label: string;
          restricted_label: string;
          encrypted: string;
        }[]
      >`
        SELECT
          (SELECT count(*)::text FROM moderation_public_objects WHERE object_id = ${storedReportId})
            AS public_report,
          (SELECT count(*)::text FROM moderation_restricted_objects WHERE object_id = ${storedReportId})
            AS restricted_report,
          (SELECT count(*)::text FROM moderation_public_objects WHERE object_id = ${label.objectId})
            AS public_label,
          (SELECT count(*)::text FROM moderation_restricted_objects WHERE object_id = ${label.objectId})
            AS restricted_label,
          (
            SELECT encrypted_payload::text
            FROM moderation_restricted_objects
            WHERE object_id = ${storedReportId}
          ) AS encrypted
      `;
      expect(placement[0]).toMatchObject({
        public_report: '0',
        restricted_report: '1',
        public_label: '1',
        restricted_label: '0',
      });
      expect(placement[0]?.encrypted).not.toContain('sentinel-pg-private-report-summary');
      await expect(
        sql`
          DELETE FROM moderation_restricted_objects
          WHERE object_id = ${storedReportId}
        `,
      ).rejects.toThrow();
      await expect(
        sql`
          DELETE FROM moderation_cases
          WHERE report_id = ${storedReportId}
        `,
      ).rejects.toThrow();
      const publicBytes = await sql<{ canonical_bytes: Uint8Array }[]>`
        SELECT canonical_bytes
        FROM moderation_public_objects
        WHERE object_id = ${label.objectId}
      `;
      const originalPublicBytes = publicBytes[0]?.canonical_bytes;
      if (originalPublicBytes === undefined) {
        throw new Error('Expected stored public label bytes.');
      }
      await expect(
        sql`
          UPDATE moderation_public_objects
          SET canonical_bytes = canonical_bytes
          WHERE object_id = ${label.objectId}
        `,
      ).rejects.toThrow();
      await migrationSql.begin(async (transaction) => {
        await transaction`
          ALTER TABLE moderation_public_objects
          DISABLE TRIGGER moderation_public_objects_immutable
        `;
        await transaction`
          UPDATE moderation_public_objects
          SET canonical_bytes = set_byte(
            canonical_bytes,
            0,
            (get_byte(canonical_bytes, 0) + 1) % 256
          )
          WHERE object_id = ${label.objectId}
        `;
        await transaction`
          ALTER TABLE moderation_public_objects
          ENABLE TRIGGER moderation_public_objects_immutable
        `;
      });
      await expect(store.get(label.objectId)).rejects.toMatchObject({
        code: 'corrupt-storage',
      });
      await migrationSql.begin(async (transaction) => {
        await transaction`
          ALTER TABLE moderation_public_objects
          DISABLE TRIGGER moderation_public_objects_immutable
        `;
        await transaction`
          UPDATE moderation_public_objects
          SET canonical_bytes = ${originalPublicBytes}
          WHERE object_id = ${label.objectId}
        `;
        await transaction`
          ALTER TABLE moderation_public_objects
          ENABLE TRIGGER moderation_public_objects_immutable
        `;
      });

      const moderator = operator();
      const transitions = await Promise.allSettled([
        service.transitionCase(
          storedReportId,
          { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
          moderator,
        ),
        service.transitionCase(
          storedReportId,
          { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
          moderator,
        ),
      ]);
      expect(transitions.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
      expect(transitions.filter((result) => result.status === 'rejected')).toHaveLength(1);

      const action = await service.applyAction(storedReportId, actionInput(2), moderator);
      await service.recordAccess({
        reportId: storedReportId,
        operation: 'case.audit',
        allowed: true,
        actorId: moderator.actorId,
        assertionId: moderator.assertionId,
        purpose: 'integration-verification',
      });
      const ledger = await service.readCaseLedger(storedReportId);
      expect(ledger).toMatchObject({
        snapshot: { state: 'action-taken', version: 3 },
        actions: [
          {
            actionId: action.actionId,
            policyVersion: 1,
            ruleId: 'targeted-harassment',
            currentStatus: 'active',
          },
        ],
        access: [{ purpose: 'integration-verification', allowed: true }],
      });
      const actionRows = await sql<{ encrypted_detail: string }[]>`
        SELECT encrypted_detail::text
        FROM moderation_actions
        WHERE action_id = ${action.actionId}
      `;
      expect(actionRows[0]?.encrypted_detail).not.toContain('supporting and exculpatory context');
      await expect(
        sql`UPDATE moderation_actions SET action_kind = 'guidance' WHERE action_id = ${action.actionId}`,
      ).rejects.toThrow(/append-only/u);

      const transparency = await service.transparency({
        from: '2026-07-29T00:00:00.000Z',
        to: '2026-07-30T00:00:00.000Z',
        minimumCellSize: 3,
      });
      expect(transparency.rawCasesIncluded).toBe(false);
      expect(JSON.stringify(transparency)).not.toContain(storedReportId);
    } finally {
      await store.close();
    }

    if (storedReportId === undefined) throw new Error('Expected a stored report ID.');
    const reopened = new PostgresModerationStore(databaseUrl, keyRing());
    try {
      await expect(reopened.getCase(storedReportId)).resolves.toMatchObject({
        report: { objectId: storedReportId },
      });
    } finally {
      await reopened.close();
    }

    const wrongKey = new PostgresModerationStore(
      databaseUrl,
      new ModerationKeyRing({
        activeKeyId: 'test-v1',
        keys: { 'test-v1': Uint8Array.from({ length: 32 }, () => 250) },
      }),
    );
    try {
      await expect(wrongKey.readiness()).rejects.toMatchObject({
        code: 'corrupt-storage',
      });
      await expect(wrongKey.get(storedReportId)).rejects.toMatchObject({
        code: 'corrupt-storage',
      });
    } finally {
      await wrongKey.close();
      await cleanup([storedReportId], labelId === undefined ? [] : [labelId]);
    }
  }, 45_000);

  it('persists deterministic emergency review and expiry without runtime ledger deletion', async () => {
    let now = serviceNow;
    const store = new PostgresModerationStore(databaseUrl, keyRing());
    const service = new ModerationService({
      store,
      authorizeObject: knownKeyAuthorizer,
      now: () => now,
    });
    const moderator = operator();
    let reportId: string | undefined;
    try {
      reportId = (await service.ingestReport(makeReport())).objectId;
      await service.transitionCase(
        reportId,
        { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
        moderator,
      );
      await service.applyAction(
        reportId,
        actionInput(2, {
          kind: 'emergency-safety',
          effectiveAt: '2026-07-29T12:00:00.000Z',
          reviewDueAt: '2026-07-29T13:00:00.000Z',
          expiresAt: '2026-07-29T14:00:00.000Z',
        }),
        moderator,
      );
      now = new Date('2026-07-29T14:30:00.000Z');
      await expect(
        service.runMaintenance({
          dueActionLimit: 1,
          retentionLimit: 1,
          closedCaseRetentionMs: 365 * 86_400_000,
        }),
      ).resolves.toMatchObject({ reviewRequired: 1, actionsExpired: 1 });
      await expect(service.readCaseLedger(reportId)).resolves.toMatchObject({
        actions: [{ currentStatus: 'expired' }],
      });
      await service.transitionCase(
        reportId,
        { expectedVersion: 5, toState: 'closed', reasonCode: 'review.closed' },
        moderator,
      );
      await service.setLegalHold(
        reportId,
        {
          expectedVersion: 6,
          active: true,
          reason: 'Preserve through the documented legal and appeal review window.',
        },
        moderator,
      );
      now = new Date('2027-08-01T00:00:00.000Z');
      await expect(
        service.runMaintenance({
          dueActionLimit: 1,
          retentionLimit: 1,
          closedCaseRetentionMs: 365 * 86_400_000,
        }),
      ).resolves.toMatchObject({ casesRemoved: 0 });
      await service.setLegalHold(
        reportId,
        {
          expectedVersion: 7,
          active: false,
          reason: 'The approved preservation period ended and release was recorded.',
        },
        moderator,
      );
      await expect(
        service.runMaintenance({
          dueActionLimit: 1,
          retentionLimit: 1,
          closedCaseRetentionMs: 365 * 86_400_000,
        }),
      ).resolves.toMatchObject({ casesRemoved: 0 });
      await expect(service.readCaseSnapshot(reportId)).resolves.toBeDefined();
    } finally {
      await store.close();
      if (reportId !== undefined) await cleanup([reportId], []);
    }
  }, 45_000);

  it('retains an appeal-reviewed case and its append-only rows', async () => {
    let now = serviceNow;
    const store = new PostgresModerationStore(databaseUrl, keyRing());
    const service = new ModerationService({
      store,
      authorizeObject: knownKeyAuthorizer,
      now: () => now,
    });
    const moderator = operator();
    const independentReviewer = operator('operator:independent-reviewer');
    let reportId: string | undefined;
    let reviewId: string | undefined;
    try {
      reportId = (await service.ingestReport(makeReport())).objectId;
      await service.transitionCase(
        reportId,
        { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
        moderator,
      );
      const action = await service.applyAction(reportId, actionInput(2), moderator);
      const appeal = await service.ingestAppeal(makeAppeal({ id: reportId }));
      const review = await service.reviewAction(
        reportId,
        {
          expectedVersion: 4,
          actionId: action.actionId,
          appealId: appeal.objectId,
          outcome: 'upheld',
          rationale: 'Independent review confirmed the bounded action and policy citation.',
        },
        independentReviewer,
      );
      reviewId = review.reviewId;
      await service.transitionCase(
        reportId,
        { expectedVersion: 5, toState: 'closed', reasonCode: 'review.closed' },
        independentReviewer,
      );
      await service.ingestAppeal(makeAppeal({ id: reportId }));
      await expect(service.readCaseSnapshot(reportId)).resolves.toMatchObject({
        state: 'appealed',
        version: 7,
      });
      await service.transitionCase(
        reportId,
        { expectedVersion: 7, toState: 'closed', reasonCode: 'appeal-window.closed' },
        independentReviewer,
      );
      now = new Date('2027-08-01T00:00:00.000Z');
      await expect(
        service.runMaintenance({
          dueActionLimit: 1,
          retentionLimit: 1,
          closedCaseRetentionMs: 365 * 86_400_000,
        }),
      ).resolves.toMatchObject({ casesRemoved: 0 });
      await expect(service.readCaseSnapshot(reportId)).resolves.toBeDefined();
      if (reviewId === undefined) throw new Error('Expected an appeal review ID.');
      const reviewRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM moderation_reviews
        WHERE review_id = ${reviewId}
      `;
      expect(Number(reviewRows[0]?.count ?? 0)).toBe(1);
    } finally {
      await store.close();
      if (reportId !== undefined) await cleanup([reportId], []);
    }
  }, 45_000);
});

async function cleanup(reportIds: readonly string[], publicIds: readonly string[]): Promise<void> {
  await migrationSql.begin(async (transaction) => {
    await transaction`SELECT set_config('wetdrool.retention_delete', 'on', true)`;
    if (reportIds.length > 0) {
      await transaction`
        DELETE FROM moderation_access_events
        WHERE report_id IN ${transaction(reportIds)}
      `;
      await transaction`
        DELETE FROM moderation_restricted_objects
        WHERE object_type = 'appeal'
          AND decision_id IN ${transaction(reportIds)}
      `;
      await transaction`
        DELETE FROM moderation_restricted_objects
        WHERE object_id IN ${transaction(reportIds)}
      `;
    }
    if (publicIds.length > 0) {
      await transaction`
        DELETE FROM moderation_public_objects
        WHERE object_id IN ${transaction(publicIds)}
      `;
    }
  });
}
