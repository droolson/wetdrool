import { describe, expect, it } from 'vitest';

import type { FeedCursorScope } from '../src/index.js';
import {
  decodeFeedCursor,
  encodeFeedCursor,
  MAX_FEED_CURSOR_LENGTH,
  MemoryProjectionStore,
  OPEN_INDEXER_FEED_RECIPE,
  openApiDocument,
} from '../src/index.js';
import {
  exerciseSameSlotProfileSequencing,
  expectAdversarialFeedProjection,
  projectionSecurityNetworkId,
  seedAdversarialFeedProjection,
} from './projection-security-fixtures.js';

describe('memory projection ordering and feed disclosure policy', () => {
  it('orders same-slot profiles by exact identity sequence and event position', async () => {
    const projection = new MemoryProjectionStore();
    try {
      await exerciseSameSlotProfileSequencing(projection, 30);
    } finally {
      await projection.close();
    }
  });

  it('uses finalized time, composite pagination, and public-only feed visibility', async () => {
    const projection = new MemoryProjectionStore();
    const fixture = await seedAdversarialFeedProjection(projection, 60);
    try {
      await expectAdversarialFeedProjection(projection, fixture);
    } finally {
      await projection.clearProjection(fixture.networkId);
      await projection.close();
    }
  });
});

describe('opaque composite feed cursors', () => {
  const post = {
    createdAt: '2026-07-28T12:00:02.000Z',
    objectId: `wokesocialobj:v1:post:u${'A'.repeat(43)}`,
  };
  const networkId = projectionSecurityNetworkId(80);
  const otherNetworkId = projectionSecurityNetworkId(81);
  const firstViewerIdentityId = `wokesocialid:v1:${networkId}:11111111111111111111111111111111`;
  const secondViewerIdentityId = `wokesocialid:v1:${networkId}:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4yJAaDJwM`;
  const chronologicalScope = {
    networkId,
    mode: 'chronological',
    viewerIdentityId: null,
  } satisfies FeedCursorScope;
  const followingScope = {
    networkId,
    mode: 'following',
    viewerIdentityId: firstViewerIdentityId,
  } satisfies FeedCursorScope;
  it('round-trips the finalized-time and object-ID tie-break in one live recipe scope', () => {
    const cursor = encodeFeedCursor(post, chronologicalScope);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(encodeFeedCursor(post, chronologicalScope)).toBe(cursor);
    expect(decodeFeedCursor(cursor, chronologicalScope)).toEqual(post);

    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    expect(payload).toMatchObject({
      v: 3,
      recipe: OPEN_INDEXER_FEED_RECIPE,
      scope: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u),
      ...post,
    });
    expect(JSON.stringify(payload)).not.toContain(networkId);
    expect(payload).not.toHaveProperty('mode');
    expect(payload).not.toHaveProperty('viewerIdentityId');
  });

  it('rejects cursors replayed across networks, modes, or following viewers', () => {
    const chronologicalCursor = encodeFeedCursor(post, chronologicalScope);
    const followingCursor = encodeFeedCursor(post, followingScope);
    const mismatchedScopes: readonly FeedCursorScope[] = [
      {
        networkId: otherNetworkId,
        mode: 'chronological',
        viewerIdentityId: null,
      },
      followingScope,
    ];
    for (const scope of mismatchedScopes) {
      expect(() => decodeFeedCursor(chronologicalCursor, scope)).toThrow('Feed cursor is invalid');
    }
    expect(() =>
      decodeFeedCursor(followingCursor, {
        networkId,
        mode: 'following',
        viewerIdentityId: secondViewerIdentityId,
      }),
    ).toThrow('Feed cursor is invalid');
  });

  it('rejects legacy, malformed, noncanonical, oversized, and shape-expanded tokens', () => {
    const encoded = encodeFeedCursor(post, chronologicalScope);
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Record<
      string,
      unknown
    >;
    const legacyV1 = Buffer.from(JSON.stringify({ v: 1, ...post }), 'utf8').toString('base64url');
    const legacyV2 = Buffer.from(
      JSON.stringify({ v: 2, scope: payload.scope, ...post }),
      'utf8',
    ).toString('base64url');
    const wrongRecipe = Buffer.from(
      JSON.stringify({ ...payload, recipe: 'wokenet-open-indexer-feed-v0' }),
      'utf8',
    ).toString('base64url');
    const expanded = Buffer.from(JSON.stringify({ ...payload, extra: true }), 'utf8').toString(
      'base64url',
    );
    for (const cursor of [
      'not+base64url',
      `${encoded}=`,
      'A'.repeat(MAX_FEED_CURSOR_LENGTH + 1),
      legacyV1,
      legacyV2,
      wrongRecipe,
      expanded,
    ]) {
      expect(() => decodeFeedCursor(cursor, chronologicalScope)).toThrow('Feed cursor is invalid');
    }
  });

  it('documents the cursor as opaque and bounded', () => {
    const document = JSON.stringify(openApiDocument);
    expect(document).toContain('Opaque bounded live-keyset cursor');
    expect(document).toContain('"maxLength":512');
    expect(document).not.toContain(
      '"name":"before","in":"query","schema":{"type":"string","format":"date-time"}',
    );
  });
});
