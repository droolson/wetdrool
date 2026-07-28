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
  process.env['DATABASE_URL'] ??
  'postgresql://wokesocial:local-development-only@127.0.0.1:5432/wokesocial';
const sql = postgres(databaseUrl, { max: 2, onnotice: () => undefined });
const key = Uint8Array.from({ length: 32 }, (_, index) => index + 31);
const keyRing = () => new ModerationKeyRing({ activeKeyId: 'test-v1', keys: { 'test-v1': key } });

beforeAll(async () => {
  await migrateModeration(databaseUrl);
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe('PostgreSQL moderation case ledger', () => {
  it('replays migrations and durably separates public labels from encrypted restricted cases', async () => {
    await migrateModeration(databaseUrl);
    const migrationRows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM moderation_schema_migrations
      WHERE version = '0001_moderation_case_ledger.sql'
    `;
    expect(migrationRows[0]?.count).toBe('1');
    const retentionMigrationRows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM moderation_schema_migrations
      WHERE version = '0002_append_only_retention.sql'
    `;
    expect(retentionMigrationRows[0]?.count).toBe('1');

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
      const publicBytes = await sql<{ canonical_bytes: Uint8Array }[]>`
        SELECT canonical_bytes
        FROM moderation_public_objects
        WHERE object_id = ${label.objectId}
      `;
      const originalPublicBytes = publicBytes[0]?.canonical_bytes;
      if (originalPublicBytes === undefined) {
        throw new Error('Expected stored public label bytes.');
      }
      await sql`
        UPDATE moderation_public_objects
        SET canonical_bytes = set_byte(
          canonical_bytes,
          0,
          (get_byte(canonical_bytes, 0) + 1) % 256
        )
        WHERE object_id = ${label.objectId}
      `;
      await expect(store.get(label.objectId)).rejects.toMatchObject({
        code: 'corrupt-storage',
      });
      await sql`
        UPDATE moderation_public_objects
        SET canonical_bytes = ${originalPublicBytes}
        WHERE object_id = ${label.objectId}
      `;

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

  it('persists deterministic emergency review, expiry, legal hold, and bounded retention', async () => {
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
      ).resolves.toMatchObject({ casesRemoved: 1 });
      await expect(service.readCaseSnapshot(reportId)).resolves.toBeUndefined();
      reportId = undefined;
    } finally {
      await store.close();
      if (reportId !== undefined) await cleanup([reportId], []);
    }
  }, 45_000);

  it('retains then removes an appeal-reviewed case without mutating append-only rows', async () => {
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
      ).resolves.toMatchObject({ casesRemoved: 1 });
      await expect(service.readCaseSnapshot(reportId)).resolves.toBeUndefined();
      if (reviewId === undefined) throw new Error('Expected an appeal review ID.');
      const reviewRows = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM moderation_reviews
        WHERE review_id = ${reviewId}
      `;
      expect(Number(reviewRows[0]?.count ?? 0)).toBe(0);
      reportId = undefined;
    } finally {
      await store.close();
      if (reportId !== undefined) await cleanup([reportId], []);
    }
  }, 45_000);
});

async function cleanup(reportIds: readonly string[], publicIds: readonly string[]): Promise<void> {
  if (reportIds.length > 0) {
    await sql`DELETE FROM moderation_access_events WHERE report_id IN ${sql(reportIds)}`;
    await sql`
      DELETE FROM moderation_restricted_objects
      WHERE object_type = 'appeal'
        AND decision_id IN ${sql(reportIds)}
    `;
    await sql`DELETE FROM moderation_restricted_objects WHERE object_id IN ${sql(reportIds)}`;
  }
  if (publicIds.length > 0) {
    await sql`DELETE FROM moderation_public_objects WHERE object_id IN ${sql(publicIds)}`;
  }
}
