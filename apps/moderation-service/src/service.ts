import {
  type AuthorizationVerifier,
  moderationSubjectSchema,
  type ModerationSubject,
  type SignedEnvelope,
  verifyEnvelope,
} from '@wetdrool/protocol';
import { z } from 'zod';

import { ModerationServiceError } from './errors.js';
import {
  actionInputSchema,
  actionReviewInputSchema,
  caseTransitionInputSchema,
  legalHoldInputSchema,
  operatorAssertionSchema,
  permissionForAction,
  permissionForTransition,
  type AccessEvent,
  type ActionReview,
  type CaseLedger,
  type CaseSnapshot,
  type MaintenanceResult,
  type ModerationAction,
  type OperatorAssertion,
  type OperatorPermission,
  type TransparencyReport,
} from './models.js';
import {
  MemoryModerationStore,
  type ModerationCase,
  type ModerationEnvelope,
  type ModerationStore,
  type PutResult,
  type ReportEnvelope,
  type SafetyEnvelope,
  type StoredSafetyObject,
} from './store.js';

export type ModerationAuthorizationMode = 'locked' | 'unverified-local' | 'verified';

export interface ModerationServiceOptions {
  readonly store?: ModerationStore;
  readonly authorizeObject?: AuthorizationVerifier;
  readonly dangerouslyAllowUnverifiedLocalMode?: boolean;
  readonly now?: () => Date;
}

export interface IngestReceipt {
  readonly advisory: true;
  readonly canonical: false;
  readonly duplicate: boolean;
  readonly objectId: string;
  readonly cid: string;
  readonly objectType: 'appeal' | 'moderation-label' | 'report';
  readonly receivedAt: string;
}

export class ModerationService {
  readonly store: ModerationStore;
  readonly authorizationMode: ModerationAuthorizationMode;
  readonly #authorizeObject: AuthorizationVerifier | undefined;
  readonly #now: () => Date;

  constructor(options: ModerationServiceOptions = {}) {
    if (
      options.authorizeObject !== undefined &&
      options.dangerouslyAllowUnverifiedLocalMode === true
    ) {
      throw new TypeError(
        'Choose verified object authorization or dangerous local-unverified mode, never both.',
      );
    }
    this.store = options.store ?? new MemoryModerationStore();
    this.#authorizeObject = options.authorizeObject;
    this.authorizationMode =
      options.authorizeObject !== undefined
        ? 'verified'
        : options.dangerouslyAllowUnverifiedLocalMode === true
          ? 'unverified-local'
          : 'locked';
    this.#now = options.now ?? (() => new Date());
  }

  get ready(): boolean {
    return this.authorizationMode !== 'locked';
  }

  ingestLabel(input: unknown): Promise<IngestReceipt> {
    return this.#ingest(input, 'moderation-label');
  }

  ingestReport(input: unknown): Promise<IngestReceipt> {
    return this.#ingest(input, 'report');
  }

  ingestAppeal(input: unknown): Promise<IngestReceipt> {
    return this.#ingest(input, 'appeal');
  }

  async activeLabels(input: unknown): Promise<readonly StoredSafetyObject[]> {
    const subject = moderationSubjectSchema.parse(input);
    return this.store.activeLabels(subject, this.#now());
  }

  async readCase(reportId: string): Promise<ModerationCase | undefined> {
    return this.store.getCase(reportId);
  }

  async readCaseSnapshot(reportId: string): Promise<CaseSnapshot | undefined> {
    return this.store.getCaseSnapshot(reportId);
  }

  async readCaseLedger(reportId: string): Promise<CaseLedger | undefined> {
    return this.store.getCaseLedger(reportId);
  }

  async transitionCase(
    reportId: string,
    input: unknown,
    assertionInput: unknown,
  ): Promise<CaseSnapshot> {
    const transition = caseTransitionInputSchema.parse(input);
    const assertion = this.#requireAssertion(assertionInput);
    const permission = permissionForTransition(transition.toState);
    requirePermission(assertion, permission);
    return this.store.transitionCase({
      reportId,
      transition,
      assertion,
      permission,
      now: this.#now().toISOString(),
    });
  }

  async applyAction(
    reportId: string,
    input: unknown,
    assertionInput: unknown,
  ): Promise<ModerationAction> {
    const action = actionInputSchema.parse(input);
    const assertion = this.#requireAssertion(assertionInput);
    const permission = permissionForAction(action.kind);
    requirePermission(assertion, permission);
    return this.store.applyAction({
      reportId,
      action,
      assertion,
      permission,
      now: this.#now().toISOString(),
    });
  }

  async reviewAction(
    reportId: string,
    input: unknown,
    assertionInput: unknown,
  ): Promise<ActionReview> {
    const review = actionReviewInputSchema.parse(input);
    const assertion = this.#requireAssertion(assertionInput);
    const permission = review.appealId === undefined ? 'emergency.review' : 'appeal.review';
    requirePermission(assertion, permission);
    if (
      review.conflictOverrideReason !== undefined &&
      !assertion.permissions.includes('conflict.override')
    ) {
      throw new ModerationServiceError(
        'Conflict override requires a separately scoped operator permission.',
        'unauthorized',
      );
    }
    return this.store.reviewAction({
      reportId,
      review,
      assertion,
      permission,
      now: this.#now().toISOString(),
    });
  }

  async setLegalHold(
    reportId: string,
    input: unknown,
    assertionInput: unknown,
  ): Promise<CaseSnapshot> {
    const hold = legalHoldInputSchema.parse(input);
    const assertion = this.#requireAssertion(assertionInput);
    requirePermission(assertion, 'case.legal-hold');
    return this.store.setLegalHold({
      reportId,
      hold,
      assertion,
      now: this.#now().toISOString(),
    });
  }

  recordAccess(input: {
    readonly reportId?: string;
    readonly operation: string;
    readonly allowed: boolean;
    readonly actorId: string;
    readonly assertionId: string;
    readonly purpose: string;
  }): Promise<AccessEvent> {
    return this.store.recordAccess({ ...input, now: this.#now().toISOString() });
  }

  runMaintenance(input: {
    readonly dueActionLimit: number;
    readonly retentionLimit: number;
    readonly closedCaseRetentionMs: number;
  }): Promise<MaintenanceResult> {
    return this.store.runMaintenance({
      now: this.#now().toISOString(),
      dueActionLimit: boundedInteger(input.dueActionLimit, 1, 5_000, 'due action limit'),
      retentionLimit: boundedInteger(input.retentionLimit, 1, 5_000, 'retention limit'),
      closedCaseRetentionMs: boundedInteger(
        input.closedCaseRetentionMs,
        1,
        10 * 365 * 86_400_000,
        'closed-case retention',
      ),
    });
  }

  transparency(input: {
    readonly from: string;
    readonly to: string;
    readonly minimumCellSize: number;
  }): Promise<TransparencyReport> {
    const from = new Date(input.from);
    const to = new Date(input.to);
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from.toISOString() !== input.from ||
      to.toISOString() !== input.to ||
      from >= to ||
      to.getTime() - from.getTime() > 366 * 86_400_000
    ) {
      throw new ModerationServiceError(
        'Transparency windows must use exact UTC milliseconds and span at most 366 days.',
        'invalid-object',
      );
    }
    return this.store.transparency({
      from: input.from,
      to: input.to,
      minimumCellSize: boundedInteger(
        input.minimumCellSize,
        3,
        100,
        'transparency minimum cell size',
      ),
    });
  }

  async #ingest(input: unknown, expectedType: IngestReceipt['objectType']): Promise<IngestReceipt> {
    if (!this.ready) {
      throw new ModerationServiceError(
        'The moderation service requires a current identity/delegation authorizer.',
        'locked',
      );
    }

    let verified;
    try {
      verified = await verifyEnvelope(
        input as SignedEnvelope,
        this.#authorizeObject === undefined ? undefined : this.#authorizeObject,
      );
    } catch (error) {
      throw new ModerationServiceError(
        'The signed moderation object failed verification or authorization.',
        error instanceof z.ZodError ? 'invalid-object' : 'unauthorized',
        { cause: error },
      );
    }
    if (verified.envelope.payload.type !== expectedType) {
      throw new ModerationServiceError(
        `Expected a signed ${expectedType} object.`,
        'invalid-object',
      );
    }

    const receivedAt = this.#now().toISOString();
    const object: StoredSafetyObject = {
      objectId: verified.objectId,
      cid: verified.cid,
      canonicalBytes: verified.canonicalBytes,
      envelope: verified.envelope as SafetyEnvelope,
      receivedAt,
    };
    const result: PutResult = await this.store.put(object);
    return {
      advisory: true,
      canonical: false,
      duplicate: result.duplicate,
      objectId: result.stored.objectId,
      cid: result.stored.cid,
      objectType: expectedType,
      receivedAt: result.stored.receivedAt,
    };
  }

  #requireAssertion(input: unknown): OperatorAssertion {
    const assertion = operatorAssertionSchema.parse(input);
    if (Date.parse(assertion.expiresAt) <= this.#now().getTime()) {
      throw new ModerationServiceError(
        'The operator authorization assertion has expired.',
        'unauthorized',
      );
    }
    return assertion;
  }
}

export function publicLabelEnvelope(object: StoredSafetyObject): ModerationEnvelope | undefined {
  return object.envelope.payload.type === 'moderation-label'
    ? (object.envelope as ModerationEnvelope)
    : undefined;
}

export function reportEnvelope(object: StoredSafetyObject): ReportEnvelope | undefined {
  return object.envelope.payload.type === 'report'
    ? (object.envelope as ReportEnvelope)
    : undefined;
}

export function parseModerationSubject(input: unknown): ModerationSubject {
  return moderationSubjectSchema.parse(input);
}

function requirePermission(assertion: OperatorAssertion, permission: OperatorPermission): void {
  if (!assertion.permissions.includes(permission)) {
    throw new ModerationServiceError(
      `Operator authorization does not include ${permission}.`,
      'unauthorized',
    );
  }
}

function boundedInteger(value: number, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`The moderation ${label} is outside its safe bounds.`);
  }
  return value;
}
