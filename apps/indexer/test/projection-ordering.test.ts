import { describe, expect, it } from 'vitest';

import {
  decodeFeedCursor,
  encodeFeedCursor,
  MAX_FEED_CURSOR_LENGTH,
  MemoryProjectionStore,
  openApiDocument,
} from '../src/index.js';
import {
  exerciseSameSlotProfileSequencing,
  expectAdversarialFeedProjection,
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

  it('round-trips the finalized-time and object-ID tie-break', () => {
    const cursor = encodeFeedCursor(post);
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(decodeFeedCursor(cursor)).toEqual(post);
  });

  it('rejects malformed, noncanonical, oversized, and shape-expanded tokens', () => {
    const expanded = Buffer.from(JSON.stringify({ v: 1, ...post, extra: true })).toString(
      'base64url',
    );
    for (const cursor of [
      'not+base64url',
      `${encodeFeedCursor(post)}=`,
      'A'.repeat(MAX_FEED_CURSOR_LENGTH + 1),
      expanded,
    ]) {
      expect(() => decodeFeedCursor(cursor)).toThrow('Feed cursor is invalid');
    }
  });

  it('documents the cursor as opaque and bounded', () => {
    const document = JSON.stringify(openApiDocument);
    expect(document).toContain('Opaque bounded cursor');
    expect(document).toContain('"maxLength":512');
    expect(document).not.toContain(
      '"name":"before","in":"query","schema":{"type":"string","format":"date-time"}',
    );
  });
});
