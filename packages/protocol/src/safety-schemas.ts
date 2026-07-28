import { z } from 'zod';

import { MAX_EVIDENCE_ITEMS } from './constants.js';
import {
  commonPayloadFields,
  contentReferenceSchema,
  identityIdSchema,
  limitedString,
  nonEmptyLimitedString,
  objectReferenceSchema,
  timestampSchema,
  typedObjectReferenceSchema,
} from './schema-primitives.js';

export const moderationSubjectSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('identity'),
      identity: identityIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('object'),
      object: objectReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('community'),
      community: typedObjectReferenceSchema(['community']),
    })
    .strict(),
]);

export const moderationLabelContentSchema = z
  .object({
    subject: moderationSubjectSchema,
    code: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u),
    severity: z.enum(['info', 'notice', 'warning', 'severe']),
    recommendation: z.enum(['none', 'blur', 'downrank', 'hide', 'review']),
    rationale: limitedString(1_000).optional(),
    policy: objectReferenceSchema,
    source: z.enum(['human', 'automated', 'hybrid']),
    confidenceBasisPoints: z.number().int().min(0).max(10_000).optional(),
    expiresAt: timestampSchema.optional(),
    supersedes: typedObjectReferenceSchema(['moderation-label']).optional(),
  })
  .strict()
  .refine(
    (content) => content.source === 'human' || content.confidenceBasisPoints !== undefined,
    'Automated and hybrid labels require a confidence statement.',
  );

const protectedEvidenceSchema = contentReferenceSchema.refine(
  (reference) => reference.protection?.kind === 'encrypted',
  'Moderation evidence must reference encrypted content.',
);

export const reportContentSchema = z
  .object({
    subject: moderationSubjectSchema,
    category: z.enum([
      'spam',
      'harassment',
      'doxxing-risk',
      'nonconsensual-intimate-media',
      'child-safety',
      'threat',
      'impersonation',
      'illegal-content',
      'self-harm-concern',
      'other',
    ]),
    summary: nonEmptyLimitedString(1_000),
    evidence: z.array(protectedEvidenceSchema).max(MAX_EVIDENCE_ITEMS).default([]),
    preserveEvidence: z.boolean(),
    requestedOutcome: z.enum(['review', 'label', 'remove', 'restrict', 'contact-me']),
    jurisdiction: limitedString(80).optional(),
    confidentiality: z.literal('restricted'),
  })
  .strict()
  .refine(
    (content) => content.category !== 'nonconsensual-intimate-media' || content.evidence.length > 0,
    'Nonconsensual-intimate-media reports require preserved encrypted evidence.',
  );

export const appealContentSchema = z
  .object({
    decision: z.union([
      typedObjectReferenceSchema(['moderation-label']),
      typedObjectReferenceSchema(['report']),
    ]),
    statement: nonEmptyLimitedString(2_000),
    evidence: z.array(protectedEvidenceSchema).max(MAX_EVIDENCE_ITEMS).default([]),
    requestedOutcome: z.enum(['remove-label', 'restore-content', 'restore-account', 'reconsider']),
    confidentiality: z.literal('restricted'),
  })
  .strict();

export const moderationLabelPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('moderation-label'),
    content: moderationLabelContentSchema,
  })
  .strict();

export const reportPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('report'),
    content: reportContentSchema,
  })
  .strict();

export const appealPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('appeal'),
    content: appealContentSchema,
  })
  .strict();

export type ModerationSubject = z.infer<typeof moderationSubjectSchema>;
export type ModerationLabelContent = z.infer<typeof moderationLabelContentSchema>;
export type ReportContent = z.infer<typeof reportContentSchema>;
export type AppealContent = z.infer<typeof appealContentSchema>;
export type ModerationLabelPayload = z.infer<typeof moderationLabelPayloadSchema>;
export type ReportPayload = z.infer<typeof reportPayloadSchema>;
export type AppealPayload = z.infer<typeof appealPayloadSchema>;
