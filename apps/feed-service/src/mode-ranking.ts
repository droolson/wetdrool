import { FEED_POLICY, type ExplanationReason, type ScoreComponents } from './policy.js';
import {
  addToRankingContext,
  createFeedScorer,
  emptyRankingContext,
  type RankingContext,
  type ScoredItem,
} from './scoring.js';
import type { FeedItem, RankRequest, ViewerContext } from './schemas.js';

export interface ModeSelection {
  readonly items: readonly FeedItem[];
  readonly scopeMismatch: number;
}

export function selectModeItems(request: RankRequest): ModeSelection {
  let items: readonly FeedItem[];
  switch (request.mode) {
    case 'following': {
      const followed = new Set(request.viewer.followingAuthorIds);
      items = request.items.filter((item) => followed.has(item.authorId));
      break;
    }
    case 'community':
      items = request.items.filter((item) => item.communityId === request.modeContext.communityId);
      break;
    case 'media':
      items = request.items.filter((item) => item.summary.mediaCount > 0);
      break;
    default:
      items = request.items;
  }
  return {
    items,
    scopeMismatch: request.items.length - items.length,
  };
}

export function rankModeItems(
  items: readonly FeedItem[],
  request: RankRequest,
  effectiveMode: RankRequest['mode'],
): ScoredItem[] {
  switch (effectiveMode) {
    case 'recommended':
      return rankRecommendations(items, request);
    case 'trending':
      return rankTrending(items, request);
    case 'third-party':
      return rankThirdParty(items, request);
    case 'following':
      return rankChronologically(items, request, {
        code: 'following-chronological-order',
        kind: 'ordering',
        text: 'Following mode includes only explicitly followed authors and orders posts newest first.',
      });
    case 'community':
      return rankChronologically(items, request, {
        code: 'community-chronological-order',
        kind: 'ordering',
        text: 'Community mode includes only the selected community and orders posts newest first.',
      });
    case 'media':
      return rankChronologically(items, request, {
        code: 'media-chronological-order',
        kind: 'ordering',
        text: 'Media mode includes only posts with media and orders them newest first.',
      });
    case 'chronological':
      return rankChronologically(items, request, {
        code: 'chronological-order',
        kind: 'ordering',
        text: 'Chronological mode orders eligible posts newest first.',
      });
  }
}

export function compareChronological(left: FeedItem, right: FeedItem): number {
  const timeDifference = Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }
  if (left.id < right.id) {
    return -1;
  }
  return left.id > right.id ? 1 : 0;
}

function rankChronologically(
  items: readonly FeedItem[],
  request: RankRequest,
  orderingReason: ExplanationReason,
): ScoredItem[] {
  const sorted = [...items].sort(compareChronological);
  const scoreItem = createFeedScorer(neutralViewer(request.viewer), request.asOf);
  let context = emptyRankingContext();
  return sorted.map((item) => {
    const scored = scoreItem(item, context);
    context = addToRankingContext(context, item);
    return {
      ...scored,
      reasons: [orderingReason, ...withoutFallbackReasons(scored.reasons)],
    };
  });
}

function rankRecommendations(items: readonly FeedItem[], request: RankRequest): ScoredItem[] {
  const remaining = [...items];
  const ranked: ScoredItem[] = [];
  const scoreItem = createFeedScorer(request.viewer, request.asOf);
  let context = emptyRankingContext();

  while (remaining.length > 0) {
    let selectedIndex = 0;
    let selected = scoreItem(remaining[0] as FeedItem, context);
    for (let index = 1; index < remaining.length; index += 1) {
      const candidate = scoreItem(remaining[index] as FeedItem, context);
      if (compareScored(candidate, selected) < 0) {
        selectedIndex = index;
        selected = candidate;
      }
    }
    const [selectedItem] = remaining.splice(selectedIndex, 1);
    if (selectedItem === undefined) {
      break;
    }
    ranked.push(selected);
    context = addToRankingContext(context, selectedItem);
  }
  return ranked;
}

function rankTrending(items: readonly FeedItem[], request: RankRequest): ScoredItem[] {
  const remaining = [...items];
  const ranked: ScoredItem[] = [];
  const scoreItem = createFeedScorer(neutralViewer(request.viewer), request.asOf);
  let context = emptyRankingContext();

  while (remaining.length > 0) {
    let selectedIndex = 0;
    let selected = withTrendVelocity(
      scoreItem(remaining[0] as FeedItem, context),
      remaining[0] as FeedItem,
    );
    for (let index = 1; index < remaining.length; index += 1) {
      const item = remaining[index] as FeedItem;
      const candidate = withTrendVelocity(scoreItem(item, context), item);
      if (compareScored(candidate, selected) < 0) {
        selectedIndex = index;
        selected = candidate;
      }
    }
    const [selectedItem] = remaining.splice(selectedIndex, 1);
    if (selectedItem === undefined) {
      break;
    }
    ranked.push(selected);
    context = addToRankingContext(context, selectedItem);
  }
  return ranked;
}

function withTrendVelocity(base: ScoredItem, item: FeedItem): ScoredItem {
  const trend = item.trend;
  if (trend === undefined) {
    throw new RangeError('Validated trending item is missing its observation window.');
  }
  const hours =
    (Date.parse(trend.observedAt) - Date.parse(trend.windowStartedAt)) / (60 * 60 * 1_000);
  const weightedInteractions =
    trend.uniqueEngagers + trend.reactions * 0.5 + trend.replies * 2 + trend.reposts * 1.5;
  const perHour = Math.min(
    weightedInteractions / hours,
    FEED_POLICY.positive.trendVelocitySaturationPerHour,
  );
  const trendVelocity = round(
    (FEED_POLICY.positive.trendVelocityMaximum * Math.log1p(perHour)) /
      Math.log1p(FEED_POLICY.positive.trendVelocitySaturationPerHour),
  );
  const components: ScoreComponents = {
    ...base.score.components,
    boundedPopularity: 0,
    trendVelocity,
  };
  return {
    ...base,
    score: {
      ...base.score,
      total: totalFromComponents(components),
      components,
    },
    reasons: [
      {
        code: 'bounded-trend-velocity',
        kind: 'boost',
        text: 'A caller-supplied 15-minute to 24-hour interaction window adds a capped velocity boost; this service did not infer the activity.',
      },
      ...withoutFallbackReasons(base.reasons).filter(
        (reason) => reason.code !== 'bounded-popularity',
      ),
    ],
  };
}

function rankThirdParty(items: readonly FeedItem[], request: RankRequest): ScoredItem[] {
  const thirdParty = request.modeContext.thirdParty;
  if (thirdParty === undefined) {
    throw new RangeError('Validated third-party mode is missing provider metadata.');
  }
  const byId = new Map(items.map((item) => [item.id, item]));
  const scoreItem = createFeedScorer(neutralViewer(request.viewer), request.asOf);
  const ranked: ScoredItem[] = [];
  let context: RankingContext = emptyRankingContext();

  for (const itemId of thirdParty.orderedItemIds) {
    const item = byId.get(itemId);
    if (item === undefined) {
      continue;
    }
    const scored = scoreItem(item, context);
    ranked.push({
      ...scored,
      reasons: [
        {
          code: 'third-party-provider-order',
          kind: 'ordering',
          text: `External provider explanation (not verified): ${thirdParty.explanation}`,
        },
        ...withoutFallbackReasons(scored.reasons),
      ],
    });
    context = addToRankingContext(context, item);
  }
  return ranked;
}

function neutralViewer(viewer: ViewerContext): ViewerContext {
  return {
    ...viewer,
    behavioralPersonalization: false,
    resetPreferences: false,
    declaredTopicInterests: [],
    followingAuthorIds: [],
    communityIds: [],
    feedback: {
      positive: { itemIds: [], authorIds: [], topics: [] },
      negative: { itemIds: [], authorIds: [], topics: [] },
    },
    recentExposure: [],
  };
}

function totalFromComponents(components: ScoreComponents): number {
  const positive =
    components.declaredTopicInterest +
    components.followRelationship +
    components.freshness +
    components.communityMembership +
    components.explicitFeedback +
    components.boundedPopularity +
    components.trendVelocity;
  const penalties =
    components.authorRepetitionPenalty +
    components.topicRepetitionPenalty +
    components.duplicateOrRepostPenalty +
    components.suspectedSpamPenalty +
    components.rageBaitPenalty;
  return round(
    Math.min(FEED_POLICY.total.maximum, Math.max(FEED_POLICY.total.minimum, positive - penalties)),
  );
}

function compareScored(left: ScoredItem, right: ScoredItem): number {
  if (left.score.total !== right.score.total) {
    return right.score.total - left.score.total;
  }
  return compareChronological(left.item, right.item);
}

function withoutFallbackReasons(
  reasons: readonly ExplanationReason[],
): readonly ExplanationReason[] {
  return reasons.filter(
    (reason) => reason.code !== 'chronological-fallback' && reason.code !== 'transparent-score',
  );
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
