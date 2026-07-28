import { describe, expect, it } from 'vitest';

import {
  FEED_POLICY,
  FEED_PROVIDER_PROTOCOL,
  feedProviderDescriptor,
  rankFeed,
} from '../src/index.js';
import { AS_OF, feedItem, rankRequest, viewer } from './fixtures.js';

const oneHourTrend = (
  overrides: Partial<NonNullable<ReturnType<typeof feedItem>['trend']>> = {},
) => ({
  windowStartedAt: '2026-07-28T17:00:00.000Z',
  observedAt: AS_OF,
  uniqueEngagers: 10,
  reactions: 8,
  replies: 2,
  reposts: 1,
  ...overrides,
});

describe('feed source modes', () => {
  it('selects following, community, and media candidates before local safety filtering', () => {
    const items = [
      feedItem('followed-new', {
        authorId: 'followed',
        publishedAt: '2026-07-28T17:30:00.000Z',
      }),
      feedItem('followed-old', {
        authorId: 'followed',
        publishedAt: '2026-07-28T16:30:00.000Z',
      }),
      feedItem('other', { authorId: 'other' }),
      feedItem('community', { communityId: 'community-1' }),
      feedItem('other-community', { communityId: 'community-2' }),
      feedItem('media', { mediaCount: 2 }),
    ];

    const following = rankFeed(
      rankRequest({
        mode: 'following',
        viewer: viewer({ followingAuthorIds: ['followed'] }),
        items,
      }),
    );
    expect(following.items.map((entry) => entry.item.id)).toEqual(['followed-new', 'followed-old']);
    expect(following.page.filtered.scopeMismatch).toBe(4);
    expect(following.items[0]?.reasons[0]?.code).toBe('following-chronological-order');

    const community = rankFeed(
      rankRequest({
        mode: 'community',
        modeContext: { communityId: 'community-1' },
        items,
      }),
    );
    expect(community.items.map((entry) => entry.item.id)).toEqual(['community']);
    expect(community.page.filtered.scopeMismatch).toBe(5);

    const media = rankFeed(rankRequest({ mode: 'media', items }));
    expect(media.items.map((entry) => entry.item.id)).toEqual(['media']);
    expect(media.page.filtered.scopeMismatch).toBe(5);
    expect(media.engine.behavioralPersonalizationApplied).toBe(false);
  });

  it('applies a transparent bounded trending window without lifetime-popularity leakage', () => {
    const highVelocity = feedItem('high-velocity', {
      engagement: { likes: 0, replies: 0, reposts: 0 },
      trend: oneHourTrend({
        uniqueEngagers: 100,
        reactions: 80,
        replies: 15,
        reposts: 5,
      }),
    });
    const lifetimePopular = feedItem('lifetime-popular', {
      engagement: { likes: 1_000_000, replies: 100_000, reposts: 100_000 },
      trend: oneHourTrend({
        uniqueEngagers: 1,
        reactions: 1,
        replies: 0,
        reposts: 0,
      }),
    });
    const result = rankFeed(
      rankRequest({ mode: 'trending', items: [lifetimePopular, highVelocity] }),
    );

    expect(result.items.map((entry) => entry.item.id)).toEqual([
      'high-velocity',
      'lifetime-popular',
    ]);
    expect(result.items[0]?.score.components.trendVelocity).toBeGreaterThan(
      result.items[1]?.score.components.trendVelocity ?? 0,
    );
    expect(result.items[0]?.score.components.trendVelocity).toBeLessThanOrEqual(
      FEED_POLICY.positive.trendVelocityMaximum,
    );
    expect(result.items.every((entry) => entry.score.components.boundedPopularity === 0)).toBe(
      true,
    );
    expect(result.items[0]?.reasons[0]).toMatchObject({
      code: 'bounded-trend-velocity',
    });
    expect(result.provider.algorithmId).toBe('bounded-window-trending');
  });

  it('rejects missing, future, unbounded, and internally inconsistent trend observations', () => {
    const base = rankRequest({ mode: 'chronological', items: [feedItem('base')] });
    expect(() => rankFeed({ ...base, mode: 'trending' })).toThrow(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.objectContaining({ path: ['items', 0, 'trend'] })]),
      }),
    );
    expect(() =>
      rankFeed({
        ...base,
        mode: 'trending',
        items: [
          feedItem('bad-window', {
            trend: oneHourTrend({
              windowStartedAt: '2026-07-28T17:50:00.000Z',
              uniqueEngagers: 2,
              reactions: 1,
            }),
          }),
        ],
      }),
    ).toThrow();
    expect(() =>
      rankFeed({
        ...base,
        mode: 'trending',
        items: [
          feedItem('future-trend', {
            trend: oneHourTrend({
              observedAt: '2026-07-28T18:00:00.001Z',
            }),
          }),
        ],
      }),
    ).toThrow();
    expect(() =>
      rankFeed({
        ...base,
        mode: 'trending',
        items: [
          feedItem('fake-unique', {
            trend: oneHourTrend({
              uniqueEngagers: 20,
              reactions: 1,
              replies: 0,
              reposts: 0,
            }),
          }),
        ],
      }),
    ).toThrow();
  });
});

describe('replaceable third-party provider contract', () => {
  it('reconciles external order with local safety controls and preserves provider provenance', () => {
    const items = [
      feedItem('first', { authorId: 'blocked' }),
      feedItem('second'),
      feedItem('third'),
    ];
    const result = rankFeed(
      rankRequest({
        mode: 'third-party',
        modeContext: {
          thirdParty: {
            providerId: 'org.example.community-feed',
            endpoint: 'https://feeds.example/rank',
            algorithmId: 'community-context',
            algorithmVersion: '2.1.0',
            explanation: 'Selected by the community policy you chose.',
            orderedItemIds: ['third', 'first', 'second'],
          },
        },
        viewer: viewer({ blockedAuthorIds: ['blocked'] }),
        appliedPolicies: {
          tombstonesApplied: true,
          moderationProviderIds: ['org.example.labels'],
        },
        items,
      }),
    );

    expect(result.items.map((entry) => entry.item.id)).toEqual(['third', 'second']);
    expect(result.page.filtered.blockedAuthor).toBe(1);
    expect(result.provider).toMatchObject({
      providerId: 'org.example.community-feed',
      endpoint: 'https://feeds.example/rank',
      algorithmId: 'community-context',
      algorithmVersion: '2.1.0',
      externalOrderVerified: false,
      filtering: {
        localSafetyControlsApplied: true,
        upstreamTombstonesApplied: true,
        moderationProviderIds: ['org.example.labels'],
        clientMustReapplySafetyControls: true,
      },
    });
    expect(result.items[0]?.reasons[0]?.text).toContain('not verified');
  });

  it('rejects incomplete/duplicate orders, unsafe endpoints, and mode-context confusion', () => {
    const items = [feedItem('one'), feedItem('two')];
    const base = rankRequest({ items });
    const provider = {
      providerId: 'org.example.feed',
      endpoint: 'https://feeds.example/rank',
      algorithmId: 'test-order',
      algorithmVersion: '1.0.0',
      explanation: 'Test order.',
      orderedItemIds: ['one', 'two'],
    };

    expect(() =>
      rankFeed({
        ...base,
        mode: 'third-party',
        modeContext: { thirdParty: { ...provider, orderedItemIds: ['one', 'one'] } },
      }),
    ).toThrow();
    expect(() =>
      rankFeed({
        ...base,
        mode: 'third-party',
        modeContext: {
          thirdParty: { ...provider, endpoint: 'http://feeds.example/rank' },
        },
      }),
    ).toThrow();
    expect(() =>
      rankFeed({
        ...base,
        mode: 'third-party',
        modeContext: {
          thirdParty: { ...provider, endpoint: 'https://feeds.example/rank?token=secret' },
        },
      }),
    ).toThrow();
    expect(() =>
      rankFeed({
        ...base,
        modeContext: { communityId: 'community-1' },
      }),
    ).toThrow();
  });

  it('publishes a versioned descriptor and deterministic source/checkpoint validity metadata', () => {
    expect(feedProviderDescriptor).toMatchObject({
      protocol: FEED_PROVIDER_PROTOCOL,
      protocolVersion: 1,
      canonical: false,
      assurance: {
        clientMustReapplySafetyControls: true,
        acceptsSensitiveTraitInputs: false,
      },
    });
    const result = rankFeed(
      rankRequest({
        mode: 'chronological',
        appliedPolicies: {
          tombstonesApplied: false,
          moderationProviderIds: [],
        },
        items: [feedItem('one'), feedItem('two')],
      }),
    );
    expect(result.provider.sourceCheckpoints).toEqual([
      { indexer: 'test-open-indexer', checkpoint: 'finalized-slot-1234' },
    ]);
    expect(result.provider.responseCreatedAt).toBe(AS_OF);
    expect(result.provider.expiresAt).toBe('2026-07-28T18:05:00.000Z');
    expect(result.provider.filtering.upstreamTombstonesApplied).toBe(false);
  });
});
