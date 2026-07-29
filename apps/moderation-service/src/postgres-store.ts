import { randomUUID } from 'node:crypto';

import postgres, { type Sql, type TransactionSql } from 'postgres';
import { z } from 'zod';

import { type ModerationSubject, verifyEnvelope } from '@wokesocial/protocol';

import type { EncryptedPayload, ModerationKeyRing } from './encryption.js';
import { ModerationServiceError } from './errors.js';
import {
  actionInputSchema,
  canTransitionCase,
  caseStateSchema,
  operatorPermissionSchema,
  type AccessEvent,
  type ActionReview,
  type CaseEvent,
  type CaseLedger,
  type CaseSnapshot,
  type MaintenanceResult,
  type ModerationAction,
  type TransparencyReport,
} from './models.js';
import {
  assertActionTimes,
  assertConflictOverride,
  buildTransparencyReport,
  bytesEqual,
  subjectKey,
  type AppealEnvelope,
  type ModerationCase,
  type ModerationStore,
  type PutResult,
  type ReportEnvelope,
  type StoredSafetyObject,
  type StoreAccessInput,
  type StoreActionInput,
  type StoreLegalHoldInput,
  type StoreMaintenanceInput,
  type StoreReviewInput,
  type StoreTransitionInput,
  type StoreTransparencyInput,
} from './store.js';

interface PublicObjectRow {
  readonly object_id: string;
  readonly cid: string;
  readonly canonical_bytes: Uint8Array;
  readonly received_at: Date | string;
}

interface RestrictedObjectRow {
  readonly object_id: string;
  readonly object_type: 'appeal' | 'report';
  readonly cid: string;
  readonly received_at: Date | string;
  readonly decision_id: string | null;
  readonly encrypted_payload: unknown;
}

interface CaseRow {
  readonly report_id: string;
  readonly state: string;
  readonly version: string | number | bigint;
  readonly created_at: Date | string;
  readonly updated_at: Date | string;
  readonly closed_at: Date | string | null;
  readonly legal_hold: boolean;
}

interface CaseEventRow {
  readonly event_id: string;
  readonly report_id: string;
  readonly case_version: string | number | bigint;
  readonly event_type: string;
  readonly state: string;
  readonly created_at: Date | string;
  readonly encrypted_detail: unknown;
}

interface ActionRow {
  readonly action_id: string;
  readonly report_id: string;
  readonly action_kind: string;
  readonly created_at: Date | string;
  readonly effective_at: Date | string;
  readonly expires_at: Date | string | null;
  readonly review_due_at: Date | string | null;
  readonly supersedes_action_id: string | null;
  readonly encrypted_detail: unknown;
  readonly current_status?: string;
}

interface ReviewRow {
  readonly review_id: string;
  readonly report_id: string;
  readonly action_id: string;
  readonly appeal_id: string | null;
  readonly outcome: string;
  readonly created_at: Date | string;
  readonly encrypted_detail: unknown;
}

interface AccessRow {
  readonly access_id: string;
  readonly report_id: string | null;
  readonly operation: string;
  readonly allowed: boolean;
  readonly created_at: Date | string;
  readonly encrypted_detail: unknown;
}

interface EncryptionProbeRow {
  readonly record_type: string;
  readonly record_id: string;
  readonly encrypted_payload: unknown;
}

const caseEventDetailSchema = z
  .object({
    actorId: z.string().min(1).max(160),
    assertionId: z.string().min(1).max(220),
    permission: z.union([operatorPermissionSchema, z.enum(['reporter', 'system'])]),
    reasonCode: z.string().min(1).max(96),
    note: z.string().max(4_000).optional(),
  })
  .strict();
const storedActionDetailSchema = z
  .object({
    action: z.record(z.string(), z.unknown()),
    actorId: z.string().min(1).max(160),
    assertionId: z.string().min(1).max(220),
    permission: z.enum(['case.act', 'case.emergency']),
  })
  .strict();
const reviewDetailSchema = z
  .object({
    actorId: z.string().min(1).max(160),
    assertionId: z.string().min(1).max(220),
    permission: z.enum(['appeal.review', 'emergency.review']),
    rationale: z.string().min(1).max(4_000),
    restoration: z.string().max(2_000).optional(),
    conflictOverrideReason: z.string().max(2_000).optional(),
  })
  .strict();
const accessDetailSchema = z
  .object({
    actorId: z.string().min(1).max(160),
    assertionId: z.string().min(1).max(220),
    purpose: z.string().min(1).max(160),
    requestedReportId: z.string().optional(),
  })
  .strict();

export class PostgresModerationStore implements ModerationStore {
  readonly kind = 'postgres';
  readonly #sql: Sql;
  readonly #keys: ModerationKeyRing;

  constructor(databaseUrl: string, keys: ModerationKeyRing) {
    this.#sql = postgres(databaseUrl, {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
      transform: { undefined: null },
    });
    this.#keys = keys;
  }

  async put(object: StoredSafetyObject): Promise<PutResult> {
    return object.envelope.payload.type === 'moderation-label'
      ? this.#putPublic(object)
      : this.#putRestricted(object);
  }

  async get(objectId: string): Promise<StoredSafetyObject | undefined> {
    try {
      const publicRows = await this.#sql<PublicObjectRow[]>`
        SELECT object_id, cid, canonical_bytes, received_at
        FROM moderation_public_objects
        WHERE object_id = ${objectId}
      `;
      if (publicRows[0] !== undefined) return this.#publicFromRow(publicRows[0]);
      const restrictedRows = await this.#sql<RestrictedObjectRow[]>`
        SELECT object_id, object_type, cid, received_at, decision_id, encrypted_payload
        FROM moderation_restricted_objects
        WHERE object_id = ${objectId}
      `;
      return restrictedRows[0] === undefined
        ? undefined
        : this.#restrictedFromRow(restrictedRows[0]);
    } catch (error) {
      throw databaseFailure('The moderation object could not be read.', error);
    }
  }

  async activeLabels(subject: ModerationSubject, at: Date): Promise<readonly StoredSafetyObject[]> {
    try {
      const rows = await this.#sql<PublicObjectRow[]>`
        SELECT current.object_id, current.cid, current.canonical_bytes, current.received_at
        FROM moderation_public_objects AS current
        WHERE current.subject_key = ${subjectKey(subject)}
          AND (current.expires_at IS NULL OR current.expires_at > ${at.toISOString()})
          AND NOT EXISTS (
            SELECT 1
            FROM moderation_public_objects AS replacement
            WHERE replacement.supersedes_id = current.object_id
          )
        ORDER BY current.object_id
      `;
      return Promise.all(rows.map((row) => this.#publicFromRow(row)));
    } catch (error) {
      throw databaseFailure('Active moderation labels could not be read.', error);
    }
  }

  async getCase(reportId: string): Promise<ModerationCase | undefined> {
    const report = await this.get(reportId);
    if (report?.envelope.payload.type !== 'report') return undefined;
    try {
      const rows = await this.#sql<RestrictedObjectRow[]>`
        SELECT object_id, object_type, cid, received_at, decision_id, encrypted_payload
        FROM moderation_restricted_objects
        WHERE object_type = 'appeal'
          AND decision_id = ${reportId}
        ORDER BY object_id
      `;
      const appeals = await Promise.all(rows.map((row) => this.#restrictedFromRow(row)));
      return {
        report: report as StoredSafetyObject & { readonly envelope: ReportEnvelope },
        appeals: appeals as readonly (StoredSafetyObject & {
          readonly envelope: AppealEnvelope;
        })[],
      };
    } catch (error) {
      throw databaseFailure('The restricted moderation case could not be read.', error);
    }
  }

  async getCaseSnapshot(reportId: string): Promise<CaseSnapshot | undefined> {
    try {
      const rows = await this.#sql<CaseRow[]>`
        SELECT *
        FROM moderation_cases
        WHERE report_id = ${reportId}
      `;
      return rows[0] === undefined ? undefined : snapshotFromRow(rows[0]);
    } catch (error) {
      throw databaseFailure('The moderation case snapshot could not be read.', error);
    }
  }

  async getCaseLedger(reportId: string): Promise<CaseLedger | undefined> {
    try {
      const snapshot = await this.getCaseSnapshot(reportId);
      if (snapshot === undefined) return undefined;
      const [eventRows, actionRows, reviewRows, accessRows] = await Promise.all([
        this.#sql<CaseEventRow[]>`
          SELECT *
          FROM moderation_case_events
          WHERE report_id = ${reportId}
          ORDER BY case_version
        `,
        this.#sql<ActionRow[]>`
          SELECT action.*,
            (
              SELECT status
              FROM moderation_action_status_events AS status
              WHERE status.action_id = action.action_id
              ORDER BY
                status.created_at DESC,
                CASE status.status
                  WHEN 'expired' THEN 5
                  WHEN 'reversed' THEN 4
                  WHEN 'reviewed' THEN 3
                  WHEN 'review-required' THEN 2
                  ELSE 1
                END DESC,
                status.event_id DESC
              LIMIT 1
            ) AS current_status
          FROM moderation_actions AS action
          WHERE report_id = ${reportId}
          ORDER BY created_at, action_id
        `,
        this.#sql<ReviewRow[]>`
          SELECT *
          FROM moderation_reviews
          WHERE report_id = ${reportId}
          ORDER BY created_at, review_id
        `,
        this.#sql<AccessRow[]>`
          SELECT *
          FROM moderation_access_events
          WHERE report_id = ${reportId}
          ORDER BY created_at, access_id
        `,
      ]);
      return {
        snapshot,
        events: eventRows.map((row) => this.#caseEventFromRow(row)),
        actions: actionRows.map((row) => this.#actionFromRow(row)),
        reviews: reviewRows.map((row) => this.#reviewFromRow(row)),
        access: accessRows.map((row) => this.#accessFromRow(row)),
      };
    } catch (error) {
      throw databaseFailure('The moderation case ledger could not be read.', error);
    }
  }

  async transitionCase(input: StoreTransitionInput): Promise<CaseSnapshot> {
    try {
      return await this.#sql.begin(async (sql) => {
        const current = await lockCase(sql, input.reportId, input.transition.expectedVersion);
        if (!canTransitionCase(current.state, input.transition.toState)) {
          throw new ModerationServiceError(
            `The case cannot transition from ${current.state} to ${input.transition.toState}.`,
            'invalid-transition',
          );
        }
        return this.#advanceCase(sql, current, {
          state: input.transition.toState,
          now: input.now,
          eventType: 'case-transitioned',
          actorId: input.assertion.actorId,
          assertionId: input.assertion.assertionId,
          permission: input.permission,
          reasonCode: input.transition.reasonCode,
          ...(input.transition.note === undefined ? {} : { note: input.transition.note }),
        });
      });
    } catch (error) {
      throw databaseFailure('The moderation case transition failed.', error);
    }
  }

  async applyAction(input: StoreActionInput): Promise<ModerationAction> {
    try {
      return await this.#sql.begin(async (sql) => {
        const current = await lockCase(sql, input.reportId, input.action.expectedVersion);
        if (current.state !== 'under-review' && current.state !== 'appealed') {
          throw new ModerationServiceError(
            'Moderation actions require an under-review or appealed case.',
            'invalid-transition',
          );
        }
        const effectiveAt = input.action.effectiveAt ?? input.now;
        assertActionTimes(
          input.now,
          effectiveAt,
          input.action.expiresAt,
          input.action.reviewDueAt,
          input.action.appealDeadline,
        );
        if (input.action.supersedesActionId !== undefined) {
          const prior = await sql<{ report_id: string }[]>`
            SELECT report_id
            FROM moderation_actions
            WHERE action_id = ${input.action.supersedesActionId}
            FOR UPDATE
          `;
          if (prior[0]?.report_id !== input.reportId) {
            throw new ModerationServiceError(
              'The superseded moderation action is unavailable in this case.',
              'action-not-found',
            );
          }
        }
        const actionId = randomUUID();
        const actionDetail: Record<string, unknown> = { ...input.action };
        delete actionDetail['expectedVersion'];
        const detail = {
          action: actionDetail,
          actorId: input.assertion.actorId,
          assertionId: input.assertion.assertionId,
          permission: input.permission,
        };
        const encryptedDetail = this.#keys.encryptJson(
          `action:${input.action.kind}`,
          actionId,
          detail,
        );
        await sql`
          INSERT INTO moderation_actions (
            action_id, report_id, action_kind, created_at, effective_at,
            expires_at, review_due_at, supersedes_action_id, encrypted_detail
          ) VALUES (
            ${actionId}, ${input.reportId}, ${input.action.kind}, ${input.now}, ${effectiveAt},
            ${input.action.expiresAt ?? null}, ${input.action.reviewDueAt ?? null},
            ${input.action.supersedesActionId ?? null},
            ${sql.json(toJsonValue(encryptedDetail))}
          )
        `;
        await this.#appendActionStatus(sql, actionId, 'active', input.now, {
          actorId: input.assertion.actorId,
          assertionId: input.assertion.assertionId,
          reason: 'action-applied',
        });
        await this.#advanceCase(sql, current, {
          state: 'action-taken',
          now: input.now,
          eventType: 'moderation-action-applied',
          actorId: input.assertion.actorId,
          assertionId: input.assertion.assertionId,
          permission: input.permission,
          reasonCode: `action.${input.action.kind}`,
          note: `action:${actionId}`,
        });
        return this.#actionFromRow({
          action_id: actionId,
          report_id: input.reportId,
          action_kind: input.action.kind,
          created_at: input.now,
          effective_at: effectiveAt,
          expires_at: input.action.expiresAt ?? null,
          review_due_at: input.action.reviewDueAt ?? null,
          supersedes_action_id: input.action.supersedesActionId ?? null,
          encrypted_detail: encryptedDetail,
          current_status: 'active',
        });
      });
    } catch (error) {
      throw databaseFailure('The moderation action could not be applied.', error);
    }
  }

  async reviewAction(input: StoreReviewInput): Promise<ActionReview> {
    try {
      return await this.#sql.begin(async (sql) => {
        const current = await lockCase(sql, input.reportId, input.review.expectedVersion);
        if (current.state !== 'action-taken' && current.state !== 'appealed') {
          throw new ModerationServiceError(
            'Moderation action review requires an action-taken or appealed case.',
            'invalid-transition',
          );
        }
        const rows = await sql<ActionRow[]>`
          SELECT action.*,
            (
              SELECT status
              FROM moderation_action_status_events AS status
              WHERE status.action_id = action.action_id
              ORDER BY
                status.created_at DESC,
                CASE status.status
                  WHEN 'expired' THEN 5
                  WHEN 'reversed' THEN 4
                  WHEN 'reviewed' THEN 3
                  WHEN 'review-required' THEN 2
                  ELSE 1
                END DESC,
                status.event_id DESC
              LIMIT 1
            ) AS current_status
          FROM moderation_actions AS action
          WHERE action_id = ${input.review.actionId}
          FOR UPDATE
        `;
        const actionRow = rows[0];
        if (actionRow === undefined || actionRow.report_id !== input.reportId) {
          throw new ModerationServiceError(
            'The moderation action is unavailable in this case.',
            'action-not-found',
          );
        }
        const action = this.#actionFromRow(actionRow);
        if (action.currentStatus !== 'active' && action.currentStatus !== 'review-required') {
          throw new ModerationServiceError(
            'The moderation action already has a terminal review or expiry state.',
            'case-conflict',
          );
        }
        if (input.review.appealId !== undefined) {
          const appeals = await sql<{ decision_id: string | null; received_at: Date | string }[]>`
            SELECT decision_id, received_at
            FROM moderation_restricted_objects
            WHERE object_id = ${input.review.appealId}
              AND object_type = 'appeal'
          `;
          if (appeals[0]?.decision_id !== input.reportId) {
            throw new ModerationServiceError(
              'The appeal is unavailable in this case.',
              'appeal-not-found',
            );
          }
          if (
            !action.appealEligible ||
            action.appealDeadline === undefined ||
            Date.parse(dateString(appeals[0].received_at)) > Date.parse(action.appealDeadline)
          ) {
            throw new ModerationServiceError(
              'The action is not eligible for this appeal review.',
              'case-conflict',
            );
          }
        } else if (action.kind !== 'emergency-safety') {
          throw new ModerationServiceError(
            'Only emergency actions may use the secondary-review path without an appeal.',
            'case-conflict',
          );
        }
        assertConflictOverride(
          action.actorId,
          input.assertion,
          input.review.conflictOverrideReason,
        );
        const reviewId = randomUUID();
        const detail = {
          actorId: input.assertion.actorId,
          assertionId: input.assertion.assertionId,
          permission: input.permission,
          rationale: input.review.rationale,
          ...(input.review.restoration === undefined
            ? {}
            : { restoration: input.review.restoration }),
          ...(input.review.conflictOverrideReason === undefined
            ? {}
            : { conflictOverrideReason: input.review.conflictOverrideReason }),
        };
        try {
          await sql`
            INSERT INTO moderation_reviews (
              review_id, report_id, action_id, appeal_id, outcome, created_at, encrypted_detail
            ) VALUES (
              ${reviewId}, ${input.reportId}, ${input.review.actionId},
              ${input.review.appealId ?? null}, ${input.review.outcome}, ${input.now},
              ${sql.json(toJsonValue(this.#keys.encryptJson('review', reviewId, detail)))}
            )
          `;
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ModerationServiceError(
              'This action and appeal already have a review decision.',
              'case-conflict',
            );
          }
          throw error;
        }
        await this.#appendActionStatus(
          sql,
          action.actionId,
          input.review.outcome === 'reversed' ? 'reversed' : 'reviewed',
          input.now,
          {
            actorId: input.assertion.actorId,
            assertionId: input.assertion.assertionId,
            reviewId,
          },
        );
        await this.#advanceCase(sql, current, {
          state: input.review.outcome === 'reversed' ? 'no-action' : 'action-taken',
          now: input.now,
          eventType: 'moderation-action-reviewed',
          actorId: input.assertion.actorId,
          assertionId: input.assertion.assertionId,
          permission: input.permission,
          reasonCode: `review.${input.review.outcome}`,
          note: `review:${reviewId}`,
        });
        return {
          reviewId,
          reportId: input.reportId,
          actionId: input.review.actionId,
          ...(input.review.appealId === undefined ? {} : { appealId: input.review.appealId }),
          outcome: input.review.outcome,
          actorId: input.assertion.actorId,
          assertionId: input.assertion.assertionId,
          permission: input.permission,
          rationale: input.review.rationale,
          ...(input.review.restoration === undefined
            ? {}
            : { restoration: input.review.restoration }),
          ...(input.review.conflictOverrideReason === undefined
            ? {}
            : { conflictOverrideReason: input.review.conflictOverrideReason }),
          createdAt: input.now,
        };
      });
    } catch (error) {
      throw databaseFailure('The moderation action review failed.', error);
    }
  }

  async setLegalHold(input: StoreLegalHoldInput): Promise<CaseSnapshot> {
    try {
      return await this.#sql.begin(async (sql) => {
        const current = await lockCase(sql, input.reportId, input.hold.expectedVersion);
        if (current.legalHold === input.hold.active) {
          throw new ModerationServiceError(
            'The requested legal-hold state is already current.',
            'case-conflict',
          );
        }
        const eventId = randomUUID();
        await sql`
          INSERT INTO moderation_legal_hold_events (
            event_id, report_id, active, created_at, encrypted_detail
          ) VALUES (
            ${eventId}, ${input.reportId}, ${input.hold.active}, ${input.now},
            ${sql.json(
              toJsonValue(
                this.#keys.encryptJson('legal-hold', eventId, {
                  actorId: input.assertion.actorId,
                  assertionId: input.assertion.assertionId,
                  reason: input.hold.reason,
                }),
              ),
            )}
          )
        `;
        return this.#advanceCase(sql, current, {
          state: current.state,
          now: input.now,
          eventType: input.hold.active ? 'legal-hold-applied' : 'legal-hold-released',
          actorId: input.assertion.actorId,
          assertionId: input.assertion.assertionId,
          permission: 'case.legal-hold',
          reasonCode: input.hold.active ? 'legal-hold.applied' : 'legal-hold.released',
          note: input.hold.reason,
          legalHold: input.hold.active,
        });
      });
    } catch (error) {
      throw databaseFailure('The moderation legal hold could not be changed.', error);
    }
  }

  async recordAccess(input: StoreAccessInput): Promise<AccessEvent> {
    try {
      const rows =
        input.reportId === undefined
          ? []
          : await this.#sql<{ report_id: string }[]>`
              SELECT report_id FROM moderation_cases WHERE report_id = ${input.reportId}
            `;
      const linkedReportId = rows[0]?.report_id;
      const accessId = randomUUID();
      const detail = {
        actorId: input.actorId,
        assertionId: input.assertionId,
        purpose: input.purpose,
        ...(input.reportId === undefined ? {} : { requestedReportId: input.reportId }),
      };
      await this.#sql`
        INSERT INTO moderation_access_events (
          access_id, report_id, operation, allowed, created_at, encrypted_detail
        ) VALUES (
          ${accessId}, ${linkedReportId ?? null}, ${input.operation}, ${input.allowed}, ${input.now},
          ${this.#sql.json(
            toJsonValue(this.#keys.encryptJson(`access:${input.operation}`, accessId, detail)),
          )}
        )
      `;
      return {
        accessId,
        ...(linkedReportId === undefined ? {} : { reportId: linkedReportId }),
        operation: input.operation,
        allowed: input.allowed,
        actorId: input.actorId,
        assertionId: input.assertionId,
        purpose: input.purpose,
        createdAt: input.now,
      };
    } catch (error) {
      throw databaseFailure('The moderation access event could not be recorded.', error);
    }
  }

  async runMaintenance(input: StoreMaintenanceInput): Promise<MaintenanceResult> {
    try {
      return await this.#sql.begin(async (sql) => {
        let reviewRequired = 0;
        let actionsExpired = 0;
        const due = await sql<ActionRow[]>`
          SELECT action.*,
            (
              SELECT status
              FROM moderation_action_status_events AS status
              WHERE status.action_id = action.action_id
              ORDER BY
                status.created_at DESC,
                CASE status.status
                  WHEN 'expired' THEN 5
                  WHEN 'reversed' THEN 4
                  WHEN 'reviewed' THEN 3
                  WHEN 'review-required' THEN 2
                  ELSE 1
                END DESC,
                status.event_id DESC
              LIMIT 1
            ) AS current_status
          FROM moderation_actions AS action
          WHERE (
            (
              action.review_due_at IS NOT NULL
              AND action.review_due_at <= ${input.now}
            )
            OR (
              action.expires_at IS NOT NULL
              AND action.expires_at <= ${input.now}
            )
          )
          AND COALESCE(
            (
              SELECT status
              FROM moderation_action_status_events AS current_status
              WHERE current_status.action_id = action.action_id
              ORDER BY
                current_status.created_at DESC,
                CASE current_status.status
                  WHEN 'expired' THEN 5
                  WHEN 'reversed' THEN 4
                  WHEN 'reviewed' THEN 3
                  WHEN 'review-required' THEN 2
                  ELSE 1
                END DESC,
                current_status.event_id DESC
              LIMIT 1
            ),
            'active'
          ) IN ('active', 'review-required')
          ORDER BY action.action_id
          LIMIT ${input.dueActionLimit}
          FOR UPDATE OF action
        `;
        for (const row of due) {
          let status = row.current_status ?? 'active';
          if (
            row.review_due_at !== null &&
            Date.parse(dateString(row.review_due_at)) <= Date.parse(input.now) &&
            status === 'active'
          ) {
            const inserted = await this.#appendActionStatus(
              sql,
              row.action_id,
              'review-required',
              input.now,
              { actorId: 'system:moderation-maintenance', reason: 'review-deadline-passed' },
              true,
            );
            if (inserted) {
              await this.#advanceSystemCase(
                sql,
                row.report_id,
                input.now,
                'emergency-review-required',
                `action:${row.action_id}`,
              );
              reviewRequired += 1;
            }
            status = 'review-required';
          }
          if (
            row.expires_at !== null &&
            Date.parse(dateString(row.expires_at)) <= Date.parse(input.now) &&
            (status === 'active' || status === 'review-required')
          ) {
            const inserted = await this.#appendActionStatus(
              sql,
              row.action_id,
              'expired',
              input.now,
              { actorId: 'system:moderation-maintenance', reason: 'expiry-passed' },
              true,
            );
            if (inserted) {
              await this.#advanceSystemCase(
                sql,
                row.report_id,
                input.now,
                'moderation-action-expired',
                `action:${row.action_id}`,
              );
              actionsExpired += 1;
            }
          }
        }

        return {
          reviewRequired,
          actionsExpired,
          casesRemoved: 0,
        };
      });
    } catch (error) {
      throw databaseFailure('Moderation retention and expiry maintenance failed.', error);
    }
  }

  async transparency(input: StoreTransparencyInput): Promise<TransparencyReport> {
    try {
      const [
        reportRows,
        appealCountRows,
        actionRows,
        reviewRows,
        triageRows,
        appealTimeRows,
        overdue,
      ] = await Promise.all([
        this.#sql<RestrictedObjectRow[]>`
            SELECT object_id, object_type, cid, received_at, decision_id, encrypted_payload
            FROM moderation_restricted_objects
            WHERE object_type = 'report'
              AND received_at >= ${input.from}
              AND received_at < ${input.to}
            ORDER BY object_id
          `,
        this.#sql<{ count: string }[]>`
            SELECT count(*)::text AS count
            FROM moderation_restricted_objects
            WHERE object_type = 'appeal'
              AND received_at >= ${input.from}
              AND received_at < ${input.to}
          `,
        this.#sql<ActionRow[]>`
            SELECT action.*,
              (
                SELECT status
                FROM moderation_action_status_events AS status
                WHERE status.action_id = action.action_id
                ORDER BY
                  status.created_at DESC,
                  CASE status.status
                    WHEN 'expired' THEN 5
                    WHEN 'reversed' THEN 4
                    WHEN 'reviewed' THEN 3
                    WHEN 'review-required' THEN 2
                    ELSE 1
                  END DESC,
                  status.event_id DESC
                LIMIT 1
              ) AS current_status
            FROM moderation_actions AS action
            WHERE created_at >= ${input.from}
              AND created_at < ${input.to}
            ORDER BY action_id
          `,
        this.#sql<ReviewRow[]>`
            SELECT *
            FROM moderation_reviews
            WHERE created_at >= ${input.from}
              AND created_at < ${input.to}
            ORDER BY review_id
          `,
        this.#sql<{ duration_ms: string }[]>`
            SELECT (
              EXTRACT(EPOCH FROM (first_triage.created_at - cases.created_at)) * 1000
            )::bigint::text AS duration_ms
            FROM moderation_cases AS cases
            CROSS JOIN LATERAL (
              SELECT created_at
              FROM moderation_case_events
              WHERE report_id = cases.report_id
                AND state IN ('awaiting-triage', 'under-review')
              ORDER BY case_version
              LIMIT 1
            ) AS first_triage
            WHERE cases.created_at >= ${input.from}
              AND cases.created_at < ${input.to}
          `,
        this.#sql<{ duration_ms: string }[]>`
            SELECT (
              EXTRACT(EPOCH FROM (reviews.created_at - appeals.received_at)) * 1000
            )::bigint::text AS duration_ms
            FROM moderation_reviews AS reviews
            JOIN moderation_restricted_objects AS appeals
              ON appeals.object_id = reviews.appeal_id
            WHERE reviews.created_at >= ${input.from}
              AND reviews.created_at < ${input.to}
          `,
        this.#sql<{ count: string }[]>`
            SELECT count(*)::text AS count
            FROM moderation_action_status_events
            WHERE status = 'review-required'
              AND created_at >= ${input.from}
              AND created_at < ${input.to}
          `,
      ]);
      const categories = new Map<string, number>();
      for (const row of reportRows) {
        const stored = await this.#restrictedFromRow(row);
        if (stored.envelope.payload.type === 'report') {
          const category = stored.envelope.payload.content.category;
          categories.set(category, (categories.get(category) ?? 0) + 1);
        }
      }
      const actions = actionRows.map((row) => this.#actionFromRow(row));
      const reviews = reviewRows.map((row) => this.#reviewFromRow(row));
      return buildTransparencyReport({
        input,
        reports: reportRows.length,
        appeals: Number(appealCountRows[0]?.count ?? 0),
        actions,
        reviews,
        categories,
        triageDurations: triageRows.map((row) => Number(row.duration_ms)),
        appealDurations: appealTimeRows.map((row) => Number(row.duration_ms)),
        overdueEmergencyReviews: Number(overdue[0]?.count ?? 0),
      });
    } catch (error) {
      throw databaseFailure('The moderation transparency report could not be built.', error);
    }
  }

  async readiness(): Promise<void> {
    try {
      const readinessRows = await this.#sql<{ ready: boolean }[]>`
        WITH required_tables(name) AS (
          VALUES
            ('moderation_access_events'),
            ('moderation_action_status_events'),
            ('moderation_actions'),
            ('moderation_case_events'),
            ('moderation_cases'),
            ('moderation_legal_hold_events'),
            ('moderation_public_objects'),
            ('moderation_restricted_objects'),
            ('moderation_reviews')
        ),
        update_tables(name) AS (
          VALUES
            ('moderation_actions'),
            ('moderation_cases'),
            ('moderation_public_objects'),
            ('moderation_restricted_objects')
        )
        SELECT
          (
            SELECT count(*) = 3
              AND bool_and(checksum ~ '^[0-9a-f]{64}$')
              AND bool_or(version = '0003_guarded_retention.sql')
            FROM moderation_schema_migrations
          )
          AND NOT EXISTS (
            SELECT 1
            FROM required_tables
            CROSS JOIN (
              VALUES ('SELECT'), ('INSERT')
            ) AS required_privileges(name)
            WHERE NOT has_table_privilege(
              current_user,
              required_tables.name,
              required_privileges.name
            )
          )
          AND NOT EXISTS (
            SELECT 1
            FROM update_tables
            WHERE NOT has_table_privilege(current_user, update_tables.name, 'UPDATE')
          )
          AND NOT EXISTS (
            SELECT 1
            FROM required_tables
            WHERE has_table_privilege(current_user, required_tables.name, 'DELETE')
              OR (
                required_tables.name NOT IN (SELECT name FROM update_tables)
                AND has_table_privilege(current_user, required_tables.name, 'UPDATE')
              )
          )
          AND has_table_privilege(current_user, 'moderation_schema_migrations', 'SELECT')
          AND NOT has_table_privilege(
            current_user,
            'moderation_schema_migrations',
            'INSERT'
          )
          AND NOT has_table_privilege(
            current_user,
            'moderation_schema_migrations',
            'UPDATE'
          )
          AND NOT has_table_privilege(
            current_user,
            'moderation_schema_migrations',
            'DELETE'
          )
          AS ready
      `;
      if (readinessRows[0]?.ready !== true) {
        throw new ModerationServiceError(
          'Moderation migrations or runtime privileges are incomplete.',
          'database-unavailable',
        );
      }
      const encryptedRows = await this.#sql<RestrictedObjectRow[]>`
        SELECT DISTINCT ON (encrypted_payload->>'keyId')
          object_id, object_type, cid, received_at, decision_id, encrypted_payload
        FROM moderation_restricted_objects
        ORDER BY encrypted_payload->>'keyId', received_at DESC
        LIMIT 16
      `;
      await Promise.all(encryptedRows.map((row) => this.#restrictedFromRow(row)));
      const detailRows = await this.#sql<EncryptionProbeRow[]>`
        SELECT DISTINCT ON (record_class, key_id)
          record_type, record_id, encrypted_payload
        FROM (
          SELECT
            'case-event' AS record_class,
            'case-event:' || event_type AS record_type,
            event_id::text AS record_id,
            encrypted_detail AS encrypted_payload,
            encrypted_detail->>'keyId' AS key_id
          FROM moderation_case_events
          UNION ALL
          SELECT
            'action',
            'action:' || action_kind,
            action_id::text,
            encrypted_detail,
            encrypted_detail->>'keyId'
          FROM moderation_actions
          UNION ALL
          SELECT
            'action-status',
            'action-status:' || status,
            event_id::text,
            encrypted_detail,
            encrypted_detail->>'keyId'
          FROM moderation_action_status_events
          UNION ALL
          SELECT
            'review',
            'review',
            review_id::text,
            encrypted_detail,
            encrypted_detail->>'keyId'
          FROM moderation_reviews
          UNION ALL
          SELECT
            'access',
            'access:' || operation,
            access_id::text,
            encrypted_detail,
            encrypted_detail->>'keyId'
          FROM moderation_access_events
          UNION ALL
          SELECT
            'legal-hold',
            'legal-hold',
            event_id::text,
            encrypted_detail,
            encrypted_detail->>'keyId'
          FROM moderation_legal_hold_events
        ) AS candidates
        WHERE key_id IS NOT NULL
        ORDER BY record_class, key_id, record_id
        LIMIT 128
      `;
      for (const row of detailRows) {
        this.#keys.decryptJson(row.record_type, row.record_id, row.encrypted_payload);
      }
    } catch (error) {
      throw databaseFailure('The moderation database is unavailable.', error);
    }
  }

  async close(): Promise<void> {
    await this.#sql.end({ timeout: 5 });
  }

  async #putPublic(object: StoredSafetyObject): Promise<PutResult> {
    try {
      return await this.#sql.begin(async (sql) => {
        const existing = await sql<PublicObjectRow[]>`
          SELECT object_id, cid, canonical_bytes, received_at
          FROM moderation_public_objects
          WHERE object_id = ${object.objectId}
          FOR UPDATE
        `;
        if (existing[0] !== undefined) {
          const stored = await this.#publicFromRow(existing[0]);
          assertSameObject(stored, object);
          return { duplicate: true, stored };
        }
        const payload = object.envelope.payload;
        if (payload.type !== 'moderation-label') {
          throw new ModerationServiceError('Expected a public moderation label.', 'invalid-object');
        }
        const supersedes = payload.content.supersedes?.id;
        if (supersedes !== undefined) {
          const priorRows = await sql<PublicObjectRow[]>`
            SELECT object_id, cid, canonical_bytes, received_at
            FROM moderation_public_objects
            WHERE object_id = ${supersedes}
            FOR UPDATE
          `;
          const prior =
            priorRows[0] === undefined ? undefined : await this.#publicFromRow(priorRows[0]);
          if (prior?.envelope.payload.type !== 'moderation-label') {
            throw new ModerationServiceError(
              'The superseded moderation label is not present.',
              'superseded-label-not-found',
            );
          }
          if (prior.envelope.payload.author !== payload.author) {
            throw new ModerationServiceError(
              'One moderation provider cannot supersede another provider’s label.',
              'label-provider-mismatch',
            );
          }
          if (
            subjectKey(prior.envelope.payload.content.subject) !==
            subjectKey(payload.content.subject)
          ) {
            throw new ModerationServiceError(
              'A replacement label must keep the same subject.',
              'label-subject-mismatch',
            );
          }
        }
        try {
          const inserted = await sql`
            INSERT INTO moderation_public_objects (
              object_id, cid, canonical_bytes, author_id, subject_key,
              received_at, expires_at, supersedes_id
            ) VALUES (
              ${object.objectId}, ${object.cid}, ${object.canonicalBytes}, ${payload.author},
              ${subjectKey(payload.content.subject)}, ${object.receivedAt},
              ${payload.content.expiresAt ?? null}, ${supersedes ?? null}
            )
            ON CONFLICT (object_id) DO NOTHING
            RETURNING object_id
          `;
          if (inserted.length === 0) {
            const duplicateRows = await sql<PublicObjectRow[]>`
              SELECT object_id, cid, canonical_bytes, received_at
              FROM moderation_public_objects
              WHERE object_id = ${object.objectId}
            `;
            if (duplicateRows[0] === undefined) {
              throw new ModerationServiceError(
                'The moderation label conflicts with an existing replacement.',
                'conflicting-object',
              );
            }
            const duplicate = await this.#publicFromRow(duplicateRows[0]);
            assertSameObject(duplicate, object);
            return { duplicate: true, stored: duplicate };
          }
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new ModerationServiceError(
              'The moderation label already has a conflicting object or replacement.',
              'conflicting-object',
            );
          }
          throw error;
        }
        return { duplicate: false, stored: cloneForReturn(object) };
      });
    } catch (error) {
      throw databaseFailure('The public moderation label could not be stored.', error);
    }
  }

  async #putRestricted(object: StoredSafetyObject): Promise<PutResult> {
    const payload = object.envelope.payload;
    if (payload.type !== 'report' && payload.type !== 'appeal') {
      throw new ModerationServiceError('Expected restricted moderation data.', 'invalid-object');
    }
    try {
      return await this.#sql.begin(async (sql) => {
        const existing = await sql<RestrictedObjectRow[]>`
          SELECT object_id, object_type, cid, received_at, decision_id, encrypted_payload
          FROM moderation_restricted_objects
          WHERE object_id = ${object.objectId}
          FOR UPDATE
        `;
        if (existing[0] !== undefined) {
          const stored = await this.#restrictedFromRow(existing[0]);
          assertSameObject(stored, object);
          return { duplicate: true, stored };
        }
        const decisionId = payload.type === 'appeal' ? payload.content.decision.id : undefined;
        let decisionCase: CaseSnapshot | undefined;
        if (decisionId !== undefined) {
          const caseRows = await sql<CaseRow[]>`
            SELECT *
            FROM moderation_cases
            WHERE report_id = ${decisionId}
            FOR UPDATE
          `;
          decisionCase = caseRows[0] === undefined ? undefined : snapshotFromRow(caseRows[0]);
          if (decisionCase === undefined) {
            const decisions = await sql<{ object_id: string }[]>`
              SELECT object_id
              FROM moderation_public_objects
              WHERE object_id = ${decisionId}
              UNION ALL
              SELECT object_id
              FROM moderation_restricted_objects
              WHERE object_id = ${decisionId}
              LIMIT 1
            `;
            if (decisions.length === 0) {
              throw new ModerationServiceError(
                'The appealed decision is not present.',
                'appeal-decision-not-found',
              );
            }
          }
        }
        const encrypted = this.#keys.encryptBytes(
          `restricted-object:${payload.type}`,
          object.objectId,
          object.canonicalBytes,
        );
        const inserted = await sql`
          INSERT INTO moderation_restricted_objects (
            object_id, object_type, cid, received_at, decision_id, encrypted_payload
          ) VALUES (
            ${object.objectId}, ${payload.type}, ${object.cid}, ${object.receivedAt},
            ${decisionId ?? null}, ${sql.json(toJsonValue(encrypted))}
          )
          ON CONFLICT (object_id) DO NOTHING
          RETURNING object_id
        `;
        if (inserted.length === 0) {
          const duplicateRows = await sql<RestrictedObjectRow[]>`
            SELECT object_id, object_type, cid, received_at, decision_id, encrypted_payload
            FROM moderation_restricted_objects
            WHERE object_id = ${object.objectId}
          `;
          if (duplicateRows[0] === undefined) {
            throw new ModerationServiceError(
              'The restricted moderation object conflicted during ingestion.',
              'conflicting-object',
            );
          }
          const duplicate = await this.#restrictedFromRow(duplicateRows[0]);
          assertSameObject(duplicate, object);
          return { duplicate: true, stored: duplicate };
        }
        if (payload.type === 'report') {
          await sql`
            INSERT INTO moderation_cases (
              report_id, state, version, created_at, updated_at, closed_at, legal_hold
            ) VALUES (
              ${object.objectId}, 'received', 1, ${object.receivedAt},
              ${object.receivedAt}, null, false
            )
          `;
          await this.#insertCaseEvent(sql, {
            reportId: object.objectId,
            caseVersion: 1,
            eventType: 'report-received',
            state: 'received',
            now: object.receivedAt,
            actorId: payload.author,
            assertionId: `signed-report:${object.objectId}`,
            permission: 'reporter',
            reasonCode: 'report.received',
          });
        } else if (decisionId !== undefined) {
          if (decisionCase !== undefined) {
            await this.#advanceCase(sql, decisionCase, {
              state: 'appealed',
              now: object.receivedAt,
              eventType: 'appeal-received',
              actorId: payload.author,
              assertionId: `signed-appeal:${object.objectId}`,
              permission: 'reporter',
              reasonCode: 'appeal.received',
              note: `appeal:${object.objectId}`,
            });
          }
        }
        return { duplicate: false, stored: cloneForReturn(object) };
      });
    } catch (error) {
      throw databaseFailure('The restricted moderation object could not be stored.', error);
    }
  }

  async #publicFromRow(row: PublicObjectRow): Promise<StoredSafetyObject> {
    const bytes = Uint8Array.from(row.canonical_bytes);
    let verified;
    try {
      verified = await verifyEnvelope(bytes);
    } catch (error) {
      throw new ModerationServiceError(
        'A public moderation object failed stored integrity checks.',
        'corrupt-storage',
        { cause: error },
      );
    }
    if (
      verified.objectId !== row.object_id ||
      verified.cid !== row.cid ||
      verified.envelope.payload.type !== 'moderation-label'
    ) {
      throw new ModerationServiceError(
        'A public moderation object failed stored integrity checks.',
        'corrupt-storage',
      );
    }
    return {
      objectId: row.object_id,
      cid: row.cid,
      canonicalBytes: verified.canonicalBytes,
      envelope: verified.envelope as StoredSafetyObject['envelope'],
      receivedAt: dateString(row.received_at),
    };
  }

  async #restrictedFromRow(row: RestrictedObjectRow): Promise<StoredSafetyObject> {
    const bytes = this.#keys.decryptBytes(
      `restricted-object:${row.object_type}`,
      row.object_id,
      row.encrypted_payload,
    );
    try {
      let verified;
      try {
        verified = await verifyEnvelope(bytes);
      } catch (error) {
        throw new ModerationServiceError(
          'A restricted moderation object failed stored integrity checks.',
          'corrupt-storage',
          { cause: error },
        );
      }
      if (
        verified.objectId !== row.object_id ||
        verified.cid !== row.cid ||
        verified.envelope.payload.type !== row.object_type
      ) {
        throw new ModerationServiceError(
          'A restricted moderation object failed stored integrity checks.',
          'corrupt-storage',
        );
      }
      return {
        objectId: row.object_id,
        cid: row.cid,
        canonicalBytes: verified.canonicalBytes,
        envelope: verified.envelope as StoredSafetyObject['envelope'],
        receivedAt: dateString(row.received_at),
      };
    } finally {
      bytes.fill(0);
    }
  }

  #caseEventFromRow(row: CaseEventRow): CaseEvent {
    const detail = caseEventDetailSchema.parse(
      this.#keys.decryptJson(`case-event:${row.event_type}`, row.event_id, row.encrypted_detail),
    );
    return {
      eventId: row.event_id,
      reportId: row.report_id,
      caseVersion: safeInteger(row.case_version, 'case version'),
      eventType: row.event_type,
      state: caseStateSchema.parse(row.state),
      createdAt: dateString(row.created_at),
      actorId: detail.actorId,
      assertionId: detail.assertionId,
      permission: detail.permission,
      reasonCode: detail.reasonCode,
      ...(detail.note === undefined ? {} : { note: detail.note }),
    };
  }

  #actionFromRow(row: ActionRow): ModerationAction {
    const storedDetail = storedActionDetailSchema.parse(
      this.#keys.decryptJson(`action:${row.action_kind}`, row.action_id, row.encrypted_detail),
    );
    const detail = actionInputSchema.parse({
      expectedVersion: 1,
      ...storedDetail.action,
    });
    if (detail.kind !== row.action_kind) {
      throw new ModerationServiceError(
        'A moderation action does not match its encrypted type binding.',
        'corrupt-storage',
      );
    }
    return {
      actionId: row.action_id,
      reportId: row.report_id,
      kind: detail.kind,
      actorId: storedDetail.actorId,
      assertionId: storedDetail.assertionId,
      permission: storedDetail.permission,
      target: detail.target,
      ...(detail.targetHash === undefined ? {} : { targetHash: detail.targetHash }),
      scope: detail.scope,
      policyId: detail.policyId,
      policyVersion: detail.policyVersion,
      ruleId: detail.ruleId,
      reasonCategory: detail.reasonCategory,
      ...(detail.moderatorNote === undefined ? {} : { moderatorNote: detail.moderatorNote }),
      consequences: detail.consequences,
      createdAt: dateString(row.created_at),
      effectiveAt: dateString(row.effective_at),
      ...(row.expires_at === null ? {} : { expiresAt: dateString(row.expires_at) }),
      ...(row.review_due_at === null ? {} : { reviewDueAt: dateString(row.review_due_at) }),
      appealEligible: detail.appealEligible,
      ...(detail.appealDeadline === undefined ? {} : { appealDeadline: detail.appealDeadline }),
      ...(row.supersedes_action_id === null
        ? {}
        : { supersedesActionId: row.supersedes_action_id }),
      currentStatus: actionStatus(row.current_status),
    };
  }

  #reviewFromRow(row: ReviewRow): ActionReview {
    const detail = reviewDetailSchema.parse(
      this.#keys.decryptJson('review', row.review_id, row.encrypted_detail),
    );
    const outcome = z.enum(['upheld', 'modified', 'reversed']).parse(row.outcome);
    return {
      reviewId: row.review_id,
      reportId: row.report_id,
      actionId: row.action_id,
      ...(row.appeal_id === null ? {} : { appealId: row.appeal_id }),
      outcome,
      actorId: detail.actorId,
      assertionId: detail.assertionId,
      permission: detail.permission,
      rationale: detail.rationale,
      ...(detail.restoration === undefined ? {} : { restoration: detail.restoration }),
      ...(detail.conflictOverrideReason === undefined
        ? {}
        : { conflictOverrideReason: detail.conflictOverrideReason }),
      createdAt: dateString(row.created_at),
    };
  }

  #accessFromRow(row: AccessRow): AccessEvent {
    const detail = accessDetailSchema.parse(
      this.#keys.decryptJson(`access:${row.operation}`, row.access_id, row.encrypted_detail),
    );
    return {
      accessId: row.access_id,
      ...(row.report_id === null ? {} : { reportId: row.report_id }),
      operation: row.operation,
      allowed: row.allowed,
      actorId: detail.actorId,
      assertionId: detail.assertionId,
      purpose: detail.purpose,
      createdAt: dateString(row.created_at),
    };
  }

  async #advanceCase(
    sql: Sql | TransactionSql,
    current: CaseSnapshot,
    input: {
      readonly state: CaseSnapshot['state'];
      readonly now: string;
      readonly eventType: string;
      readonly actorId: string;
      readonly assertionId: string;
      readonly permission: CaseEvent['permission'];
      readonly reasonCode: string;
      readonly note?: string;
      readonly legalHold?: boolean;
    },
  ): Promise<CaseSnapshot> {
    const nextVersion = current.version + 1;
    const closedAt =
      input.state === 'closed'
        ? (current.closedAt ?? input.now)
        : input.state === current.state
          ? current.closedAt
          : undefined;
    const rows = await sql<CaseRow[]>`
      UPDATE moderation_cases
      SET state = ${input.state},
          version = ${nextVersion},
          updated_at = ${input.now},
          closed_at = ${closedAt ?? null},
          legal_hold = ${input.legalHold ?? current.legalHold}
      WHERE report_id = ${current.reportId}
        AND version = ${current.version}
      RETURNING *
    `;
    if (rows[0] === undefined) {
      throw new ModerationServiceError(
        'The moderation case changed after it was read.',
        'case-conflict',
      );
    }
    await this.#insertCaseEvent(sql, {
      reportId: current.reportId,
      caseVersion: nextVersion,
      eventType: input.eventType,
      state: input.state,
      now: input.now,
      actorId: input.actorId,
      assertionId: input.assertionId,
      permission: input.permission,
      reasonCode: input.reasonCode,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    return snapshotFromRow(rows[0]);
  }

  async #insertCaseEvent(
    sql: Sql | TransactionSql,
    input: {
      readonly reportId: string;
      readonly caseVersion: number;
      readonly eventType: string;
      readonly state: CaseSnapshot['state'];
      readonly now: string;
      readonly actorId: string;
      readonly assertionId: string;
      readonly permission: CaseEvent['permission'];
      readonly reasonCode: string;
      readonly note?: string;
    },
  ): Promise<void> {
    const eventId = randomUUID();
    const detail = {
      actorId: input.actorId,
      assertionId: input.assertionId,
      permission: input.permission,
      reasonCode: input.reasonCode,
      ...(input.note === undefined ? {} : { note: input.note }),
    };
    await sql`
      INSERT INTO moderation_case_events (
        event_id, report_id, case_version, event_type, state, created_at, encrypted_detail
      ) VALUES (
        ${eventId}, ${input.reportId}, ${input.caseVersion}, ${input.eventType},
        ${input.state}, ${input.now},
        ${sql.json(
          toJsonValue(this.#keys.encryptJson(`case-event:${input.eventType}`, eventId, detail)),
        )}
      )
    `;
  }

  async #appendActionStatus(
    sql: Sql | TransactionSql,
    actionId: string,
    status: ModerationAction['currentStatus'],
    now: string,
    detail: unknown,
    ignoreDuplicate = false,
  ): Promise<boolean> {
    const eventId = randomUUID();
    const rows = await sql`
      INSERT INTO moderation_action_status_events (
        event_id, action_id, status, created_at, encrypted_detail
      ) VALUES (
        ${eventId}, ${actionId}, ${status}, ${now},
        ${sql.json(toJsonValue(this.#keys.encryptJson(`action-status:${status}`, eventId, detail)))}
      )
      ${ignoreDuplicate ? sql`ON CONFLICT (action_id, status) DO NOTHING` : sql``}
      RETURNING event_id
    `;
    return rows.length === 1;
  }

  async #advanceSystemCase(
    sql: Sql | TransactionSql,
    reportId: string,
    now: string,
    eventType: string,
    note: string,
  ): Promise<void> {
    const rows = await sql<CaseRow[]>`
      SELECT *
      FROM moderation_cases
      WHERE report_id = ${reportId}
      FOR UPDATE
    `;
    if (rows[0] === undefined) return;
    const current = snapshotFromRow(rows[0]);
    await this.#advanceCase(sql, current, {
      state: current.state,
      now,
      eventType,
      actorId: 'system:moderation-maintenance',
      assertionId: 'system:moderation-maintenance',
      permission: 'system',
      reasonCode: eventType,
      note,
    });
  }
}

async function lockCase(
  sql: Sql | TransactionSql,
  reportId: string,
  expectedVersion: number,
): Promise<CaseSnapshot> {
  const rows = await sql<CaseRow[]>`
    SELECT *
    FROM moderation_cases
    WHERE report_id = ${reportId}
    FOR UPDATE
  `;
  if (rows[0] === undefined) {
    throw new ModerationServiceError('The moderation case was not found.', 'case-not-found');
  }
  const snapshot = snapshotFromRow(rows[0]);
  if (snapshot.version !== expectedVersion) {
    throw new ModerationServiceError(
      'The moderation case changed after it was read.',
      'case-conflict',
    );
  }
  return snapshot;
}

function snapshotFromRow(row: CaseRow): CaseSnapshot {
  const state = caseStateSchema.parse(row.state);
  return {
    reportId: row.report_id,
    state,
    version: safeInteger(row.version, 'case version'),
    createdAt: dateString(row.created_at),
    updatedAt: dateString(row.updated_at),
    ...(row.closed_at === null ? {} : { closedAt: dateString(row.closed_at) }),
    legalHold: row.legal_hold,
  };
}

function assertSameObject(existing: StoredSafetyObject, candidate: StoredSafetyObject): void {
  if (!bytesEqual(existing.canonicalBytes, candidate.canonicalBytes)) {
    throw new ModerationServiceError(
      'An object ID is already associated with different canonical bytes.',
      'conflicting-object',
    );
  }
}

function cloneForReturn(object: StoredSafetyObject): StoredSafetyObject {
  return {
    ...object,
    canonicalBytes: object.canonicalBytes.slice(),
    envelope: structuredClone(object.envelope),
  };
}

function actionStatus(value: string | undefined): ModerationAction['currentStatus'] {
  return z
    .enum(['active', 'review-required', 'reviewed', 'reversed', 'expired'])
    .parse(value ?? 'active');
}

function safeInteger(value: string | number | bigint, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ModerationServiceError(`Stored ${label} is invalid.`, 'corrupt-storage');
  }
  return parsed;
}

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toJsonValue(value: EncryptedPayload | unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

function databaseFailure(message: string, cause: unknown): ModerationServiceError {
  if (cause instanceof ModerationServiceError) return cause;
  if (cause instanceof z.ZodError) {
    return new ModerationServiceError(
      'Stored moderation data failed strict validation.',
      'corrupt-storage',
      { cause },
    );
  }
  return new ModerationServiceError(message, 'database-unavailable', { cause });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}
