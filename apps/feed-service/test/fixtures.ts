import {
  feedItemSchema,
  rankRequestSchema,
  viewerContextSchema,
  type FeedItem,
  type RankRequest,
  type ViewerContext,
} from '../src/index.js';

const AS_OF = '2026-07-28T18:00:00.000Z';

export function feedItem(
  id: string,
  overrides: {
    readonly authorId?: string;
    readonly publishedAt?: string;
    readonly topics?: readonly string[];
    readonly communityId?: string;
    readonly duplicateClusterId?: string;
    readonly excerpt?: string;
    readonly mediaCount?: number;
    readonly engagement?: {
      readonly likes?: number;
      readonly replies?: number;
      readonly reposts?: number;
    };
    readonly signals?: {
      readonly sensitiveContentRisk?: number;
      readonly suspectedSpamRisk?: number;
      readonly rageBaitRisk?: number;
      readonly duplicateRisk?: number;
      readonly repostLoopRisk?: number;
    };
    readonly trend?: NonNullable<FeedItem['trend']>;
  } = {},
): FeedItem {
  return feedItemSchema.parse({
    id,
    authorId: overrides.authorId ?? `author-${id}`,
    publishedAt: overrides.publishedAt ?? '2026-07-28T17:00:00.000Z',
    topics: overrides.topics ?? [],
    ...(overrides.communityId === undefined ? {} : { communityId: overrides.communityId }),
    ...(overrides.duplicateClusterId === undefined
      ? {}
      : { duplicateClusterId: overrides.duplicateClusterId }),
    summary: {
      excerpt: overrides.excerpt ?? `Public summary for ${id}`,
      mediaCount: overrides.mediaCount ?? 0,
      contentWarnings: [],
    },
    engagement: {
      likes: overrides.engagement?.likes ?? 0,
      replies: overrides.engagement?.replies ?? 0,
      reposts: overrides.engagement?.reposts ?? 0,
    },
    signals: {
      sensitiveContentRisk: overrides.signals?.sensitiveContentRisk ?? 0,
      suspectedSpamRisk: overrides.signals?.suspectedSpamRisk ?? 0,
      rageBaitRisk: overrides.signals?.rageBaitRisk ?? 0,
      duplicateRisk: overrides.signals?.duplicateRisk ?? 0,
      repostLoopRisk: overrides.signals?.repostLoopRisk ?? 0,
    },
    ...(overrides.trend === undefined ? {} : { trend: overrides.trend }),
    signedProjection: {
      source: 'test-open-indexer',
      sourceCheckpoint: 'finalized-slot-1234',
      summaryId: `summary-${id}`,
      issuedAt: AS_OF,
      keyId: 'test-key-1',
      algorithm: 'ed25519',
      signature: 'a'.repeat(88),
    },
  });
}

export function viewer(overrides: Partial<ViewerContext> = {}): ViewerContext {
  return viewerContextSchema.parse({
    behavioralPersonalization: true,
    resetPreferences: false,
    declaredTopicInterests: [],
    followingAuthorIds: [],
    communityIds: [],
    feedback: {
      positive: { itemIds: [], authorIds: [], topics: [] },
      negative: { itemIds: [], authorIds: [], topics: [] },
    },
    recentExposure: [],
    blockedAuthorIds: [],
    mutedAuthorIds: [],
    mutedKeywords: [],
    sensitiveContentThreshold: 1,
    ...overrides,
  });
}

export function rankRequest(overrides: Partial<RankRequest> = {}): RankRequest {
  return rankRequestSchema.parse({
    mode: 'recommended',
    asOf: AS_OF,
    limit: 20,
    viewer: viewer({
      declaredTopicInterests: [{ topic: 'technology', weight: 1 }],
    }),
    items: [],
    ...overrides,
  });
}

export { AS_OF };
