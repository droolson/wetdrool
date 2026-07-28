import { z } from 'zod';

import { MAX_NOTIFICATION_CATEGORIES } from './constants.js';
import {
  authorLabelSchema,
  authorizationScopeSchema,
  commonPayloadFields,
  communityRoleNameSchema,
  handleSchema,
  identityIdSchema,
  limitedString,
  nonEmptyLimitedString,
  objectReferenceSchema,
  replacementSchema,
  signingKeyIdSchema,
  timeWindowSchema,
  timestampSchema,
  typedObjectReferenceSchema,
  visibilitySchema,
} from './schema-primitives.js';

const namespacedHandleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('global') }).strict(),
  z
    .object({
      kind: z.literal('community'),
      community: typedObjectReferenceSchema(['community']),
    })
    .strict(),
]);

export const handleClaimContentSchema = z
  .object({
    namespace: namespacedHandleSchema,
    handle: handleSchema,
    state: z.enum(['claimed', 'released']),
    replacement: replacementSchema,
  })
  .strict()
  .refine(
    (content) => content.state !== 'released' || content.replacement.sequence > 1,
    'A handle cannot be released before it has been claimed.',
  );

export const delegationContentSchema = z
  .object({
    delegateKey: signingKeyIdSchema,
    scopes: z
      .array(authorizationScopeSchema)
      .min(1)
      .max(32)
      .refine(
        (scopes) => new Set(scopes).size === scopes.length,
        'Delegation scopes must be unique.',
      ),
    validity: timeWindowSchema,
    rootRotation: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    deviceLabel: limitedString(160).optional(),
    revocationReference: objectReferenceSchema.optional(),
  })
  .strict()
  .refine(
    (content) => content.delegateKey.includes('#delegation/'),
    'Delegations must identify a delegation key.',
  );

const identityEdgeFields = {
  target: identityIdSchema,
  state: z.enum(['active', 'inactive']),
  replacement: replacementSchema,
};

export const followEdgeContentSchema = z.object(identityEdgeFields).strict();

export const blockEdgeContentSchema = z
  .object({
    ...identityEdgeFields,
    scope: z.enum(['content', 'interaction', 'all']).default('all'),
  })
  .strict();

const muteTargetSchema = z.discriminatedUnion('kind', [
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
      kind: z.literal('keyword'),
      keyword: nonEmptyLimitedString(160),
      language: limitedString(32).optional(),
    })
    .strict(),
]);

export const mutePreferenceContentSchema = z
  .object({
    target: muteTargetSchema,
    state: z.enum(['active', 'inactive']),
    replacement: replacementSchema,
    expiresAt: timestampSchema.optional(),
    confidentiality: z.literal('private'),
  })
  .strict();

export const repostContentSchema = z
  .object({
    target: typedObjectReferenceSchema(['post', 'post-revision', 'reply', 'quote']),
    visibility: visibilitySchema,
    authorLabels: z.array(authorLabelSchema).max(16).default([]),
  })
  .strict();

const reactionValueSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('named'),
      value: z.enum(['like', 'celebrate', 'support', 'insightful']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('emoji'),
      value: nonEmptyLimitedString(32),
    })
    .strict(),
]);

export const reactionContentSchema = z
  .object({
    target: objectReferenceSchema,
    reaction: reactionValueSchema,
    state: z.enum(['active', 'inactive']),
    replacement: replacementSchema,
  })
  .strict();

export const bookmarkContentSchema = z
  .object({
    target: objectReferenceSchema,
    state: z.enum(['active', 'inactive']),
    collection: limitedString(160).optional(),
    replacement: replacementSchema,
    confidentiality: z.literal('private'),
    storage: z.enum(['private-client', 'restricted-storage']),
  })
  .strict();

const notificationRuleSchema = z
  .object({
    category: z.enum([
      'follows',
      'mentions',
      'replies',
      'quotes',
      'reposts',
      'reactions',
      'messages',
      'communities',
      'moderation',
      'governance',
      'payments',
      'events',
    ]),
    enabled: z.boolean(),
    channels: z
      .array(z.enum(['in-app', 'push', 'email']))
      .max(3)
      .refine((channels) => new Set(channels).size === channels.length, 'Channels must be unique.'),
  })
  .strict();

export const notificationPreferenceContentSchema = z
  .object({
    replacement: replacementSchema,
    rules: z
      .array(notificationRuleSchema)
      .max(MAX_NOTIFICATION_CATEGORIES)
      .refine(
        (rules) => new Set(rules.map((rule) => rule.category)).size === rules.length,
        'Notification categories must be unique.',
      ),
    quietHours: z
      .object({
        startsAtLocal: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
        endsAtLocal: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u),
        timeZone: z.string().regex(/^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+-]+)+$/u),
      })
      .strict()
      .optional(),
    sensitivePreview: z.enum(['show', 'hide']).default('hide'),
    confidentiality: z.literal('private'),
  })
  .strict();

export const handleClaimPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('handle-claim'),
    content: handleClaimContentSchema,
  })
  .strict();

export const delegationPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('delegation'),
    content: delegationContentSchema,
  })
  .strict()
  .refine(
    (payload) => payload.content.delegateKey.startsWith(`${payload.author}#delegation/`),
    'The delegated key must belong to the payload author.',
  )
  .refine(
    (payload) => payload.content.delegateKey !== payload.signingKey,
    'A delegation cannot delegate to the key signing the delegation.',
  );

export const followEdgePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('follow-edge'),
    content: followEdgeContentSchema,
  })
  .strict()
  .refine(
    (payload) => payload.content.target !== payload.author,
    'An identity cannot follow itself.',
  );

export const blockEdgePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('block-edge'),
    content: blockEdgeContentSchema,
  })
  .strict()
  .refine(
    (payload) => payload.content.target !== payload.author,
    'An identity cannot block itself.',
  );

export const mutePreferencePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('mute-preference'),
    content: mutePreferenceContentSchema,
  })
  .strict()
  .refine(
    (payload) =>
      payload.content.target.kind !== 'identity' ||
      payload.content.target.identity !== payload.author,
    'An identity cannot mute itself.',
  );

export const repostPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('repost'),
    content: repostContentSchema,
  })
  .strict();

export const reactionPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('reaction'),
    content: reactionContentSchema,
  })
  .strict();

export const bookmarkPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('bookmark'),
    content: bookmarkContentSchema,
  })
  .strict();

export const notificationPreferencePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('notification-preference'),
    content: notificationPreferenceContentSchema,
  })
  .strict();

export type HandleClaimContent = z.infer<typeof handleClaimContentSchema>;
export type DelegationContent = z.infer<typeof delegationContentSchema>;
export type FollowEdgeContent = z.infer<typeof followEdgeContentSchema>;
export type BlockEdgeContent = z.infer<typeof blockEdgeContentSchema>;
export type MutePreferenceContent = z.infer<typeof mutePreferenceContentSchema>;
export type RepostContent = z.infer<typeof repostContentSchema>;
export type ReactionContent = z.infer<typeof reactionContentSchema>;
export type BookmarkContent = z.infer<typeof bookmarkContentSchema>;
export type NotificationPreferenceContent = z.infer<typeof notificationPreferenceContentSchema>;
export type HandleClaimPayload = z.infer<typeof handleClaimPayloadSchema>;
export type DelegationPayload = z.infer<typeof delegationPayloadSchema>;
export type FollowEdgePayload = z.infer<typeof followEdgePayloadSchema>;
export type BlockEdgePayload = z.infer<typeof blockEdgePayloadSchema>;
export type MutePreferencePayload = z.infer<typeof mutePreferencePayloadSchema>;
export type RepostPayload = z.infer<typeof repostPayloadSchema>;
export type ReactionPayload = z.infer<typeof reactionPayloadSchema>;
export type BookmarkPayload = z.infer<typeof bookmarkPayloadSchema>;
export type NotificationPreferencePayload = z.infer<typeof notificationPreferencePayloadSchema>;

export const communityRoleAssignmentSchema = z
  .object({
    role: communityRoleNameSchema,
    state: z.enum(['active', 'inactive']),
  })
  .strict();
