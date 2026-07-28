import { randomUUID } from 'node:crypto';

import {
  canonicalizeEnvelope,
  type AppealPayload,
  type ModerationLabelPayload,
  type ModerationSubject,
  type ReportPayload,
  type SignedEnvelope,
} from '@socially-woke/protocol';

import { ModerationServiceError } from './errors.js';
import {
  canTransitionCase,
  type AccessEvent,
  type ActionInput,
  type ActionReview,
  type ActionReviewInput,
  type CaseEvent,
  type CaseLedger,
  type CaseSnapshot,
  type CaseState,
  type CaseTransitionInput,
  type LegalHoldInput,
  type MaintenanceResult,
  type ModerationAction,
  type OperatorAssertion,
  type OperatorPermission,
  type TransparencyReport,
} from './models.js';

export type ModerationEnvelope = SignedEnvelope & {
  readonly payload: ModerationLabelPayload;
};
export type ReportEnvelope = SignedEnvelope & { readonly payload: ReportPayload };
export type AppealEnvelope = SignedEnvelope & { readonly payload: AppealPayload };
export type SafetyEnvelope = ModerationEnvelope | ReportEnvelope | AppealEnvelope;

export interface StoredSafetyObject {
  readonly objectId: string;
  readonly cid: string;
  readonly canonicalBytes: Uint8Array;
  readonly envelope: SafetyEnvelope;
  readonly receivedAt: string;
}

export interface ModerationCase {
  readonly report: StoredSafetyObject & { readonly envelope: ReportEnvelope };
  readonly appeals: readonly (StoredSafetyObject & { readonly envelope: AppealEnvelope })[];
}

export interface PutResult {
  readonly duplicate: boolean;
  readonly stored: StoredSafetyObject;
}

export interface StoreTransitionInput {
  readonly reportId: string;
  readonly transition: CaseTransitionInput;
  readonly assertion: OperatorAssertion;
  readonly permission: OperatorPermission;
  readonly now: string;
}

export interface StoreActionInput {
  readonly reportId: string;
  readonly action: ActionInput;
  readonly assertion: OperatorAssertion;
  readonly permission: 'case.act' | 'case.emergency';
  readonly now: string;
}

export interface StoreReviewInput {
  readonly reportId: string;
  readonly review: ActionReviewInput;
  readonly assertion: OperatorAssertion;
  readonly permission: 'appeal.review' | 'emergency.review';
  readonly now: string;
}

export interface StoreLegalHoldInput {
  readonly reportId: string;
  readonly hold: LegalHoldInput;
  readonly assertion: OperatorAssertion;
  readonly now: string;
}

export interface StoreAccessInput {
  readonly reportId?: string;
  readonly operation: string;
  readonly allowed: boolean;
  readonly actorId: string;
  readonly assertionId: string;
  readonly purpose: string;
  readonly now: string;
}

export interface StoreMaintenanceInput {
  readonly now: string;
  readonly dueActionLimit: number;
  readonly retentionLimit: number;
  readonly closedCaseRetentionMs: number;
}

export interface StoreTransparencyInput {
  readonly from: string;
  readonly to: string;
  readonly minimumCellSize: number;
}

export interface ModerationStore {
  readonly kind: string;
  put(object: StoredSafetyObject): Promise<PutResult>;
  get(objectId: string): Promise<StoredSafetyObject | undefined>;
  activeLabels(subject: ModerationSubject, at: Date): Promise<readonly StoredSafetyObject[]>;
  getCase(reportId: string): Promise<ModerationCase | undefined>;
  getCaseSnapshot(reportId: string): Promise<CaseSnapshot | undefined>;
  getCaseLedger(reportId: string): Promise<CaseLedger | undefined>;
  transitionCase(input: StoreTransitionInput): Promise<CaseSnapshot>;
  applyAction(input: StoreActionInput): Promise<ModerationAction>;
  reviewAction(input: StoreReviewInput): Promise<ActionReview>;
  setLegalHold(input: StoreLegalHoldInput): Promise<CaseSnapshot>;
  recordAccess(input: StoreAccessInput): Promise<AccessEvent>;
  runMaintenance(input: StoreMaintenanceInput): Promise<MaintenanceResult>;
  transparency(input: StoreTransparencyInput): Promise<TransparencyReport>;
  readiness(): Promise<void>;
  close(): Promise<void>;
}

interface ActionStatusEvent {
  readonly status: ModerationAction['currentStatus'];
  readonly createdAt: string;
}

export class MemoryModerationStore implements ModerationStore {
  readonly kind = 'memory';
  readonly #objects = new Map<string, StoredSafetyObject>();
  readonly #labelsBySubject = new Map<string, Set<string>>();
  readonly #appealsByDecision = new Map<string, Set<string>>();
  readonly #supersededLabels = new Set<string>();
  readonly #replacementByLabel = new Map<string, string>();
  readonly #cases = new Map<string, CaseSnapshot>();
  readonly #events = new Map<string, CaseEvent[]>();
  readonly #actions = new Map<string, ModerationAction>();
  readonly #actionStatuses = new Map<string, ActionStatusEvent[]>();
  readonly #reviews = new Map<string, ActionReview[]>();
  readonly #access = new Map<string, AccessEvent[]>();

  async put(object: StoredSafetyObject): Promise<PutResult> {
    const existing = this.#objects.get(object.objectId);
    if (existing !== undefined) {
      if (!bytesEqual(existing.canonicalBytes, object.canonicalBytes)) {
        throw new ModerationServiceError(
          'An object ID is already associated with different canonical bytes.',
          'conflicting-object',
        );
      }
      return { duplicate: true, stored: cloneStored(existing) };
    }

    const { payload } = object.envelope;
    if (payload.type === 'moderation-label') {
      const supersedes = payload.content.supersedes?.id;
      if (supersedes !== undefined) {
        const prior = this.#objects.get(supersedes);
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
          subjectKey(prior.envelope.payload.content.subject) !== subjectKey(payload.content.subject)
        ) {
          throw new ModerationServiceError(
            'A replacement label must keep the same subject.',
            'label-subject-mismatch',
          );
        }
        if (this.#replacementByLabel.has(supersedes)) {
          throw new ModerationServiceError(
            'The moderation label already has a replacement in this provider.',
            'conflicting-object',
          );
        }
        this.#supersededLabels.add(supersedes);
        this.#replacementByLabel.set(supersedes, object.objectId);
      }
      const key = subjectKey(payload.content.subject);
      const labels = this.#labelsBySubject.get(key) ?? new Set<string>();
      labels.add(object.objectId);
      this.#labelsBySubject.set(key, labels);
    } else if (payload.type === 'appeal') {
      const decisionId = payload.content.decision.id;
      if (!this.#objects.has(decisionId)) {
        throw new ModerationServiceError(
          'The appealed decision is not present.',
          'appeal-decision-not-found',
        );
      }
      const appeals = this.#appealsByDecision.get(decisionId) ?? new Set<string>();
      appeals.add(object.objectId);
      this.#appealsByDecision.set(decisionId, appeals);
    }

    const stored = cloneStored(object);
    this.#objects.set(object.objectId, stored);
    if (payload.type === 'report') {
      const snapshot: CaseSnapshot = {
        reportId: object.objectId,
        state: 'received',
        version: 1,
        createdAt: object.receivedAt,
        updatedAt: object.receivedAt,
        legalHold: false,
      };
      this.#cases.set(object.objectId, snapshot);
      this.#events.set(object.objectId, [
        {
          eventId: randomUUID(),
          reportId: object.objectId,
          caseVersion: 1,
          eventType: 'report-received',
          state: 'received',
          createdAt: object.receivedAt,
          actorId: payload.author,
          assertionId: `signed-report:${object.objectId}`,
          permission: 'reporter',
          reasonCode: 'report.received',
        },
      ]);
    } else if (payload.type === 'appeal') {
      this.#recordAppealEvent(payload.content.decision.id, object);
    }
    return { duplicate: false, stored: cloneStored(stored) };
  }

  async get(objectId: string): Promise<StoredSafetyObject | undefined> {
    const object = this.#objects.get(objectId);
    return object === undefined ? undefined : cloneStored(object);
  }

  async activeLabels(subject: ModerationSubject, at: Date): Promise<readonly StoredSafetyObject[]> {
    const identifiers = this.#labelsBySubject.get(subjectKey(subject)) ?? new Set<string>();
    return [...identifiers]
      .filter((objectId) => !this.#supersededLabels.has(objectId))
      .map((objectId) => this.#objects.get(objectId))
      .filter(
        (object): object is StoredSafetyObject =>
          object?.envelope.payload.type === 'moderation-label' &&
          (object.envelope.payload.content.expiresAt === undefined ||
            Date.parse(object.envelope.payload.content.expiresAt) > at.getTime()),
      )
      .sort((left, right) => left.objectId.localeCompare(right.objectId))
      .map(cloneStored);
  }

  async getCase(reportId: string): Promise<ModerationCase | undefined> {
    const report = this.#objects.get(reportId);
    if (report?.envelope.payload.type !== 'report') {
      return undefined;
    }
    const appealIds = this.#appealsByDecision.get(reportId) ?? new Set<string>();
    const appeals = [...appealIds]
      .map((appealId) => this.#objects.get(appealId))
      .filter(
        (
          object,
        ): object is StoredSafetyObject & {
          readonly envelope: AppealEnvelope;
        } => object?.envelope.payload.type === 'appeal',
      )
      .sort((left, right) => left.objectId.localeCompare(right.objectId))
      .map((object) => cloneStored(object) as StoredSafetyObject & { envelope: AppealEnvelope });
    return {
      report: cloneStored(report) as StoredSafetyObject & { envelope: ReportEnvelope },
      appeals,
    };
  }

  async getCaseSnapshot(reportId: string): Promise<CaseSnapshot | undefined> {
    const snapshot = this.#cases.get(reportId);
    return snapshot === undefined ? undefined : cloneSnapshot(snapshot);
  }

  async getCaseLedger(reportId: string): Promise<CaseLedger | undefined> {
    const snapshot = this.#cases.get(reportId);
    if (snapshot === undefined) return undefined;
    return {
      snapshot: cloneSnapshot(snapshot),
      events: structuredClone(this.#events.get(reportId) ?? []),
      actions: [...this.#actions.values()]
        .filter((action) => action.reportId === reportId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((action) => this.#withCurrentStatus(action)),
      reviews: structuredClone(this.#reviews.get(reportId) ?? []),
      access: structuredClone(this.#access.get(reportId) ?? []),
    };
  }

  async transitionCase(input: StoreTransitionInput): Promise<CaseSnapshot> {
    const current = this.#requireCaseVersion(input.reportId, input.transition.expectedVersion);
    if (!canTransitionCase(current.state, input.transition.toState)) {
      throw new ModerationServiceError(
        `The case cannot transition from ${current.state} to ${input.transition.toState}.`,
        'invalid-transition',
      );
    }
    return this.#advanceCase({
      reportId: input.reportId,
      state: input.transition.toState,
      now: input.now,
      eventType: 'case-transitioned',
      actorId: input.assertion.actorId,
      assertionId: input.assertion.assertionId,
      permission: input.permission,
      reasonCode: input.transition.reasonCode,
      ...(input.transition.note === undefined ? {} : { note: input.transition.note }),
    });
  }

  async applyAction(input: StoreActionInput): Promise<ModerationAction> {
    const current = this.#requireCaseVersion(input.reportId, input.action.expectedVersion);
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
      const superseded = this.#actions.get(input.action.supersedesActionId);
      if (superseded?.reportId !== input.reportId) {
        throw new ModerationServiceError(
          'The superseded moderation action is unavailable in this case.',
          'action-not-found',
        );
      }
    }
    const action: ModerationAction = {
      actionId: randomUUID(),
      reportId: input.reportId,
      kind: input.action.kind,
      actorId: input.assertion.actorId,
      assertionId: input.assertion.assertionId,
      permission: input.permission,
      target: structuredClone(input.action.target),
      ...(input.action.targetHash === undefined ? {} : { targetHash: input.action.targetHash }),
      scope: input.action.scope,
      policyId: input.action.policyId,
      policyVersion: input.action.policyVersion,
      ruleId: input.action.ruleId,
      reasonCategory: input.action.reasonCategory,
      ...(input.action.moderatorNote === undefined
        ? {}
        : { moderatorNote: input.action.moderatorNote }),
      consequences: [...input.action.consequences],
      createdAt: input.now,
      effectiveAt,
      ...(input.action.expiresAt === undefined ? {} : { expiresAt: input.action.expiresAt }),
      ...(input.action.reviewDueAt === undefined ? {} : { reviewDueAt: input.action.reviewDueAt }),
      appealEligible: input.action.appealEligible,
      ...(input.action.appealDeadline === undefined
        ? {}
        : { appealDeadline: input.action.appealDeadline }),
      ...(input.action.supersedesActionId === undefined
        ? {}
        : { supersedesActionId: input.action.supersedesActionId }),
      currentStatus: 'active',
    };
    this.#actions.set(action.actionId, structuredClone(action));
    this.#actionStatuses.set(action.actionId, [{ status: 'active', createdAt: input.now }]);
    this.#advanceCase({
      reportId: input.reportId,
      state: 'action-taken',
      now: input.now,
      eventType: 'moderation-action-applied',
      actorId: input.assertion.actorId,
      assertionId: input.assertion.assertionId,
      permission: input.permission,
      reasonCode: `action.${input.action.kind}`,
      note: `action:${action.actionId}`,
    });
    return structuredClone(action);
  }

  async reviewAction(input: StoreReviewInput): Promise<ActionReview> {
    const current = this.#requireCaseVersion(input.reportId, input.review.expectedVersion);
    if (current.state !== 'action-taken' && current.state !== 'appealed') {
      throw new ModerationServiceError(
        'Moderation action review requires an action-taken or appealed case.',
        'invalid-transition',
      );
    }
    const action = this.#actions.get(input.review.actionId);
    if (action?.reportId !== input.reportId) {
      throw new ModerationServiceError(
        'The moderation action is unavailable in this case.',
        'action-not-found',
      );
    }
    const currentStatus = this.#currentStatus(action.actionId);
    if (currentStatus !== 'active' && currentStatus !== 'review-required') {
      throw new ModerationServiceError(
        'The moderation action already has a terminal review or expiry state.',
        'case-conflict',
      );
    }
    if (input.review.appealId !== undefined) {
      const appeal = this.#objects.get(input.review.appealId);
      if (
        appeal?.envelope.payload.type !== 'appeal' ||
        appeal.envelope.payload.content.decision.id !== input.reportId
      ) {
        throw new ModerationServiceError(
          'The appeal is unavailable in this case.',
          'appeal-not-found',
        );
      }
      if (
        !action.appealEligible ||
        action.appealDeadline === undefined ||
        Date.parse(appeal.receivedAt) > Date.parse(action.appealDeadline)
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
    const existing = this.#reviews
      .get(input.reportId)
      ?.some(
        (review) =>
          review.actionId === input.review.actionId && review.appealId === input.review.appealId,
      );
    if (existing) {
      throw new ModerationServiceError(
        'This action and appeal already have a review decision.',
        'case-conflict',
      );
    }
    assertConflictOverride(action.actorId, input.assertion, input.review.conflictOverrideReason);
    const review: ActionReview = {
      reviewId: randomUUID(),
      reportId: input.reportId,
      actionId: input.review.actionId,
      ...(input.review.appealId === undefined ? {} : { appealId: input.review.appealId }),
      outcome: input.review.outcome,
      actorId: input.assertion.actorId,
      assertionId: input.assertion.assertionId,
      permission: input.permission,
      rationale: input.review.rationale,
      ...(input.review.restoration === undefined ? {} : { restoration: input.review.restoration }),
      ...(input.review.conflictOverrideReason === undefined
        ? {}
        : { conflictOverrideReason: input.review.conflictOverrideReason }),
      createdAt: input.now,
    };
    const reviews = this.#reviews.get(input.reportId) ?? [];
    reviews.push(review);
    this.#reviews.set(input.reportId, reviews);
    this.#appendActionStatus(
      action.actionId,
      input.review.outcome === 'reversed' ? 'reversed' : 'reviewed',
      input.now,
    );
    this.#advanceCase({
      reportId: input.reportId,
      state: input.review.outcome === 'reversed' ? 'no-action' : 'action-taken',
      now: input.now,
      eventType: 'moderation-action-reviewed',
      actorId: input.assertion.actorId,
      assertionId: input.assertion.assertionId,
      permission: input.permission,
      reasonCode: `review.${input.review.outcome}`,
      note: `review:${review.reviewId}`,
    });
    return structuredClone(review);
  }

  async setLegalHold(input: StoreLegalHoldInput): Promise<CaseSnapshot> {
    const current = this.#requireCaseVersion(input.reportId, input.hold.expectedVersion);
    if (current.legalHold === input.hold.active) {
      throw new ModerationServiceError(
        'The requested legal-hold state is already current.',
        'case-conflict',
      );
    }
    const snapshot = this.#advanceCase({
      reportId: input.reportId,
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
    return snapshot;
  }

  async recordAccess(input: StoreAccessInput): Promise<AccessEvent> {
    const event: AccessEvent = {
      accessId: randomUUID(),
      ...(input.reportId === undefined ? {} : { reportId: input.reportId }),
      operation: input.operation,
      allowed: input.allowed,
      actorId: input.actorId,
      assertionId: input.assertionId,
      purpose: input.purpose,
      createdAt: input.now,
    };
    if (input.reportId !== undefined) {
      const events = this.#access.get(input.reportId) ?? [];
      events.push(event);
      this.#access.set(input.reportId, events);
    }
    return structuredClone(event);
  }

  async runMaintenance(input: StoreMaintenanceInput): Promise<MaintenanceResult> {
    let reviewRequired = 0;
    let actionsExpired = 0;
    const dueActions = [...this.#actions.values()]
      .filter((action) => {
        const status = this.#currentStatus(action.actionId);
        return (
          (action.reviewDueAt !== undefined &&
            Date.parse(action.reviewDueAt) <= Date.parse(input.now) &&
            status === 'active') ||
          (action.expiresAt !== undefined &&
            Date.parse(action.expiresAt) <= Date.parse(input.now) &&
            (status === 'active' || status === 'review-required'))
        );
      })
      .sort((left, right) => left.actionId.localeCompare(right.actionId))
      .slice(0, input.dueActionLimit);

    for (const action of dueActions) {
      let status = this.#currentStatus(action.actionId);
      if (
        action.reviewDueAt !== undefined &&
        Date.parse(action.reviewDueAt) <= Date.parse(input.now) &&
        status === 'active'
      ) {
        this.#appendActionStatus(action.actionId, 'review-required', input.now);
        this.#advanceSystemCase(
          action.reportId,
          input.now,
          'emergency-review-required',
          `action:${action.actionId}`,
        );
        reviewRequired += 1;
        status = 'review-required';
      }
      if (
        action.expiresAt !== undefined &&
        Date.parse(action.expiresAt) <= Date.parse(input.now) &&
        (status === 'active' || status === 'review-required')
      ) {
        this.#appendActionStatus(action.actionId, 'expired', input.now);
        this.#advanceSystemCase(
          action.reportId,
          input.now,
          'moderation-action-expired',
          `action:${action.actionId}`,
        );
        actionsExpired += 1;
      }
    }

    const cutoff = Date.parse(input.now) - input.closedCaseRetentionMs;
    const retained = [...this.#cases.values()]
      .filter(
        (snapshot) =>
          snapshot.state === 'closed' &&
          snapshot.closedAt !== undefined &&
          Date.parse(snapshot.closedAt) <= cutoff &&
          !snapshot.legalHold,
      )
      .sort((left, right) => left.reportId.localeCompare(right.reportId))
      .slice(0, input.retentionLimit);
    for (const snapshot of retained) {
      this.#removeCase(snapshot.reportId);
    }
    return {
      reviewRequired,
      actionsExpired,
      casesRemoved: retained.length,
    };
  }

  async transparency(input: StoreTransparencyInput): Promise<TransparencyReport> {
    const from = Date.parse(input.from);
    const to = Date.parse(input.to);
    const reports = [...this.#objects.values()].filter(
      (object) =>
        object.envelope.payload.type === 'report' &&
        Date.parse(object.receivedAt) >= from &&
        Date.parse(object.receivedAt) < to,
    );
    const appeals = [...this.#objects.values()].filter(
      (object) =>
        object.envelope.payload.type === 'appeal' &&
        Date.parse(object.receivedAt) >= from &&
        Date.parse(object.receivedAt) < to,
    );
    const actions = [...this.#actions.values()].filter(
      (action) => Date.parse(action.createdAt) >= from && Date.parse(action.createdAt) < to,
    );
    const reviews = [...this.#reviews.values()]
      .flat()
      .filter(
        (review) => Date.parse(review.createdAt) >= from && Date.parse(review.createdAt) < to,
      );
    const categories = new Map<string, number>();
    for (const report of reports) {
      if (report.envelope.payload.type === 'report') {
        const category = report.envelope.payload.content.category;
        categories.set(category, (categories.get(category) ?? 0) + 1);
      }
    }
    const triageDurations = [...this.#cases.values()]
      .map((snapshot) => {
        const first = this.#events
          .get(snapshot.reportId)
          ?.find((event) => ['awaiting-triage', 'under-review'].includes(event.state));
        return first === undefined
          ? undefined
          : Date.parse(first.createdAt) - Date.parse(snapshot.createdAt);
      })
      .filter((value): value is number => value !== undefined && value >= 0);
    const appealDurations = reviews
      .map((review) => {
        if (review.appealId === undefined) return undefined;
        const appeal = this.#objects.get(review.appealId);
        return appeal === undefined
          ? undefined
          : Date.parse(review.createdAt) - Date.parse(appeal.receivedAt);
      })
      .filter((value): value is number => value !== undefined && value >= 0);
    return buildTransparencyReport({
      input,
      reports: reports.length,
      appeals: appeals.length,
      actions,
      reviews,
      categories,
      triageDurations,
      appealDurations,
      overdueEmergencyReviews: [...this.#actionStatuses.values()].filter((events) =>
        events.some(
          (event) =>
            event.status === 'review-required' &&
            Date.parse(event.createdAt) >= from &&
            Date.parse(event.createdAt) < to,
        ),
      ).length,
    });
  }

  readiness(): Promise<void> {
    return Promise.resolve();
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  #recordAppealEvent(decisionId: string, object: StoredSafetyObject): void {
    const current = this.#cases.get(decisionId);
    if (current === undefined) return;
    this.#advanceCase({
      reportId: decisionId,
      state: 'appealed',
      now: object.receivedAt,
      eventType: 'appeal-received',
      actorId: object.envelope.payload.author,
      assertionId: `signed-appeal:${object.objectId}`,
      permission: 'reporter',
      reasonCode: 'appeal.received',
      note: `appeal:${object.objectId}`,
    });
  }

  #requireCaseVersion(reportId: string, expectedVersion: number): CaseSnapshot {
    const current = this.#cases.get(reportId);
    if (current === undefined) {
      throw new ModerationServiceError('The moderation case was not found.', 'case-not-found');
    }
    if (current.version !== expectedVersion) {
      throw new ModerationServiceError(
        'The moderation case changed after it was read.',
        'case-conflict',
      );
    }
    return current;
  }

  #advanceCase(input: {
    readonly reportId: string;
    readonly state: CaseState;
    readonly now: string;
    readonly eventType: string;
    readonly actorId: string;
    readonly assertionId: string;
    readonly permission: CaseEvent['permission'];
    readonly reasonCode: string;
    readonly note?: string;
    readonly legalHold?: boolean;
  }): CaseSnapshot {
    const current = this.#cases.get(input.reportId);
    if (current === undefined) {
      throw new ModerationServiceError('The moderation case was not found.', 'case-not-found');
    }
    const version = current.version + 1;
    const { closedAt: currentClosedAt, ...currentWithoutClosedAt } = current;
    const closedAt =
      input.state === 'closed'
        ? (currentClosedAt ?? input.now)
        : input.state === current.state
          ? currentClosedAt
          : undefined;
    const next: CaseSnapshot = {
      ...currentWithoutClosedAt,
      state: input.state,
      version,
      updatedAt: input.now,
      ...(closedAt === undefined ? {} : { closedAt }),
      ...(input.legalHold === undefined ? {} : { legalHold: input.legalHold }),
    };
    this.#cases.set(input.reportId, next);
    const events = this.#events.get(input.reportId) ?? [];
    events.push({
      eventId: randomUUID(),
      reportId: input.reportId,
      caseVersion: version,
      eventType: input.eventType,
      state: input.state,
      createdAt: input.now,
      actorId: input.actorId,
      assertionId: input.assertionId,
      permission: input.permission,
      reasonCode: input.reasonCode,
      ...(input.note === undefined ? {} : { note: input.note }),
    });
    this.#events.set(input.reportId, events);
    return cloneSnapshot(next);
  }

  #advanceSystemCase(reportId: string, now: string, eventType: string, note: string): void {
    const current = this.#cases.get(reportId);
    if (current === undefined) return;
    this.#advanceCase({
      reportId,
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

  #appendActionStatus(
    actionId: string,
    status: ModerationAction['currentStatus'],
    createdAt: string,
  ): void {
    const events = this.#actionStatuses.get(actionId) ?? [];
    if (events.some((event) => event.status === status)) return;
    events.push({ status, createdAt });
    this.#actionStatuses.set(actionId, events);
  }

  #currentStatus(actionId: string): ModerationAction['currentStatus'] {
    return this.#actionStatuses.get(actionId)?.at(-1)?.status ?? 'active';
  }

  #withCurrentStatus(action: ModerationAction): ModerationAction {
    return structuredClone({ ...action, currentStatus: this.#currentStatus(action.actionId) });
  }

  #removeCase(reportId: string): void {
    const appealIds = this.#appealsByDecision.get(reportId) ?? new Set<string>();
    for (const appealId of appealIds) this.#objects.delete(appealId);
    this.#appealsByDecision.delete(reportId);
    this.#objects.delete(reportId);
    this.#cases.delete(reportId);
    this.#events.delete(reportId);
    this.#reviews.delete(reportId);
    this.#access.delete(reportId);
    for (const [actionId, action] of this.#actions) {
      if (action.reportId === reportId) {
        this.#actions.delete(actionId);
        this.#actionStatuses.delete(actionId);
      }
    }
  }
}

export function subjectKey(subject: ModerationSubject): string {
  switch (subject.kind) {
    case 'identity':
      return `identity:${subject.identity}`;
    case 'object':
      return `object:${subject.object.id}`;
    case 'community':
      return `community:${subject.community.id}`;
  }
}

export function cloneStored(object: StoredSafetyObject): StoredSafetyObject {
  return {
    ...object,
    canonicalBytes: object.canonicalBytes.slice(),
    envelope: structuredClone(object.envelope),
  };
}

export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((byte, index) => byte === right[index]);
}

export function hasCanonicalEnvelopeBytes(object: StoredSafetyObject): boolean {
  return bytesEqual(object.canonicalBytes, canonicalizeEnvelope(object.envelope));
}

export function assertActionTimes(
  acceptedAt: string,
  effectiveAt: string,
  expiresAt: string | undefined,
  reviewDueAt: string | undefined,
  appealDeadline: string | undefined,
): void {
  const accepted = Date.parse(acceptedAt);
  const effective = Date.parse(effectiveAt);
  if (expiresAt !== undefined && Date.parse(expiresAt) <= effective) {
    throw new ModerationServiceError(
      'A moderation action must expire after it becomes effective.',
      'invalid-object',
    );
  }
  if (expiresAt !== undefined && Date.parse(expiresAt) <= accepted) {
    throw new ModerationServiceError(
      'A moderation action cannot be accepted after its expiry.',
      'invalid-object',
    );
  }
  if (
    reviewDueAt !== undefined &&
    (expiresAt === undefined ||
      Date.parse(reviewDueAt) <= effective ||
      Date.parse(reviewDueAt) >= Date.parse(expiresAt))
  ) {
    throw new ModerationServiceError(
      'Emergency review must be due after effect and before expiry.',
      'invalid-object',
    );
  }
  if (reviewDueAt !== undefined && Date.parse(reviewDueAt) <= accepted) {
    throw new ModerationServiceError(
      'Emergency review must still be pending when an action is accepted.',
      'invalid-object',
    );
  }
  if (
    appealDeadline !== undefined &&
    (Date.parse(appealDeadline) <= effective || Date.parse(appealDeadline) <= accepted)
  ) {
    throw new ModerationServiceError(
      'An appeal deadline must remain open after action acceptance and effect.',
      'invalid-object',
    );
  }
}

export function assertConflictOverride(
  originalActorId: string,
  assertion: OperatorAssertion,
  overrideReason: string | undefined,
): void {
  if (originalActorId !== assertion.actorId) return;
  if (
    !assertion.permissions.includes('conflict.override') ||
    overrideReason === undefined ||
    overrideReason.trim().length < 12
  ) {
    throw new ModerationServiceError(
      'A moderator cannot review their own action without separately scoped, reasoned override.',
      'conflict-of-interest',
    );
  }
}

export function buildTransparencyReport(input: {
  readonly input: StoreTransparencyInput;
  readonly reports: number;
  readonly appeals: number;
  readonly actions: readonly ModerationAction[];
  readonly reviews: readonly ActionReview[];
  readonly categories: ReadonlyMap<string, number>;
  readonly triageDurations: readonly number[];
  readonly appealDurations: readonly number[];
  readonly overdueEmergencyReviews: number;
}): TransparencyReport {
  const cells: { category: string; count: number }[] = [];
  let suppressed = 0;
  for (const [category, count] of [...input.categories].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (count < input.input.minimumCellSize) {
      suppressed += count;
    } else {
      cells.push({ category, count });
    }
  }
  if (suppressed > 0) cells.push({ category: 'other-or-suppressed', count: suppressed });
  return {
    privacySafe: true,
    rawCasesIncluded: false,
    from: input.input.from,
    to: input.input.to,
    minimumCellSize: input.input.minimumCellSize,
    totals: {
      reports: input.reports,
      appeals: input.appeals,
      actions: input.actions.length,
      reversals: input.reviews.filter((review) => review.outcome === 'reversed').length,
      emergencyActions: input.actions.filter((action) => action.kind === 'emergency-safety').length,
      overdueEmergencyReviews: input.overdueEmergencyReviews,
    },
    reportsByCategory: cells,
    medianTriageMilliseconds:
      input.triageDurations.length < input.input.minimumCellSize
        ? null
        : median(input.triageDurations),
    medianAppealResolutionMilliseconds:
      input.appealDurations.length < input.input.minimumCellSize
        ? null
        : median(input.appealDurations),
  };
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const midpoint = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[midpoint] ?? null;
  const left = sorted[midpoint - 1];
  const right = sorted[midpoint];
  return left === undefined || right === undefined ? null : Math.floor((left + right) / 2);
}

function cloneSnapshot(snapshot: CaseSnapshot): CaseSnapshot {
  return structuredClone(snapshot);
}
