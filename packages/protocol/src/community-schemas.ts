import { z } from 'zod';

import {
  COMMUNITY_MEMBERSHIP_SCHEMA_VERSION,
  COMMUNITY_SCHEMA_VERSION,
  MAX_DESCRIPTION_BYTES,
  MAX_ROLES,
  MAX_RULES,
} from './constants.js';
import { communityGovernanceStrategySchema } from './governance.js';
import {
  authorizationScopeSchema,
  commonPayloadFields,
  communityRoleNameSchema,
  contentReferenceSchema,
  identityIdSchema,
  limitedString,
  networkIdSchema,
  nonEmptyLimitedString,
  objectReferenceSchema,
  positiveSequenceSchema,
  positiveTokenAmountSchema,
  replacementSchema,
  safeHttpsUrlSchema,
  solanaPublicKeySchema,
  timestampSchema,
  typedObjectReferenceSchema,
  visibilitySchema,
} from './schema-primitives.js';
import { communityRoleAssignmentSchema } from './social-schemas.js';

const communitySlugSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9_-]{0,61}[a-z0-9])?$/u);

const governanceModelSchema = z.enum([
  'owner',
  'role-consensus',
  'token-weighted',
  'one-member-one-vote',
  'reputation-weighted-with-cap',
  'delegated-voting',
  'moderator-council',
  'consensus',
  'supermajority',
]);

const governanceThresholdSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('simple-majority') }).strict(),
  z
    .object({
      kind: z.literal('supermajority'),
      basisPoints: z.number().int().min(5_001).max(10_000),
    })
    .strict(),
  z.object({ kind: z.literal('consensus') }).strict(),
]);

const governanceQuorumSchema = z
  .object({
    kind: z.enum(['members', 'weight', 'reputation']),
    minimum: positiveTokenAmountSchema,
  })
  .strict();

const federationPeerSchema = z
  .object({
    network: networkIdSchema,
    community: typedObjectReferenceSchema(['community']),
  })
  .strict();

const federationPolicySchema = z
  .object({
    mode: z.enum(['open', 'allow-list', 'block-list', 'closed']),
    allow: z.array(federationPeerSchema).max(128).default([]),
    block: z.array(federationPeerSchema).max(128).default([]),
    policyDocument: contentReferenceSchema.optional(),
  })
  .strict()
  .superRefine((policy, context) => {
    const key = (peer: z.infer<typeof federationPeerSchema>) =>
      `${peer.network}:${peer.community.id}`;
    const allowed = policy.allow.map(key);
    const blocked = policy.block.map(key);
    if (new Set(allowed).size !== allowed.length || new Set(blocked).size !== blocked.length) {
      context.addIssue({ code: 'custom', message: 'Federation peer lists must be unique.' });
    }
    if (allowed.some((peer) => blocked.includes(peer))) {
      context.addIssue({
        code: 'custom',
        message: 'A federation peer cannot be both allowed and blocked.',
      });
    }
    if (policy.mode === 'allow-list' && policy.allow.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['allow'],
        message: 'Allow-list federation requires at least one allowed peer.',
      });
    }
    if (policy.mode === 'closed' && (policy.allow.length > 0 || policy.block.length > 0)) {
      context.addIssue({
        code: 'custom',
        message: 'Closed federation cannot declare peer lists.',
      });
    }
  });

/**
 * Frozen schema-version-1 community shape. It remains readable so historical
 * signatures continue to verify, but new builders use the exact v2 binding.
 */
export const legacyCommunityContentSchema = z
  .object({
    slug: communitySlugSchema,
    name: nonEmptyLimitedString(160),
    description: limitedString(MAX_DESCRIPTION_BYTES).default(''),
    avatar: objectReferenceSchema.optional(),
    banner: objectReferenceSchema.optional(),
    visibility: z.enum(['public', 'unlisted', 'private', 'restricted']),
    membershipPolicy: z.enum(['open', 'request', 'invite']),
    governanceModel: governanceModelSchema,
    governanceThreshold: governanceThresholdSchema,
    governanceQuorum: governanceQuorumSchema,
    reputationWeightCap: positiveTokenAmountSchema.optional(),
    delegationPolicy: objectReferenceSchema.optional(),
    moderatorCouncilRole: communityRoleNameSchema.optional(),
    governanceRuleSet: typedObjectReferenceSchema(['community-rule-set']).optional(),
    moderationRuleSet: typedObjectReferenceSchema(['community-rule-set']).optional(),
    federationPolicy: federationPolicySchema,
    treasury: z
      .object({
        account: solanaPublicKeySchema,
        policy: objectReferenceSchema,
        assetAllowList: z.array(nonEmptyLimitedString(128)).max(64).default([]),
      })
      .strict()
      .optional(),
    replacement: replacementSchema,
  })
  .strict()
  .refine(
    (content) =>
      content.governanceModel !== 'reputation-weighted-with-cap' ||
      content.reputationWeightCap !== undefined,
    'Reputation-weighted governance requires an explicit weight cap.',
  )
  .refine(
    (content) =>
      content.governanceModel !== 'delegated-voting' || content.delegationPolicy !== undefined,
    'Delegated voting requires a delegation policy reference.',
  )
  .refine(
    (content) =>
      content.governanceModel !== 'moderator-council' || content.moderatorCouncilRole !== undefined,
    'Moderator-council governance requires a council role.',
  )
  .refine(
    (content) =>
      content.governanceModel !== 'consensus' || content.governanceThreshold.kind === 'consensus',
    'Consensus governance requires a consensus threshold.',
  )
  .refine(
    (content) =>
      content.governanceModel !== 'supermajority' ||
      content.governanceThreshold.kind === 'supermajority',
    'Supermajority governance requires a bounded supermajority threshold.',
  );

export const communityContentSchema = z
  .object({
    slug: communitySlugSchema,
    name: nonEmptyLimitedString(160),
    description: limitedString(MAX_DESCRIPTION_BYTES).default(''),
    avatar: objectReferenceSchema.optional(),
    banner: objectReferenceSchema.optional(),
    visibility: z.enum(['public', 'unlisted', 'private', 'restricted']),
    membershipPolicy: z.enum(['open', 'request', 'invite']),
    governance: communityGovernanceStrategySchema,
    governanceRuleSet: typedObjectReferenceSchema(['community-rule-set']).optional(),
    moderationRuleSet: typedObjectReferenceSchema(['community-rule-set']).optional(),
    federationPolicy: federationPolicySchema,
    treasury: z
      .object({
        account: solanaPublicKeySchema,
        policy: objectReferenceSchema,
        assetAllowList: z.array(nonEmptyLimitedString(128)).max(64).default([]),
      })
      .strict()
      .optional(),
    replacement: replacementSchema,
  })
  .strict();

/**
 * Frozen schema-version-1 community-membership shape.
 *
 * Historical objects remain readable, but this authority-assigned shape must
 * never be used to create a new membership.
 */
export const legacyCommunityMembershipContentSchema = z
  .object({
    community: typedObjectReferenceSchema(['community']),
    member: identityIdSchema,
    state: z.enum(['requested', 'active', 'left', 'removed', 'banned']),
    roles: z
      .array(communityRoleAssignmentSchema)
      .max(MAX_ROLES)
      .refine(
        (roles) => new Set(roles.map((role) => role.role)).size === roles.length,
        'Community membership roles must be unique.',
      )
      .default([]),
    replacement: replacementSchema,
    reason: limitedString(1_000).optional(),
  })
  .strict()
  .refine(
    (content) =>
      content.state === 'active' || content.roles.every((role) => role.state === 'inactive'),
    'Only active memberships may carry active roles.',
  );

const communityMembershipBaseFields = {
  communityAddress: solanaPublicKeySchema,
  member: identityIdSchema,
  replacement: replacementSchema,
} as const;

const communityJoinContentSchema = z
  .object({
    ...communityMembershipBaseFields,
    action: z.literal('join'),
    state: z.literal('active'),
    roles: z.tuple([z.literal('member')]),
  })
  .strict();

const communityLeaveContentSchema = z
  .object({
    ...communityMembershipBaseFields,
    action: z.literal('leave'),
    state: z.literal('left'),
    roles: z.tuple([]),
  })
  .strict();

const communityRemovalContentSchema = z
  .object({
    ...communityMembershipBaseFields,
    action: z.literal('remove'),
    state: z.literal('removed'),
    roles: z.tuple([]),
    reason: nonEmptyLimitedString(1_000),
  })
  .strict();

const communityBanContentSchema = z
  .object({
    ...communityMembershipBaseFields,
    action: z.literal('ban'),
    state: z.literal('banned'),
    roles: z.tuple([]),
    reason: nonEmptyLimitedString(1_000),
  })
  .strict();

/**
 * Current member-consent membership state.
 *
 * Actions and their resulting state/roles are encoded as a discriminated
 * union so invalid combinations cannot cross the canonical signing boundary.
 */
export const communityMembershipContentSchema = z
  .discriminatedUnion('action', [
    communityJoinContentSchema,
    communityLeaveContentSchema,
    communityRemovalContentSchema,
    communityBanContentSchema,
  ])
  .refine(
    (content) => content.replacement.sequence !== 1 || content.action === 'join',
    'The first community membership action must be a member-authored join.',
  );

export const communityRoleContentSchema = z
  .object({
    community: typedObjectReferenceSchema(['community']),
    name: communityRoleNameSchema,
    displayName: nonEmptyLimitedString(160),
    description: limitedString(1_000).default(''),
    permissions: z
      .array(authorizationScopeSchema)
      .max(64)
      .refine(
        (permissions) => new Set(permissions).size === permissions.length,
        'Role permissions must be unique.',
      ),
    assignmentPolicy: z.enum(['owner', 'role', 'governance']),
    replacement: replacementSchema,
  })
  .strict();

const communityRuleSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/u),
    title: nonEmptyLimitedString(160),
    description: nonEmptyLimitedString(2_000),
    severity: z.enum(['guidance', 'warning', 'removal', 'suspension', 'ban']),
    appealable: z.boolean(),
  })
  .strict();

export const communityRuleSetContentSchema = z
  .object({
    community: typedObjectReferenceSchema(['community']),
    version: positiveSequenceSchema,
    previous: typedObjectReferenceSchema(['community-rule-set']).optional(),
    rules: z
      .array(communityRuleSchema)
      .min(1)
      .max(MAX_RULES)
      .refine(
        (rules) => new Set(rules.map((rule) => rule.id)).size === rules.length,
        'Community rule IDs must be unique.',
      ),
    policyDocument: contentReferenceSchema.optional(),
    moderationProviders: z.array(identityIdSchema).max(32).default([]),
    appealWindowHours: z
      .number()
      .int()
      .positive()
      .max(24 * 365)
      .optional(),
  })
  .strict()
  .refine(
    (content) => content.version === 1 || content.previous !== undefined,
    'Rule-set versions after 1 must reference the previous version.',
  )
  .refine(
    (content) => content.version !== 1 || content.previous === undefined,
    'The first rule-set version cannot reference a previous version.',
  );

const proposalActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('adopt-rule-set'),
      ruleSet: typedObjectReferenceSchema(['community-rule-set']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('assign-role'),
      member: identityIdSchema,
      role: communityRoleNameSchema,
      state: z.enum(['active', 'inactive']),
    })
    .strict(),
  z
    .object({
      kind: z.literal('update-policy'),
      policy: objectReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('payment-intent'),
      recipient: identityIdSchema,
      asset: nonEmptyLimitedString(128),
      amount: positiveTokenAmountSchema,
      rationale: nonEmptyLimitedString(1_000),
    })
    .strict(),
]);

export const governanceProposalContentSchema = z
  .object({
    community: typedObjectReferenceSchema(['community']),
    proposalNumber: positiveSequenceSchema,
    title: nonEmptyLimitedString(200),
    summary: nonEmptyLimitedString(MAX_DESCRIPTION_BYTES),
    details: contentReferenceSchema.optional(),
    actions: z.array(proposalActionSchema).min(1).max(32),
    votingStartsAt: timestampSchema,
    votingEndsAt: timestampSchema,
    executionEndsAt: timestampSchema.optional(),
    choices: z
      .array(nonEmptyLimitedString(160))
      .min(2)
      .max(16)
      .refine(
        (choices) => new Set(choices).size === choices.length,
        'Proposal choices must be unique.',
      ),
    quorum: z
      .object({
        kind: z.enum(['members', 'weight']),
        minimum: positiveTokenAmountSchema,
      })
      .strict(),
  })
  .strict()
  .refine(
    (content) => content.votingStartsAt < content.votingEndsAt,
    'Proposal voting must end after it starts.',
  )
  .refine(
    (content) =>
      content.executionEndsAt === undefined || content.votingEndsAt < content.executionEndsAt,
    'Proposal execution must end after voting.',
  );

export const governanceVoteContentSchema = z
  .object({
    proposal: typedObjectReferenceSchema(['governance-proposal']),
    choice: nonEmptyLimitedString(160),
    claimedWeight: positiveTokenAmountSchema,
    replacement: replacementSchema,
    rationale: limitedString(1_000).optional(),
  })
  .strict();

const eventLocationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('virtual'),
      url: safeHttpsUrlSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('physical-public'),
      label: nonEmptyLimitedString(500),
    })
    .strict(),
  z
    .object({
      kind: z.literal('withheld'),
      accessInstructions: contentReferenceSchema,
    })
    .strict(),
]);

export const eventContentSchema = z
  .object({
    title: nonEmptyLimitedString(200),
    description: limitedString(MAX_DESCRIPTION_BYTES).default(''),
    hosts: z
      .array(identityIdSchema)
      .min(1)
      .max(32)
      .refine((hosts) => new Set(hosts).size === hosts.length, 'Event hosts must be unique.'),
    community: typedObjectReferenceSchema(['community']).optional(),
    startsAt: timestampSchema,
    endsAt: timestampSchema,
    location: eventLocationSchema,
    visibility: visibilitySchema,
    ticketOffering: typedObjectReferenceSchema(['creator-offering']).optional(),
    state: z.enum(['scheduled', 'cancelled']),
    replacement: replacementSchema,
    cancellationReason: limitedString(1_000).optional(),
  })
  .strict()
  .refine((content) => content.startsAt < content.endsAt, 'An event must end after it starts.')
  .refine(
    (content) => content.state !== 'cancelled' || content.cancellationReason !== undefined,
    'Cancelled events require a reason.',
  );

export const communityPayloadSchema = z
  .object({
    ...commonPayloadFields,
    schemaVersion: z.literal(COMMUNITY_SCHEMA_VERSION),
    type: z.literal('community'),
    content: communityContentSchema,
  })
  .strict();

export const legacyCommunityPayloadSchema = z
  .object({
    ...commonPayloadFields,
    schemaVersion: z.literal(1),
    type: z.literal('community'),
    content: legacyCommunityContentSchema,
  })
  .strict();

export const communityMembershipPayloadSchema = z
  .object({
    ...commonPayloadFields,
    schemaVersion: z.literal(COMMUNITY_MEMBERSHIP_SCHEMA_VERSION),
    type: z.literal('community-membership'),
    content: communityMembershipContentSchema,
  })
  .strict()
  .superRefine((payload, context) => {
    const isSelfAction = payload.content.action === 'join' || payload.content.action === 'leave';
    if (isSelfAction && payload.author !== payload.content.member) {
      context.addIssue({
        code: 'custom',
        path: ['author'],
        message: 'Community join and leave actions must be authored by the member.',
      });
    }
    if (!isSelfAction && payload.author === payload.content.member) {
      context.addIssue({
        code: 'custom',
        path: ['author'],
        message: 'Community removal and ban actions must be authored by a moderator.',
      });
    }
    if (!payload.content.member.startsWith(`wetdroolid:v1:${payload.network}:`)) {
      context.addIssue({
        code: 'custom',
        path: ['content', 'member'],
        message: 'The community member must belong to the payload network.',
      });
    }
  });

export const legacyCommunityMembershipPayloadSchema = z
  .object({
    ...commonPayloadFields,
    schemaVersion: z.literal(1),
    type: z.literal('community-membership'),
    content: legacyCommunityMembershipContentSchema,
  })
  .strict();

export const communityRolePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('community-role'),
    content: communityRoleContentSchema,
  })
  .strict();

export const communityRuleSetPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('community-rule-set'),
    content: communityRuleSetContentSchema,
  })
  .strict();

export const governanceProposalPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('governance-proposal'),
    content: governanceProposalContentSchema,
  })
  .strict();

export const governanceVotePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('governance-vote'),
    content: governanceVoteContentSchema,
  })
  .strict();

export const eventPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('event'),
    content: eventContentSchema,
  })
  .strict()
  .refine(
    (payload) => payload.content.hosts.includes(payload.author),
    'The event author must be one of its hosts.',
  );

export type CommunityContent = z.infer<typeof communityContentSchema>;
export type LegacyCommunityContent = z.infer<typeof legacyCommunityContentSchema>;
export type CommunityMembershipContent = z.infer<typeof communityMembershipContentSchema>;
export type LegacyCommunityMembershipContent = z.infer<
  typeof legacyCommunityMembershipContentSchema
>;
export type CommunityRoleContent = z.infer<typeof communityRoleContentSchema>;
export type CommunityRuleSetContent = z.infer<typeof communityRuleSetContentSchema>;
export type GovernanceProposalContent = z.infer<typeof governanceProposalContentSchema>;
export type GovernanceVoteContent = z.infer<typeof governanceVoteContentSchema>;
export type EventContent = z.infer<typeof eventContentSchema>;
export type CommunityPayload = z.infer<typeof communityPayloadSchema>;
export type LegacyCommunityPayload = z.infer<typeof legacyCommunityPayloadSchema>;
export type CommunityMembershipPayload = z.infer<typeof communityMembershipPayloadSchema>;
export type LegacyCommunityMembershipPayload = z.infer<
  typeof legacyCommunityMembershipPayloadSchema
>;
export type CommunityRolePayload = z.infer<typeof communityRolePayloadSchema>;
export type CommunityRuleSetPayload = z.infer<typeof communityRuleSetPayloadSchema>;
export type GovernanceProposalPayload = z.infer<typeof governanceProposalPayloadSchema>;
export type GovernanceVotePayload = z.infer<typeof governanceVotePayloadSchema>;
export type EventPayload = z.infer<typeof eventPayloadSchema>;
