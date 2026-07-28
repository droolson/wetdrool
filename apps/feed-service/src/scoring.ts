import {
  FEED_POLICY,
  FEED_POLICY_VERSION,
  type ExplanationReason,
  type ScoreComponents,
} from './policy.js';
import type { FeedItem, ViewerContext } from './schemas.js';

export type PersonalizationState = 'active' | 'behavioral-opt-out' | 'empty' | 'reset';

export interface RankingContext {
  readonly selectedAuthorCounts: ReadonlyMap<string, number>;
  readonly selectedTopicCounts: ReadonlyMap<string, number>;
  readonly selectedDuplicateCounts: ReadonlyMap<string, number>;
}

export interface ScoredItem {
  readonly item: FeedItem;
  readonly score: {
    readonly policyVersion: typeof FEED_POLICY_VERSION;
    readonly total: number;
    readonly components: ScoreComponents;
  };
  readonly reasons: readonly ExplanationReason[];
}

interface ScoringProfile {
  readonly personalizationState: PersonalizationState;
  readonly personalizationEnabled: boolean;
  readonly behavioralEnabled: boolean;
  readonly asOfTime: number;
  readonly interests: ReadonlyMap<string, number>;
  readonly followingAuthorIds: ReadonlySet<string>;
  readonly communityIds: ReadonlySet<string>;
  readonly positiveItemIds: ReadonlySet<string>;
  readonly positiveAuthorIds: ReadonlySet<string>;
  readonly positiveTopics: ReadonlySet<string>;
  readonly negativeItemIds: ReadonlySet<string>;
  readonly negativeAuthorIds: ReadonlySet<string>;
  readonly negativeTopics: ReadonlySet<string>;
  readonly priorAuthorCounts: ReadonlyMap<string, number>;
  readonly priorTopicCounts: ReadonlyMap<string, number>;
  readonly priorDuplicateCounts: ReadonlyMap<string, number>;
}

export function getPersonalizationState(viewer: ViewerContext): PersonalizationState {
  if (viewer.resetPreferences) {
    return 'reset';
  }

  const hasDeclaredSignals =
    viewer.declaredTopicInterests.some((interest) => interest.weight > 0) ||
    viewer.followingAuthorIds.length > 0 ||
    viewer.communityIds.length > 0;
  const hasBehavioralSignals =
    viewer.feedback.positive.itemIds.length > 0 ||
    viewer.feedback.positive.authorIds.length > 0 ||
    viewer.feedback.positive.topics.length > 0 ||
    viewer.feedback.negative.itemIds.length > 0 ||
    viewer.feedback.negative.authorIds.length > 0 ||
    viewer.feedback.negative.topics.length > 0 ||
    viewer.recentExposure.length > 0;

  if (!hasDeclaredSignals && (!viewer.behavioralPersonalization || !hasBehavioralSignals)) {
    return 'empty';
  }
  return viewer.behavioralPersonalization ? 'active' : 'behavioral-opt-out';
}

export function emptyRankingContext(): RankingContext {
  return {
    selectedAuthorCounts: new Map(),
    selectedTopicCounts: new Map(),
    selectedDuplicateCounts: new Map(),
  };
}

export function scoreItem(
  item: FeedItem,
  viewer: ViewerContext,
  asOf: string,
  rankingContext: RankingContext = emptyRankingContext(),
): ScoredItem {
  return createFeedScorer(viewer, asOf)(item, rankingContext);
}

export function createFeedScorer(
  viewer: ViewerContext,
  asOf: string,
): (item: FeedItem, rankingContext?: RankingContext) => ScoredItem {
  const profile = compileScoringProfile(viewer, asOf);
  return (item, rankingContext = emptyRankingContext()) =>
    scoreItemWithProfile(item, profile, rankingContext);
}

function scoreItemWithProfile(
  item: FeedItem,
  profile: ScoringProfile,
  rankingContext: RankingContext,
): ScoredItem {
  const normalizedTopics = unique(item.topics.map(normalizeForMatch));
  const matchingInterestWeight = normalizedTopics.reduce(
    (sum, topic) => sum + (profile.interests.get(topic) ?? 0),
    0,
  );
  const declaredTopicInterest = profile.personalizationEnabled
    ? round(FEED_POLICY.positive.declaredTopicInterestMaximum * clamp(matchingInterestWeight, 0, 1))
    : 0;
  const followRelationship =
    profile.personalizationEnabled && profile.followingAuthorIds.has(item.authorId)
      ? FEED_POLICY.positive.followRelationship
      : 0;

  const ageHours = Math.max(
    0,
    (profile.asOfTime - Date.parse(item.publishedAt)) / (60 * 60 * 1_000),
  );
  const freshness = round(
    FEED_POLICY.positive.freshnessMaximum *
      Math.pow(0.5, ageHours / FEED_POLICY.positive.freshnessHalfLifeHours),
  );
  const communityMembership =
    profile.personalizationEnabled &&
    item.communityId !== undefined &&
    profile.communityIds.has(item.communityId)
      ? FEED_POLICY.positive.communityMembership
      : 0;
  const explicitFeedback = profile.behavioralEnabled
    ? feedbackScore(item, normalizedTopics, profile)
    : 0;
  const boundedPopularity = popularityScore(item);

  const priorAuthorCount = profile.priorAuthorCounts.get(item.authorId) ?? 0;
  const selectedAuthorCount = rankingContext.selectedAuthorCounts.get(item.authorId) ?? 0;
  const authorRepetitionPenalty = round(
    Math.min(
      FEED_POLICY.penalties.authorRepetitionMaximum,
      (priorAuthorCount + selectedAuthorCount) * 3,
    ),
  );

  const priorTopicMatches = normalizedTopics.reduce(
    (count, topic) => count + (profile.priorTopicCounts.get(topic) ?? 0),
    0,
  );
  const selectedTopicMatches = normalizedTopics.reduce(
    (count, topic) => count + (rankingContext.selectedTopicCounts.get(topic) ?? 0),
    0,
  );
  const topicRepetitionPenalty = round(
    Math.min(
      FEED_POLICY.penalties.topicRepetitionMaximum,
      (priorTopicMatches + selectedTopicMatches) * 1.5,
    ),
  );

  const priorDuplicateMatches =
    item.duplicateClusterId === undefined
      ? 0
      : (profile.priorDuplicateCounts.get(item.duplicateClusterId) ?? 0);
  const selectedDuplicateMatches =
    item.duplicateClusterId === undefined
      ? 0
      : (rankingContext.selectedDuplicateCounts.get(item.duplicateClusterId) ?? 0);
  const duplicateOrRepostPenalty = round(
    Math.min(
      FEED_POLICY.penalties.duplicateOrRepostMaximum,
      item.signals.duplicateRisk * 7 +
        item.signals.repostLoopRisk * 7 +
        Math.min(1, priorDuplicateMatches + selectedDuplicateMatches) * 8,
    ),
  );
  const suspectedSpamPenalty = round(
    item.signals.suspectedSpamRisk * FEED_POLICY.penalties.suspectedSpamMaximum,
  );
  const rageBaitPenalty = round(item.signals.rageBaitRisk * FEED_POLICY.penalties.rageBaitMaximum);

  const components: ScoreComponents = {
    declaredTopicInterest,
    followRelationship,
    freshness,
    communityMembership,
    explicitFeedback,
    boundedPopularity,
    trendVelocity: 0,
    authorRepetitionPenalty,
    topicRepetitionPenalty,
    duplicateOrRepostPenalty,
    suspectedSpamPenalty,
    rageBaitPenalty,
  };
  const positiveTotal =
    declaredTopicInterest +
    followRelationship +
    freshness +
    communityMembership +
    explicitFeedback +
    boundedPopularity;
  const penaltyTotal =
    authorRepetitionPenalty +
    topicRepetitionPenalty +
    duplicateOrRepostPenalty +
    suspectedSpamPenalty +
    rageBaitPenalty;
  const total = round(
    clamp(positiveTotal - penaltyTotal, FEED_POLICY.total.minimum, FEED_POLICY.total.maximum),
  );

  return {
    item,
    score: {
      policyVersion: FEED_POLICY_VERSION,
      total,
      components,
    },
    reasons: explain(components, profile.personalizationState),
  };
}

export function addToRankingContext(current: RankingContext, item: FeedItem): RankingContext {
  const selectedAuthorCounts = new Map(current.selectedAuthorCounts);
  selectedAuthorCounts.set(item.authorId, (selectedAuthorCounts.get(item.authorId) ?? 0) + 1);

  const selectedTopicCounts = new Map(current.selectedTopicCounts);
  for (const topic of unique(item.topics.map(normalizeForMatch))) {
    selectedTopicCounts.set(topic, (selectedTopicCounts.get(topic) ?? 0) + 1);
  }

  const selectedDuplicateCounts = new Map(current.selectedDuplicateCounts);
  if (item.duplicateClusterId !== undefined) {
    selectedDuplicateCounts.set(
      item.duplicateClusterId,
      (selectedDuplicateCounts.get(item.duplicateClusterId) ?? 0) + 1,
    );
  }
  return { selectedAuthorCounts, selectedTopicCounts, selectedDuplicateCounts };
}

function feedbackScore(
  item: FeedItem,
  normalizedTopics: readonly string[],
  profile: ScoringProfile,
): number {
  const positive =
    (profile.positiveItemIds.has(item.id) ? 6 : 0) +
    (profile.positiveAuthorIds.has(item.authorId) ? 4 : 0) +
    (normalizedTopics.some((topic) => profile.positiveTopics.has(topic)) ? 3 : 0);
  const negative =
    (profile.negativeItemIds.has(item.id) ? 9 : 0) +
    (profile.negativeAuthorIds.has(item.authorId) ? 6 : 0) +
    (normalizedTopics.some((topic) => profile.negativeTopics.has(topic)) ? 4 : 0);
  return round(
    clamp(
      positive - negative,
      FEED_POLICY.positive.explicitFeedbackMinimum,
      FEED_POLICY.positive.explicitFeedbackMaximum,
    ),
  );
}

function popularityScore(item: FeedItem): number {
  const weightedEngagement =
    item.engagement.likes + item.engagement.replies * 2 + item.engagement.reposts * 1.5;
  const bounded = Math.min(weightedEngagement, FEED_POLICY.positive.popularitySaturation);
  return round(
    (FEED_POLICY.positive.popularityMaximum * Math.log1p(bounded)) /
      Math.log1p(FEED_POLICY.positive.popularitySaturation),
  );
}

function explain(
  components: ScoreComponents,
  personalizationState: PersonalizationState,
): ExplanationReason[] {
  const reasons: ExplanationReason[] = [];
  if (components.declaredTopicInterest > 0) {
    reasons.push({
      code: 'declared-topic-interest',
      kind: 'boost',
      text: 'Matches one or more topics you explicitly declared as interests.',
    });
  }
  if (components.followRelationship > 0) {
    reasons.push({
      code: 'follow-relationship',
      kind: 'boost',
      text: 'You follow this author.',
    });
  }
  if (components.freshness > 0) {
    reasons.push({
      code: 'freshness',
      kind: 'boost',
      text: `Recent posts receive a transparent freshness boost with a ${String(FEED_POLICY.positive.freshnessHalfLifeHours)}-hour half-life.`,
    });
  }
  if (components.communityMembership > 0) {
    reasons.push({
      code: 'community-membership',
      kind: 'boost',
      text: 'This post is from a community you said you joined.',
    });
  }
  if (components.explicitFeedback > 0) {
    reasons.push({
      code: 'positive-feedback',
      kind: 'boost',
      text: 'It matches positive feedback you explicitly provided.',
    });
  } else if (components.explicitFeedback < 0) {
    reasons.push({
      code: 'negative-feedback',
      kind: 'penalty',
      text: 'It matches negative feedback you explicitly provided.',
    });
  }
  if (components.boundedPopularity > 0) {
    reasons.push({
      code: 'bounded-popularity',
      kind: 'boost',
      text: 'The supplied engagement summary adds a capped popularity boost.',
    });
  }
  if (components.authorRepetitionPenalty > 0) {
    reasons.push({
      code: 'author-repetition',
      kind: 'penalty',
      text: 'The score is lower to avoid repeating the same author too often.',
    });
  }
  if (components.topicRepetitionPenalty > 0) {
    reasons.push({
      code: 'topic-repetition',
      kind: 'penalty',
      text: 'The score is lower to diversify topics you have recently seen.',
    });
  }
  if (components.duplicateOrRepostPenalty > 0) {
    reasons.push({
      code: 'duplicate-or-repost',
      kind: 'penalty',
      text: 'Caller-supplied duplicate or repost-loop signals lowered this score.',
    });
  }
  if (components.suspectedSpamPenalty > 0) {
    reasons.push({
      code: 'suspected-spam',
      kind: 'penalty',
      text: 'A caller-supplied suspected-spam risk signal lowered this score.',
    });
  }
  if (components.rageBaitPenalty > 0) {
    reasons.push({
      code: 'rage-bait-risk',
      kind: 'penalty',
      text: 'A caller-supplied rage-bait risk signal lowered this score; this service did not infer it.',
    });
  }
  if (personalizationState === 'behavioral-opt-out') {
    reasons.push({
      code: 'behavioral-opt-out',
      kind: 'ordering',
      text: 'Behavioral personalization is off, so feedback and prior-exposure history did not affect this score.',
    });
  }
  if (personalizationState === 'reset' || personalizationState === 'empty') {
    reasons.push({
      code: 'chronological-fallback',
      kind: 'ordering',
      text:
        personalizationState === 'reset'
          ? 'Preferences were reset, so this request uses newest-first ordering.'
          : 'No ranking preferences are available, so this request uses newest-first ordering.',
    });
  }
  if (reasons.length === 0) {
    reasons.push({
      code: 'transparent-score',
      kind: 'ordering',
      text: `Ordered by the public ${FEED_POLICY_VERSION} scoring policy.`,
    });
  }
  return reasons;
}

export function normalizeForMatch(value: string): string {
  return value.normalize('NFKC').toLowerCase();
}

function compileScoringProfile(viewer: ViewerContext, asOf: string): ScoringProfile {
  const personalizationState = getPersonalizationState(viewer);
  const personalizationEnabled =
    personalizationState === 'active' || personalizationState === 'behavioral-opt-out';
  const behavioralEnabled = personalizationState === 'active';
  const priorAuthorCounts = new Map<string, number>();
  const priorTopicCounts = new Map<string, number>();
  const priorDuplicateCounts = new Map<string, number>();

  if (behavioralEnabled) {
    for (const exposure of viewer.recentExposure) {
      increment(priorAuthorCounts, exposure.authorId);
      for (const topic of unique(exposure.topics.map(normalizeForMatch))) {
        increment(priorTopicCounts, topic);
      }
      if (exposure.duplicateClusterId !== undefined) {
        increment(priorDuplicateCounts, exposure.duplicateClusterId);
      }
    }
  }

  return {
    personalizationState,
    personalizationEnabled,
    behavioralEnabled,
    asOfTime: Date.parse(asOf),
    interests: new Map(
      viewer.declaredTopicInterests.map((interest) => [
        normalizeForMatch(interest.topic),
        interest.weight,
      ]),
    ),
    followingAuthorIds: new Set(viewer.followingAuthorIds),
    communityIds: new Set(viewer.communityIds),
    positiveItemIds: new Set(viewer.feedback.positive.itemIds),
    positiveAuthorIds: new Set(viewer.feedback.positive.authorIds),
    positiveTopics: new Set(viewer.feedback.positive.topics.map(normalizeForMatch)),
    negativeItemIds: new Set(viewer.feedback.negative.itemIds),
    negativeAuthorIds: new Set(viewer.feedback.negative.authorIds),
    negativeTopics: new Set(viewer.feedback.negative.topics.map(normalizeForMatch)),
    priorAuthorCounts,
    priorTopicCounts,
    priorDuplicateCounts,
  };
}

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
}
