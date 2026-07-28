import { describe, expect, it } from 'vitest';

import { ModerationService } from '../src/service.js';
import { MemoryModerationStore } from '../src/store.js';
import { knownKeyAuthorizer, makeAppeal, makeReport, serviceNow } from './fixtures.js';
import { actionInput, operator } from './ledger-fixtures.js';

function ledgerService(now: () => Date = () => serviceNow) {
  return new ModerationService({
    store: new MemoryModerationStore(),
    authorizeObject: knownKeyAuthorizer,
    now,
  });
}

describe('moderation case workflow', () => {
  it('creates a versioned append-only case and rejects invalid/stale transitions and scopes', async () => {
    const service = ledgerService();
    const report = await service.ingestReport(makeReport());
    await expect(service.readCaseSnapshot(report.objectId)).resolves.toMatchObject({
      reportId: report.objectId,
      state: 'received',
      version: 1,
    });

    const triager = operator('operator:triager', ['case.triage']);
    await expect(
      service.transitionCase(
        report.objectId,
        { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
        triager,
      ),
    ).resolves.toMatchObject({ state: 'under-review', version: 2 });
    await expect(
      service.transitionCase(
        report.objectId,
        { expectedVersion: 1, toState: 'closed', reasonCode: 'review.closed' },
        operator('operator:reviewer', ['case.review']),
      ),
    ).rejects.toMatchObject({ code: 'case-conflict' });
    await expect(
      service.transitionCase(
        report.objectId,
        { expectedVersion: 2, toState: 'received', reasonCode: 'invalid.rollback' },
        triager,
      ),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      service.transitionCase(
        report.objectId,
        { expectedVersion: 2, toState: 'received', reasonCode: 'invalid.rollback' },
        operator('operator:reviewer', ['case.review']),
      ),
    ).rejects.toMatchObject({ code: 'invalid-transition' });

    const ledger = await service.readCaseLedger(report.objectId);
    expect(ledger?.events.map((event) => [event.caseVersion, event.eventType])).toEqual([
      [1, 'report-received'],
      [2, 'case-transitioned'],
    ]);
  });

  it('does not apply an action before the case enters a review state', async () => {
    const service = ledgerService();
    const report = await service.ingestReport(makeReport());
    await expect(
      service.applyAction(report.objectId, actionInput(1), operator()),
    ).rejects.toMatchObject({ code: 'invalid-transition' });
    await expect(service.readCaseSnapshot(report.objectId)).resolves.toMatchObject({
      state: 'received',
      version: 1,
    });
  });

  it('rejects already-expired actions and closed appeal windows', async () => {
    const service = ledgerService();
    const report = await service.ingestReport(makeReport());
    const moderator = operator();
    await service.transitionCase(
      report.objectId,
      { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
      moderator,
    );
    await expect(
      service.applyAction(
        report.objectId,
        actionInput(2, {
          effectiveAt: '2026-07-28T12:00:00.000Z',
          expiresAt: '2026-07-29T11:59:59.999Z',
        }),
        moderator,
      ),
    ).rejects.toMatchObject({ code: 'invalid-object' });
    await expect(
      service.applyAction(
        report.objectId,
        actionInput(2, {
          appealDeadline: '2026-07-29T12:00:00.000Z',
        }),
        moderator,
      ),
    ).rejects.toMatchObject({ code: 'invalid-object' });
    await expect(service.readCaseSnapshot(report.objectId)).resolves.toMatchObject({
      state: 'under-review',
      version: 2,
    });
  });

  it('records policy-bound actions and enforces independent appeal review or reasoned override', async () => {
    const service = ledgerService();
    const report = await service.ingestReport(makeReport());
    const moderator = operator('operator:moderator-one');
    await service.transitionCase(
      report.objectId,
      { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
      moderator,
    );
    const action = await service.applyAction(report.objectId, actionInput(2), moderator);
    expect(action).toMatchObject({
      reportId: report.objectId,
      policyVersion: 1,
      ruleId: 'targeted-harassment',
      currentStatus: 'active',
    });

    await expect(
      service.reviewAction(
        report.objectId,
        {
          expectedVersion: 3,
          actionId: action.actionId,
          outcome: 'upheld',
          rationale: 'A second reviewer confirmed the policy application.',
        },
        operator('operator:reviewer-two'),
      ),
    ).rejects.toMatchObject({ code: 'case-conflict' });

    const appeal = await service.ingestAppeal(makeAppeal({ id: report.objectId }));
    await expect(
      service.reviewAction(
        report.objectId,
        {
          expectedVersion: 4,
          actionId: action.actionId,
          appealId: appeal.objectId,
          outcome: 'upheld',
          rationale: 'The action matches the cited policy and evidence.',
        },
        moderator,
      ),
    ).rejects.toMatchObject({ code: 'conflict-of-interest' });

    const override = operator('operator:moderator-one', [
      ...moderator.permissions,
      'conflict.override',
    ]);
    await expect(
      service.reviewAction(
        report.objectId,
        {
          expectedVersion: 4,
          actionId: action.actionId,
          appealId: appeal.objectId,
          outcome: 'modified',
          rationale: 'A separately authorized override narrowed the action.',
          conflictOverrideReason:
            'No independent reviewer was available before the published emergency deadline.',
        },
        override,
      ),
    ).resolves.toMatchObject({
      actionId: action.actionId,
      appealId: appeal.objectId,
      outcome: 'modified',
      conflictOverrideReason:
        'No independent reviewer was available before the published emergency deadline.',
    });
    const ledger = await service.readCaseLedger(report.objectId);
    expect(ledger?.snapshot.version).toBe(5);
    expect(ledger?.actions[0]).toMatchObject({
      policyId: action.policyId,
      policyVersion: 1,
      ruleId: 'targeted-harassment',
      currentStatus: 'reviewed',
    });
  });

  it('lets an accepted signed appeal reopen a manually closed case', async () => {
    const service = ledgerService();
    const report = await service.ingestReport(makeReport());
    const moderator = operator();
    await service.transitionCase(
      report.objectId,
      { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
      moderator,
    );
    const closed = await service.transitionCase(
      report.objectId,
      { expectedVersion: 2, toState: 'closed', reasonCode: 'review.closed' },
      moderator,
    );
    expect(closed.closedAt).toBeDefined();
    await service.ingestAppeal(makeAppeal({ id: report.objectId }));
    await expect(service.readCaseSnapshot(report.objectId)).resolves.toMatchObject({
      state: 'appealed',
      version: 4,
    });
    expect((await service.readCaseSnapshot(report.objectId))?.closedAt).toBeUndefined();
  });

  it('marks overdue emergency review and expiry once, deterministically', async () => {
    let now = serviceNow;
    const service = ledgerService(() => now);
    const report = await service.ingestReport(makeReport());
    const moderator = operator();
    await service.transitionCase(
      report.objectId,
      { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
      moderator,
    );
    const action = await service.applyAction(
      report.objectId,
      actionInput(2, {
        kind: 'emergency-safety',
        effectiveAt: '2026-07-29T12:00:00.000Z',
        reviewDueAt: '2026-07-29T13:00:00.000Z',
        expiresAt: '2026-07-29T14:00:00.000Z',
      }),
      moderator,
    );

    now = new Date('2026-07-29T13:30:00.000Z');
    await expect(
      service.runMaintenance({
        dueActionLimit: 10,
        retentionLimit: 10,
        closedCaseRetentionMs: 365 * 86_400_000,
      }),
    ).resolves.toMatchObject({ reviewRequired: 1, actionsExpired: 0 });
    now = new Date('2026-07-29T14:30:00.000Z');
    await expect(
      service.runMaintenance({
        dueActionLimit: 10,
        retentionLimit: 10,
        closedCaseRetentionMs: 365 * 86_400_000,
      }),
    ).resolves.toMatchObject({ reviewRequired: 0, actionsExpired: 1 });
    await expect(
      service.runMaintenance({
        dueActionLimit: 10,
        retentionLimit: 10,
        closedCaseRetentionMs: 365 * 86_400_000,
      }),
    ).resolves.toMatchObject({ reviewRequired: 0, actionsExpired: 0 });
    expect((await service.readCaseLedger(report.objectId))?.actions[0]).toMatchObject({
      actionId: action.actionId,
      currentStatus: 'expired',
    });
  });

  it('honors legal holds during bounded retention and emits only privacy-safe aggregates', async () => {
    let now = serviceNow;
    const service = ledgerService(() => now);
    const report = await service.ingestReport(makeReport());
    const reviewer = operator();
    await service.transitionCase(
      report.objectId,
      { expectedVersion: 1, toState: 'under-review', reasonCode: 'triage.accepted' },
      reviewer,
    );
    await service.transitionCase(
      report.objectId,
      { expectedVersion: 2, toState: 'closed', reasonCode: 'review.closed' },
      reviewer,
    );
    await service.setLegalHold(
      report.objectId,
      {
        expectedVersion: 3,
        active: true,
        reason: 'Preserve during a documented appeal and lawful review window.',
      },
      reviewer,
    );
    await service.recordAccess({
      reportId: report.objectId,
      operation: 'case.read',
      allowed: true,
      actorId: reviewer.actorId,
      assertionId: reviewer.assertionId,
      purpose: 'appeal-review',
    });

    const transparency = await service.transparency({
      from: '2026-07-29T00:00:00.000Z',
      to: '2026-07-30T00:00:00.000Z',
      minimumCellSize: 3,
    });
    expect(transparency).toMatchObject({
      privacySafe: true,
      rawCasesIncluded: false,
      totals: { reports: 1 },
      reportsByCategory: [{ category: 'other-or-suppressed', count: 1 }],
    });
    expect(JSON.stringify(transparency)).not.toContain(report.objectId);
    expect(JSON.stringify(transparency)).not.toContain('harassment');
    expect(transparency.medianTriageMilliseconds).toBeNull();
    expect(transparency.medianAppealResolutionMilliseconds).toBeNull();

    now = new Date('2027-08-01T00:00:00.000Z');
    await expect(
      service.runMaintenance({
        dueActionLimit: 10,
        retentionLimit: 1,
        closedCaseRetentionMs: 365 * 86_400_000,
      }),
    ).resolves.toMatchObject({ casesRemoved: 0 });
    const held = await service.readCaseSnapshot(report.objectId);
    if (held === undefined) throw new Error('Expected the held moderation case.');
    await service.setLegalHold(
      report.objectId,
      {
        expectedVersion: held.version,
        active: false,
        reason: 'The documented legal review window has ended and release is approved.',
      },
      reviewer,
    );
    await expect(
      service.runMaintenance({
        dueActionLimit: 10,
        retentionLimit: 1,
        closedCaseRetentionMs: 365 * 86_400_000,
      }),
    ).resolves.toMatchObject({ casesRemoved: 1 });
    await expect(service.readCaseSnapshot(report.objectId)).resolves.toBeUndefined();
  });
});
