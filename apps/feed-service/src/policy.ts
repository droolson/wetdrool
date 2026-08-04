export const FEED_POLICY_VERSION = 'wetdrool-feed-v1';

export const FEED_POLICY = {
  positive: {
    declaredTopicInterestMaximum: 18,
    followRelationship: 22,
    freshnessMaximum: 24,
    freshnessHalfLifeHours: 36,
    communityMembership: 8,
    explicitFeedbackMinimum: -16,
    explicitFeedbackMaximum: 12,
    popularityMaximum: 10,
    popularitySaturation: 10_000,
    trendVelocityMaximum: 30,
    trendVelocitySaturationPerHour: 1_000,
  },
  penalties: {
    authorRepetitionMaximum: 10,
    topicRepetitionMaximum: 8,
    duplicateOrRepostMaximum: 18,
    suspectedSpamMaximum: 20,
    rageBaitMaximum: 12,
  },
  total: {
    minimum: -100,
    maximum: 100,
  },
  request: {
    maximumItems: 500,
    maximumPageSize: 50,
    maximumBodyBytes: 524_288,
  },
} as const;

export interface ScoreComponents {
  readonly declaredTopicInterest: number;
  readonly followRelationship: number;
  readonly freshness: number;
  readonly communityMembership: number;
  readonly explicitFeedback: number;
  readonly boundedPopularity: number;
  readonly trendVelocity: number;
  readonly authorRepetitionPenalty: number;
  readonly topicRepetitionPenalty: number;
  readonly duplicateOrRepostPenalty: number;
  readonly suspectedSpamPenalty: number;
  readonly rageBaitPenalty: number;
}

export interface ExplanationReason {
  readonly code: string;
  readonly kind: 'boost' | 'penalty' | 'ordering';
  readonly text: string;
}
