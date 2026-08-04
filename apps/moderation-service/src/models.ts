import {
  digestSchema,
  moderationSubjectSchema,
  objectIdSchema,
  timestampSchema,
  type ModerationSubject,
} from '@wetdrool/protocol';
import { z } from 'zod';

export const CASE_STATES = [
  'received',
  'awaiting-triage',
  'under-review',
  'information-requested',
  'action-taken',
  'no-action',
  'referred',
  'appealed',
  'closed',
] as const;
export const caseStateSchema = z.enum(CASE_STATES);
export type CaseState = z.infer<typeof caseStateSchema>;

export const OPERATOR_PERMISSIONS = [
  'case.read',
  'case.triage',
  'case.review',
  'case.act',
  'case.emergency',
  'appeal.review',
  'emergency.review',
  'conflict.override',
  'case.audit',
  'case.legal-hold',
] as const;
export const operatorPermissionSchema = z.enum(OPERATOR_PERMISSIONS);
export type OperatorPermission = z.infer<typeof operatorPermissionSchema>;

export const operatorAssertionSchema = z
  .object({
    actorId: z
      .string()
      .trim()
      .min(3)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:@/-]+$/u),
    assertionId: z
      .string()
      .trim()
      .min(8)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/u),
    permissions: z
      .array(operatorPermissionSchema)
      .min(1)
      .max(OPERATOR_PERMISSIONS.length)
      .refine((values) => new Set(values).size === values.length, 'Permissions must be unique.'),
    expiresAt: timestampSchema,
  })
  .strict();
export type OperatorAssertion = z.infer<typeof operatorAssertionSchema>;

export const caseTransitionInputSchema = z
  .object({
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    toState: caseStateSchema,
    reasonCode: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u),
    note: z.string().trim().min(1).max(2_000).optional(),
  })
  .strict();
export type CaseTransitionInput = z.infer<typeof caseTransitionInputSchema>;

export const ACTION_KINDS = [
  'guidance',
  'context-label',
  'downrank',
  'posting-cooldown',
  'temporary-restriction',
  'community-removal',
  'membership-suspension',
  'membership-removal',
  'emergency-safety',
] as const;
export const actionKindSchema = z.enum(ACTION_KINDS);
export type ModerationActionKind = z.infer<typeof actionKindSchema>;

const timeBoundActionKinds = new Set<ModerationActionKind>([
  'posting-cooldown',
  'temporary-restriction',
  'membership-suspension',
  'emergency-safety',
]);

export const actionInputSchema = z
  .object({
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    kind: actionKindSchema,
    target: moderationSubjectSchema,
    targetHash: digestSchema.optional(),
    scope: z.enum(['community', 'operator']),
    policyId: objectIdSchema,
    policyVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    ruleId: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
    reasonCategory: z.enum([
      'spam',
      'harassment',
      'doxxing-risk',
      'nonconsensual-intimate-media',
      'child-safety',
      'threat',
      'impersonation',
      'illegal-content',
      'self-harm-concern',
      'community-rule',
      'technical-abuse',
      'other',
    ]),
    moderatorNote: z.string().trim().min(1).max(4_000).optional(),
    consequences: z
      .array(
        z.enum([
          'warn',
          'blur',
          'downrank',
          'hide',
          'restrict-replies',
          'restrict-posting',
          'remove-community-content',
          'suspend-membership',
          'remove-membership',
        ]),
      )
      .min(1)
      .max(8)
      .refine((values) => new Set(values).size === values.length, 'Consequences must be unique.'),
    effectiveAt: timestampSchema.optional(),
    expiresAt: timestampSchema.optional(),
    reviewDueAt: timestampSchema.optional(),
    appealEligible: z.boolean(),
    appealDeadline: timestampSchema.optional(),
    supersedesActionId: z.uuid().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (timeBoundActionKinds.has(input.kind) && input.expiresAt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['expiresAt'],
        message: 'This action kind requires an expiry.',
      });
    }
    if (input.kind === 'emergency-safety' && input.reviewDueAt === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reviewDueAt'],
        message: 'Emergency safety actions require an independent-review deadline.',
      });
    }
    if (input.kind !== 'emergency-safety' && input.reviewDueAt !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['reviewDueAt'],
        message: 'Only emergency safety actions may declare a review deadline.',
      });
    }
    if (input.appealEligible !== (input.appealDeadline !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['appealDeadline'],
        message: 'Appealable actions require a deadline and ineligible actions cannot declare one.',
      });
    }
  });
export type ActionInput = z.infer<typeof actionInputSchema>;

export const actionReviewInputSchema = z
  .object({
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    actionId: z.uuid(),
    appealId: objectIdSchema.optional(),
    outcome: z.enum(['upheld', 'modified', 'reversed']),
    rationale: z.string().trim().min(1).max(4_000),
    restoration: z.string().trim().min(1).max(2_000).optional(),
    conflictOverrideReason: z.string().trim().min(12).max(2_000).optional(),
  })
  .strict();
export type ActionReviewInput = z.infer<typeof actionReviewInputSchema>;

export const legalHoldInputSchema = z
  .object({
    expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    active: z.boolean(),
    reason: z.string().trim().min(12).max(2_000),
  })
  .strict();
export type LegalHoldInput = z.infer<typeof legalHoldInputSchema>;

export interface CaseSnapshot {
  readonly reportId: string;
  readonly state: CaseState;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly closedAt?: string;
  readonly legalHold: boolean;
}

export interface CaseEvent {
  readonly eventId: string;
  readonly reportId: string;
  readonly caseVersion: number;
  readonly eventType: string;
  readonly state: CaseState;
  readonly createdAt: string;
  readonly actorId: string;
  readonly assertionId: string;
  readonly permission: OperatorPermission | 'system' | 'reporter';
  readonly reasonCode: string;
  readonly note?: string;
}

export interface ModerationAction {
  readonly actionId: string;
  readonly reportId: string;
  readonly kind: ModerationActionKind;
  readonly actorId: string;
  readonly assertionId: string;
  readonly permission: OperatorPermission;
  readonly target: ModerationSubject;
  readonly targetHash?: string;
  readonly scope: 'community' | 'operator';
  readonly policyId: string;
  readonly policyVersion: number;
  readonly ruleId: string;
  readonly reasonCategory: z.infer<typeof actionInputSchema>['reasonCategory'];
  readonly moderatorNote?: string;
  readonly consequences: readonly string[];
  readonly createdAt: string;
  readonly effectiveAt: string;
  readonly expiresAt?: string;
  readonly reviewDueAt?: string;
  readonly appealEligible: boolean;
  readonly appealDeadline?: string;
  readonly supersedesActionId?: string;
  readonly currentStatus: 'active' | 'review-required' | 'reviewed' | 'reversed' | 'expired';
}

export interface ActionReview {
  readonly reviewId: string;
  readonly reportId: string;
  readonly actionId: string;
  readonly appealId?: string;
  readonly outcome: 'upheld' | 'modified' | 'reversed';
  readonly actorId: string;
  readonly assertionId: string;
  readonly permission: 'appeal.review' | 'emergency.review';
  readonly rationale: string;
  readonly restoration?: string;
  readonly conflictOverrideReason?: string;
  readonly createdAt: string;
}

export interface AccessEvent {
  readonly accessId: string;
  readonly reportId?: string;
  readonly operation: string;
  readonly allowed: boolean;
  readonly actorId: string;
  readonly assertionId: string;
  readonly purpose: string;
  readonly createdAt: string;
}

export interface CaseLedger {
  readonly snapshot: CaseSnapshot;
  readonly events: readonly CaseEvent[];
  readonly actions: readonly ModerationAction[];
  readonly reviews: readonly ActionReview[];
  readonly access: readonly AccessEvent[];
}

export interface MaintenanceResult {
  readonly reviewRequired: number;
  readonly actionsExpired: number;
  readonly casesRemoved: number;
}

export interface TransparencyReport {
  readonly privacySafe: true;
  readonly rawCasesIncluded: false;
  readonly from: string;
  readonly to: string;
  readonly minimumCellSize: number;
  readonly totals: {
    readonly reports: number;
    readonly appeals: number;
    readonly actions: number;
    readonly reversals: number;
    readonly emergencyActions: number;
    readonly overdueEmergencyReviews: number;
  };
  readonly reportsByCategory: readonly {
    readonly category: string;
    readonly count: number;
  }[];
  readonly medianTriageMilliseconds: number | null;
  readonly medianAppealResolutionMilliseconds: number | null;
}

const allowedTransitions: Readonly<Record<CaseState, ReadonlySet<CaseState>>> = {
  received: new Set(['awaiting-triage', 'under-review', 'appealed']),
  'awaiting-triage': new Set(['under-review', 'referred', 'closed', 'appealed']),
  'under-review': new Set([
    'information-requested',
    'action-taken',
    'no-action',
    'referred',
    'closed',
    'appealed',
  ]),
  'information-requested': new Set(['under-review', 'closed', 'appealed']),
  'action-taken': new Set(['appealed', 'closed', 'under-review']),
  'no-action': new Set(['appealed', 'closed', 'under-review']),
  referred: new Set(['closed', 'under-review', 'appealed']),
  appealed: new Set(['under-review', 'closed']),
  closed: new Set(),
};

export function canTransitionCase(from: CaseState, to: CaseState): boolean {
  return allowedTransitions[from].has(to);
}

export function permissionForTransition(to: CaseState): OperatorPermission {
  return ['awaiting-triage', 'under-review', 'information-requested', 'referred'].includes(to)
    ? 'case.triage'
    : 'case.review';
}

export function permissionForAction(kind: ModerationActionKind): 'case.act' | 'case.emergency' {
  return kind === 'emergency-safety' ? 'case.emergency' : 'case.act';
}
