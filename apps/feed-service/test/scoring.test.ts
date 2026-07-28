import { describe, expect, it } from 'vitest';

import {
  addToRankingContext,
  emptyRankingContext,
  FEED_POLICY,
  rankFeed,
  scoreItem,
} from '../src/index.js';
import { AS_OF, feedItem, rankRequest, viewer } from './fixtures.js';

describe('deterministic feed scoring', () => {
  it('produces byte-equivalent results for the same bounded inputs', () => {
    const request = rankRequest({
      items: [
        feedItem('a', { topics: ['technology'], engagement: { likes: 4 } }),
        feedItem('b', {
          authorId: 'followed',
          topics: ['design'],
          publishedAt: '2026-07-28T17:30:00.000Z',
        }),
      ],
      viewer: viewer({
        declaredTopicInterests: [{ topic: 'technology', weight: 0.8 }],
        followingAuthorIds: ['followed'],
      }),
    });

    expect(JSON.stringify(rankFeed(request))).toBe(JSON.stringify(rankFeed(request)));
  });

  it('does not use caller item order to break recommendation ties', () => {
    const alpha = feedItem('alpha', { authorId: 'author-a' });
    const beta = feedItem('beta', { authorId: 'author-b' });
    const common = {
      limit: 50,
      viewer: viewer({ followingAuthorIds: ['unrelated'] }),
    };

    const forward = rankFeed(rankRequest({ ...common, items: [alpha, beta] }));
    const reverse = rankFeed(rankRequest({ ...common, items: [beta, alpha] }));

    expect(forward.items.map((entry) => entry.item.id)).toEqual(['alpha', 'beta']);
    expect(reverse.items.map((entry) => entry.item.id)).toEqual(['alpha', 'beta']);
    expect(forward.items.map((entry) => entry.score)).toEqual(
      reverse.items.map((entry) => entry.score),
    );
  });

  it('uses publication time then item ID for chronological ordering', () => {
    const result = rankFeed(
      rankRequest({
        mode: 'chronological',
        items: [
          feedItem('c', { publishedAt: '2026-07-28T16:00:00.000Z' }),
          feedItem('b', { publishedAt: '2026-07-28T17:00:00.000Z' }),
          feedItem('a', { publishedAt: '2026-07-28T17:00:00.000Z' }),
        ],
      }),
    );

    expect(result.items.map((entry) => entry.item.id)).toEqual(['a', 'b', 'c']);
    expect(result.items[0]?.reasons[0]).toMatchObject({
      code: 'chronological-order',
      kind: 'ordering',
    });
  });

  it('makes every boost monotonic and bounded across property-style samples', () => {
    const subject = feedItem('subject', {
      authorId: 'followed',
      topics: ['technology'],
      communityId: 'community-1',
    });
    let previousTopicScore = -1;
    let previousTotal = -Infinity;
    for (let sample = 0; sample <= 20; sample += 1) {
      const weight = sample / 20;
      const scored = scoreItem(
        subject,
        viewer({
          declaredTopicInterests: [{ topic: 'technology', weight }],
          followingAuthorIds: ['followed'],
          communityIds: ['community-1'],
        }),
        AS_OF,
      );
      expect(scored.score.components.declaredTopicInterest).toBeGreaterThanOrEqual(
        previousTopicScore,
      );
      expect(scored.score.total).toBeGreaterThanOrEqual(previousTotal);
      expect(scored.score.components.declaredTopicInterest).toBeLessThanOrEqual(
        FEED_POLICY.positive.declaredTopicInterestMaximum,
      );
      previousTopicScore = scored.score.components.declaredTopicInterest;
      previousTotal = scored.score.total;
    }
  });

  it('uses an explicit 36-hour half-life for freshness', () => {
    const recent = scoreItem(feedItem('recent', { publishedAt: AS_OF }), viewer(), AS_OF).score
      .components.freshness;
    const oneHalfLife = scoreItem(
      feedItem('older', { publishedAt: '2026-07-27T06:00:00.000Z' }),
      viewer(),
      AS_OF,
    ).score.components.freshness;

    expect(recent).toBe(FEED_POLICY.positive.freshnessMaximum);
    expect(oneHalfLife).toBe(FEED_POLICY.positive.freshnessMaximum / 2);
  });

  it('saturates popularity and never exceeds its public cap', () => {
    let previous = -1;
    for (const likes of [0, 1, 10, 100, 1_000, 10_000, 1_000_000_000]) {
      const score = scoreItem(
        feedItem(`likes-${String(likes)}`, { engagement: { likes } }),
        viewer(),
        AS_OF,
      ).score.components.boundedPopularity;
      expect(score).toBeGreaterThanOrEqual(previous);
      expect(score).toBeLessThanOrEqual(FEED_POLICY.positive.popularityMaximum);
      previous = score;
    }
    expect(previous).toBe(FEED_POLICY.positive.popularityMaximum);
  });

  it('applies explicit positive and negative feedback with fixed bounds', () => {
    const subject = feedItem('feedback', {
      authorId: 'author-feedback',
      topics: ['technology'],
    });
    const positive = scoreItem(
      subject,
      viewer({
        feedback: {
          positive: {
            itemIds: [subject.id],
            authorIds: [subject.authorId],
            topics: ['technology'],
          },
          negative: { itemIds: [], authorIds: [], topics: [] },
        },
      }),
      AS_OF,
    );
    const negative = scoreItem(
      subject,
      viewer({
        feedback: {
          positive: { itemIds: [], authorIds: [], topics: [] },
          negative: {
            itemIds: [subject.id],
            authorIds: [subject.authorId],
            topics: ['technology'],
          },
        },
      }),
      AS_OF,
    );

    expect(positive.score.components.explicitFeedback).toBe(
      FEED_POLICY.positive.explicitFeedbackMaximum,
    );
    expect(negative.score.components.explicitFeedback).toBe(
      FEED_POLICY.positive.explicitFeedbackMinimum,
    );
    expect(positive.reasons).toContainEqual(expect.objectContaining({ code: 'positive-feedback' }));
    expect(negative.reasons).toContainEqual(expect.objectContaining({ code: 'negative-feedback' }));
  });

  it('turns feedback scoring off when behavioral personalization is opted out', () => {
    const subject = feedItem('opt-out', { topics: ['technology'] });
    const context = viewer({
      behavioralPersonalization: false,
      declaredTopicInterests: [{ topic: 'technology', weight: 1 }],
      feedback: {
        positive: { itemIds: [subject.id], authorIds: [], topics: [] },
        negative: { itemIds: [], authorIds: [], topics: [] },
      },
      recentExposure: [
        {
          authorId: subject.authorId,
          topics: subject.topics,
        },
      ],
    });
    const result = rankFeed(rankRequest({ viewer: context, items: [subject] }));

    expect(result.engine.personalizationState).toBe('behavioral-opt-out');
    expect(result.engine.effectiveMode).toBe('recommended');
    expect(result.items[0]?.score.components.explicitFeedback).toBe(0);
    expect(result.items[0]?.score.components.declaredTopicInterest).toBeGreaterThan(0);
    expect(result.items[0]?.score.components.authorRepetitionPenalty).toBe(0);
    expect(result.items[0]?.score.components.topicRepetitionPenalty).toBe(0);
    expect(result.items[0]?.reasons).toContainEqual(
      expect.objectContaining({ code: 'behavioral-opt-out' }),
    );
  });

  it('falls back to chronological ordering after a reset or with empty preferences', () => {
    const items = [
      feedItem('older-followed', {
        authorId: 'followed',
        publishedAt: '2026-07-28T12:00:00.000Z',
      }),
      feedItem('newer', { publishedAt: '2026-07-28T17:00:00.000Z' }),
    ];
    const reset = rankFeed(
      rankRequest({
        items,
        viewer: viewer({ resetPreferences: true, followingAuthorIds: ['followed'] }),
      }),
    );
    const empty = rankFeed(rankRequest({ items, viewer: viewer() }));

    expect(reset.engine).toMatchObject({
      personalizationState: 'reset',
      effectiveMode: 'chronological',
    });
    expect(empty.engine).toMatchObject({
      personalizationState: 'empty',
      effectiveMode: 'chronological',
    });
    expect(reset.items.map((entry) => entry.item.id)).toEqual(['newer', 'older-followed']);
    expect(empty.items.map((entry) => entry.item.id)).toEqual(['newer', 'older-followed']);
  });

  it('monotonically applies supplied spam and rage-bait risk without inference', () => {
    let previousSpam = -1;
    let previousRage = -1;
    for (let sample = 0; sample <= 20; sample += 1) {
      const risk = sample / 20;
      const scored = scoreItem(
        feedItem(`risk-${String(sample)}`, {
          signals: { suspectedSpamRisk: risk, rageBaitRisk: risk },
        }),
        viewer(),
        AS_OF,
      );
      expect(scored.score.components.suspectedSpamPenalty).toBeGreaterThanOrEqual(previousSpam);
      expect(scored.score.components.rageBaitPenalty).toBeGreaterThanOrEqual(previousRage);
      expect(scored.score.components.suspectedSpamPenalty).toBeLessThanOrEqual(
        FEED_POLICY.penalties.suspectedSpamMaximum,
      );
      expect(scored.score.components.rageBaitPenalty).toBeLessThanOrEqual(
        FEED_POLICY.penalties.rageBaitMaximum,
      );
      expect(scored.score.total).toBeGreaterThanOrEqual(FEED_POLICY.total.minimum);
      expect(scored.score.total).toBeLessThanOrEqual(FEED_POLICY.total.maximum);
      previousSpam = scored.score.components.suspectedSpamPenalty;
      previousRage = scored.score.components.rageBaitPenalty;
    }

    const explanation = scoreItem(
      feedItem('rage-explanation', { signals: { rageBaitRisk: 1 } }),
      viewer(),
      AS_OF,
    ).reasons.find((reason) => reason.code === 'rage-bait-risk');
    expect(explanation?.text).toContain('caller-supplied');
    expect(explanation?.text).toContain('did not infer');
  });

  it('penalizes repeated authors, topics, and duplicate clusters in the slate', () => {
    const first = feedItem('first', {
      authorId: 'same-author',
      topics: ['same-topic'],
      duplicateClusterId: 'same-cluster',
    });
    const second = feedItem('second', {
      authorId: 'same-author',
      topics: ['same-topic'],
      duplicateClusterId: 'same-cluster',
    });
    const before = scoreItem(second, viewer(), AS_OF, emptyRankingContext());
    const after = scoreItem(
      second,
      viewer(),
      AS_OF,
      addToRankingContext(emptyRankingContext(), first),
    );

    expect(after.score.components.authorRepetitionPenalty).toBeGreaterThan(
      before.score.components.authorRepetitionPenalty,
    );
    expect(after.score.components.topicRepetitionPenalty).toBeGreaterThan(
      before.score.components.topicRepetitionPenalty,
    );
    expect(after.score.components.duplicateOrRepostPenalty).toBeGreaterThan(
      before.score.components.duplicateOrRepostPenalty,
    );
    expect(after.score.total).toBeLessThan(before.score.total);
  });
});

describe('feed eligibility and pagination', () => {
  it('enforces collection, page, and normalized-topic uniqueness caps', () => {
    const base = rankRequest({ items: [] });
    const duplicatedTopics = feedItem('duplicate-topics', {
      topics: ['Technology', 'technology'],
    });
    const duplicateInterests = viewer({
      declaredTopicInterests: [
        { topic: 'Technology', weight: 1 },
        { topic: 'technology', weight: 0.5 },
      ],
    });

    expect(() => rankFeed({ ...base, limit: 51 })).toThrow();
    expect(() =>
      rankFeed({
        ...base,
        items: Array.from({ length: 501 }, (_, index) => feedItem(`capped-${String(index)}`)),
      }),
    ).toThrow();
    expect(() => rankFeed({ ...base, items: [duplicatedTopics] })).toThrow(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['items', 0, 'topics', 1] }),
        ]),
      }),
    );
    expect(() => rankFeed({ ...base, viewer: duplicateInterests })).toThrow(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ['viewer', 'declaredTopicInterests', 1, 'topic'],
          }),
        ]),
      }),
    );
  });

  it('rejects future publication and projection issue timestamps', () => {
    const base = rankRequest({ items: [] });
    const futurePublication = feedItem('future-publication', {
      publishedAt: '2026-07-28T18:00:00.001Z',
    });
    const futureProjectionBase = feedItem('future-projection');
    const futureProjection = {
      ...futureProjectionBase,
      signedProjection: {
        ...futureProjectionBase.signedProjection,
        issuedAt: '2026-07-28T18:00:00.001Z',
      },
    };

    expect(() => rankFeed({ ...base, items: [futurePublication] })).toThrow(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({ path: ['items', 0, 'publishedAt'] }),
        ]),
      }),
    );
    expect(() => rankFeed({ ...base, items: [futureProjection] })).toThrow(
      expect.objectContaining({
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: ['items', 0, 'signedProjection', 'issuedAt'],
          }),
        ]),
      }),
    );
  });

  it('filters blocks, mutes, keywords, and sensitive content before ranking', () => {
    const result = rankFeed(
      rankRequest({
        viewer: viewer({
          blockedAuthorIds: ['blocked'],
          mutedAuthorIds: ['muted'],
          mutedKeywords: ['spoiler'],
          sensitiveContentThreshold: 0.4,
        }),
        items: [
          feedItem('allowed'),
          feedItem('blocked', { authorId: 'blocked' }),
          feedItem('muted', { authorId: 'muted' }),
          feedItem('keyword', { excerpt: 'Contains a SPOILER in public text.' }),
          feedItem('sensitive', { signals: { sensitiveContentRisk: 0.41 } }),
          feedItem('threshold-inclusive', { signals: { sensitiveContentRisk: 0.4 } }),
        ],
      }),
    );

    expect(result.items.map((entry) => entry.item.id).sort()).toEqual([
      'allowed',
      'threshold-inclusive',
    ]);
    expect(result.page.filtered).toEqual({
      blockedAuthor: 1,
      mutedAuthor: 1,
      mutedKeyword: 1,
      sensitiveContent: 1,
      scopeMismatch: 0,
    });
  });

  it('provides stable, non-overlapping cursor pages and rejects changed inputs', () => {
    const base = rankRequest({
      mode: 'chronological',
      limit: 2,
      items: Array.from({ length: 5 }, (_, index) =>
        feedItem(`item-${String(index)}`, {
          publishedAt: `2026-07-28T1${String(index)}:00:00.000Z`,
        }),
      ),
    });
    const first = rankFeed(base);
    const second = rankFeed({ ...base, cursor: first.page.nextCursor });
    const third = rankFeed({ ...base, cursor: second.page.nextCursor });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(third.items).toHaveLength(1);
    expect(third.page.nextCursor).toBeNull();
    const IDs = [...first.items, ...second.items, ...third.items].map((entry) => entry.item.id);
    expect(new Set(IDs).size).toBe(5);
    expect(() =>
      rankFeed({
        ...base,
        cursor: first.page.nextCursor,
        viewer: viewer({ blockedAuthorIds: ['author-item-0'] }),
      }),
    ).toThrow(/different ranking request/u);
    expect(() => rankFeed({ ...base, cursor: 'not-a-cursor' })).toThrow(/valid base64url JSON/u);
  });

  it('labels all results non-canonical and unverified', () => {
    const result = rankFeed(rankRequest({ items: [feedItem('one')] }));

    expect(result.canonical).toBe(false);
    expect(result.assurance).toEqual(
      expect.objectContaining({
        projectionSignatures: 'not-verified',
        contentAuthenticity: 'not-verified',
      }),
    );
    expect(result.assurance.contentAuthenticity).toBe('not-verified');
    expect(result.items[0]?.assurance).toEqual({
      signedProjection: 'proxied-not-verified',
      contentAuthenticity: 'not-verified',
    });
    expect(result.items[0]?.item.signedProjection.signature).toBe('a'.repeat(88));
    expect(result.items[0]?.reasons.length).toBeGreaterThan(0);
  });
});
