import { z } from 'zod';

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed.');

const topicSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => value === value.normalize('NFC'), 'Topics must use NFC normalization.')
  .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed.');

const keywordSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => value === value.normalize('NFC'), 'Keywords must use NFC normalization.')
  .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed.');

const riskSchema = z.number().finite().min(0).max(1);
const boundedCountSchema = z.number().int().min(0).max(1_000_000_000);
const semanticVersionSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u)
  .max(32);

export const feedModeSchema = z.enum([
  'chronological',
  'following',
  'community',
  'trending',
  'media',
  'recommended',
  'third-party',
]);

export const signedProjectionSchema = z.strictObject({
  source: identifierSchema,
  sourceCheckpoint: identifierSchema,
  summaryId: identifierSchema,
  issuedAt: z.string().datetime({ offset: true }),
  keyId: identifierSchema,
  algorithm: z.string().trim().min(1).max(64),
  signature: z.string().trim().min(16).max(1_024),
});

export const feedItemSchema = z.strictObject({
  id: identifierSchema,
  authorId: identifierSchema,
  publishedAt: z.string().datetime({ offset: true }),
  topics: z.array(topicSchema).max(16).default([]),
  communityId: identifierSchema.optional(),
  duplicateClusterId: identifierSchema.optional(),
  summary: z.strictObject({
    excerpt: z.string().max(1_000).optional(),
    language: z.string().trim().min(2).max(35).optional(),
    mediaCount: z.number().int().min(0).max(32).default(0),
    contentWarnings: z.array(z.string().trim().min(1).max(80)).max(16).default([]),
  }),
  engagement: z
    .strictObject({
      likes: boundedCountSchema.default(0),
      replies: boundedCountSchema.default(0),
      reposts: boundedCountSchema.default(0),
    })
    .default({ likes: 0, replies: 0, reposts: 0 }),
  signals: z
    .strictObject({
      sensitiveContentRisk: riskSchema.default(0),
      suspectedSpamRisk: riskSchema.default(0),
      rageBaitRisk: riskSchema.default(0),
      duplicateRisk: riskSchema.default(0),
      repostLoopRisk: riskSchema.default(0),
    })
    .default({
      sensitiveContentRisk: 0,
      suspectedSpamRisk: 0,
      rageBaitRisk: 0,
      duplicateRisk: 0,
      repostLoopRisk: 0,
    }),
  trend: z
    .strictObject({
      windowStartedAt: z.string().datetime({ offset: true }),
      observedAt: z.string().datetime({ offset: true }),
      uniqueEngagers: boundedCountSchema,
      reactions: boundedCountSchema,
      replies: boundedCountSchema,
      reposts: boundedCountSchema,
    })
    .superRefine((trend, context) => {
      const interactionCount = trend.reactions + trend.replies + trend.reposts;
      if (
        (interactionCount === 0 && trend.uniqueEngagers !== 0) ||
        trend.uniqueEngagers > interactionCount
      ) {
        context.addIssue({
          code: 'custom',
          path: ['uniqueEngagers'],
          message: 'Unique engagers cannot exceed the supplied interaction count.',
        });
      }
    })
    .optional(),
  signedProjection: signedProjectionSchema,
});

export const thirdPartyFeedOrderSchema = z.strictObject({
  providerId: identifierSchema,
  endpoint: z
    .url()
    .max(2_048)
    .refine(isSafeProviderEndpoint, 'Provider endpoints must use HTTPS or loopback HTTP.'),
  algorithmId: identifierSchema,
  algorithmVersion: semanticVersionSchema,
  explanation: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => !hasControlCharacter(value), 'Control characters are not allowed.'),
  orderedItemIds: z.array(identifierSchema).min(1).max(500),
});

export const feedModeContextSchema = z
  .strictObject({
    communityId: identifierSchema.optional(),
    thirdParty: thirdPartyFeedOrderSchema.optional(),
  })
  .default({});

export const appliedFeedPoliciesSchema = z
  .strictObject({
    tombstonesApplied: z.boolean().default(false),
    moderationProviderIds: z.array(identifierSchema).max(32).default([]),
  })
  .default({ tombstonesApplied: false, moderationProviderIds: [] });

const feedbackSetSchema = z
  .strictObject({
    itemIds: z.array(identifierSchema).max(100).default([]),
    authorIds: z.array(identifierSchema).max(100).default([]),
    topics: z.array(topicSchema).max(100).default([]),
  })
  .default({ itemIds: [], authorIds: [], topics: [] });

export const viewerContextSchema = z.strictObject({
  viewerId: identifierSchema.optional(),
  behavioralPersonalization: z.boolean().default(true),
  resetPreferences: z.boolean().default(false),
  declaredTopicInterests: z
    .array(
      z.strictObject({
        topic: topicSchema,
        weight: z.number().finite().min(0).max(1),
      }),
    )
    .max(64)
    .default([]),
  followingAuthorIds: z.array(identifierSchema).max(2_000).default([]),
  communityIds: z.array(identifierSchema).max(500).default([]),
  feedback: z
    .strictObject({
      positive: feedbackSetSchema,
      negative: feedbackSetSchema,
    })
    .default({
      positive: { itemIds: [], authorIds: [], topics: [] },
      negative: { itemIds: [], authorIds: [], topics: [] },
    }),
  recentExposure: z
    .array(
      z.strictObject({
        authorId: identifierSchema,
        topics: z.array(topicSchema).max(16).default([]),
        duplicateClusterId: identifierSchema.optional(),
      }),
    )
    .max(100)
    .default([]),
  blockedAuthorIds: z.array(identifierSchema).max(2_000).default([]),
  mutedAuthorIds: z.array(identifierSchema).max(2_000).default([]),
  mutedKeywords: z.array(keywordSchema).max(100).default([]),
  sensitiveContentThreshold: riskSchema.default(1),
});

export const rankRequestSchema = z
  .strictObject({
    mode: feedModeSchema.default('recommended'),
    modeContext: feedModeContextSchema,
    appliedPolicies: appliedFeedPoliciesSchema,
    asOf: z.string().datetime({ offset: true }),
    limit: z.number().int().min(1).max(50).default(20),
    cursor: z.string().min(1).max(2_048).optional(),
    viewer: viewerContextSchema,
    items: z.array(feedItemSchema).max(500),
  })
  .superRefine((request, context) => {
    const asOfTime = Date.parse(request.asOf);
    validateModeContext(request, context);
    const declaredTopics = new Set<string>();
    for (const [index, interest] of request.viewer.declaredTopicInterests.entries()) {
      const normalizedTopic = interest.topic.normalize('NFKC').toLowerCase();
      if (declaredTopics.has(normalizedTopic)) {
        context.addIssue({
          code: 'custom',
          path: ['viewer', 'declaredTopicInterests', index, 'topic'],
          message: 'Declared topic interests must be unique after normalization.',
        });
      }
      declaredTopics.add(normalizedTopic);
    }

    const itemIds = new Set<string>();
    const summaryIds = new Set<string>();
    for (const [index, item] of request.items.entries()) {
      const itemTopics = new Set<string>();
      for (const [topicIndex, topic] of item.topics.entries()) {
        const normalizedTopic = topic.normalize('NFKC').toLowerCase();
        if (itemTopics.has(normalizedTopic)) {
          context.addIssue({
            code: 'custom',
            path: ['items', index, 'topics', topicIndex],
            message: 'Item topics must be unique after normalization.',
          });
        }
        itemTopics.add(normalizedTopic);
      }
      if (Date.parse(item.publishedAt) > asOfTime) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'publishedAt'],
          message: 'Publication time must not be later than the request asOf time.',
        });
      }
      if (Date.parse(item.signedProjection.issuedAt) > asOfTime) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'signedProjection', 'issuedAt'],
          message: 'Projection issue time must not be later than the request asOf time.',
        });
      }
      if (item.trend !== undefined) {
        const windowStartedAt = Date.parse(item.trend.windowStartedAt);
        const observedAt = Date.parse(item.trend.observedAt);
        const windowMilliseconds = observedAt - windowStartedAt;
        if (observedAt > asOfTime) {
          context.addIssue({
            code: 'custom',
            path: ['items', index, 'trend', 'observedAt'],
            message: 'Trend observation time must not be later than the request asOf time.',
          });
        }
        if (windowMilliseconds < 15 * 60 * 1_000 || windowMilliseconds > 24 * 60 * 60 * 1_000) {
          context.addIssue({
            code: 'custom',
            path: ['items', index, 'trend', 'windowStartedAt'],
            message: 'Trend windows must span between 15 minutes and 24 hours.',
          });
        }
      } else if (request.mode === 'trending') {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'trend'],
          message: 'Trending mode requires a bounded trend observation for every item.',
        });
      }
      if (itemIds.has(item.id)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'id'],
          message: 'Item IDs must be unique within a ranking request.',
        });
      }
      itemIds.add(item.id);

      if (summaryIds.has(item.signedProjection.summaryId)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'signedProjection', 'summaryId'],
          message: 'Projection summary IDs must be unique within a ranking request.',
        });
      }
      summaryIds.add(item.signedProjection.summaryId);
    }

    const thirdParty = request.modeContext.thirdParty;
    if (thirdParty !== undefined) {
      const orderedIds = new Set<string>();
      for (const [index, itemId] of thirdParty.orderedItemIds.entries()) {
        if (orderedIds.has(itemId)) {
          context.addIssue({
            code: 'custom',
            path: ['modeContext', 'thirdParty', 'orderedItemIds', index],
            message: 'Third-party order must not repeat an item ID.',
          });
        }
        orderedIds.add(itemId);
      }
      if (
        orderedIds.size !== itemIds.size ||
        [...itemIds].some((itemId) => !orderedIds.has(itemId))
      ) {
        context.addIssue({
          code: 'custom',
          path: ['modeContext', 'thirdParty', 'orderedItemIds'],
          message: 'Third-party order must contain every request item exactly once.',
        });
      }
    }
  });

export type FeedItem = z.infer<typeof feedItemSchema>;
export type FeedMode = z.infer<typeof feedModeSchema>;
export type FeedModeContext = z.infer<typeof feedModeContextSchema>;
export type RankRequest = z.infer<typeof rankRequestSchema>;
export type ThirdPartyFeedOrder = z.infer<typeof thirdPartyFeedOrderSchema>;
export type ViewerContext = z.infer<typeof viewerContextSchema>;

function validateModeContext(
  request: {
    readonly mode: FeedMode;
    readonly modeContext: FeedModeContext;
  },
  context: z.core.$RefinementCtx,
): void {
  const needsCommunity = request.mode === 'community';
  const needsThirdParty = request.mode === 'third-party';
  if (needsCommunity !== (request.modeContext.communityId !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['modeContext', 'communityId'],
      message: needsCommunity
        ? 'Community mode requires one community ID.'
        : 'communityId is only valid in community mode.',
    });
  }
  if (needsThirdParty !== (request.modeContext.thirdParty !== undefined)) {
    context.addIssue({
      code: 'custom',
      path: ['modeContext', 'thirdParty'],
      message: needsThirdParty
        ? 'Third-party mode requires provider order metadata.'
        : 'thirdParty metadata is only valid in third-party mode.',
    });
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
  });
}

function isSafeProviderEndpoint(value: string): boolean {
  const endpoint = new URL(value);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    return false;
  }
  if (endpoint.protocol === 'https:') {
    return true;
  }
  return (
    endpoint.protocol === 'http:' &&
    (endpoint.hostname === 'localhost' ||
      endpoint.hostname === '127.0.0.1' ||
      endpoint.hostname === '[::1]')
  );
}
