import { describe, expect, it, vi } from 'vitest';

import { IndexerPayloadError } from '../src/contract.js';
import {
  createIndexerClient,
  fetchChronologicalFeed,
  fetchFollowingFeed,
  parseProjectedFeedResponse,
  validateFeedCursor,
  validateFollowingViewer,
  type IndexerFetch,
} from '../src/projected-feed.js';
import { MAX_INDEXER_JSON_BYTES, readIndexerJson } from '../src/transport.js';

const NETWORK_ID =
  'wokenet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const IDENTITY_ID =
  'wokesocialid:v1:wokenet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD:8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE';
const DIGEST_A = `u${'A'.repeat(43)}`;
const DIGEST_B = `u${'B'.repeat(43)}`;
const CID = 'bafkreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm';
const TRANSACTION_SIGNATURE = '1'.repeat(64);

function projectedEntry(
  objectDigest = DIGEST_A,
  createdAt = '2026-07-28T12:00:00.000Z',
  reason: Record<string, unknown> = { kind: 'chronological' },
) {
  return {
    author: { active: true, identityId: IDENTITY_ID },
    post: {
      anchoredSlot: '42',
      authorIdentityId: IDENTITY_ID,
      cid: CID,
      content: {
        body: 'Portable identity, ordinary language.',
        format: 'plain',
        language: 'en',
        media: [
          {
            altText: 'A purple sunrise over the water.',
            bytes: 512,
            cid: CID,
            digest: DIGEST_A,
            mediaType: 'image/webp',
          },
        ],
        quotePolicy: 'allowed',
        replyPolicy: 'anyone',
        visibility: { kind: 'public' },
      },
      createdAt,
      networkId: NETWORK_ID,
      objectId: `wokesocialobj:v1:post:${objectDigest}`,
      payloadHash: DIGEST_A,
      signingKeyId: `${IDENTITY_ID}#root/${'1'.repeat(32)}`,
      transactionSignature: TRANSACTION_SIGNATURE,
      verified: true,
    },
    profile: {
      content: { displayName: 'Ari' },
      identityId: IDENTITY_ID,
    },
    reason,
  };
}

function feedResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    canonical: false,
    entries: [projectedEntry()],
    meta: {
      checkpointSlot: 42,
      indexedAt: '2026-07-28T12:01:00.000Z',
      source: 'WokeSocial open indexer',
    },
    mode: 'chronological',
    network: NETWORK_ID,
    nextCursor: null,
    projection: 'wokenet-open-indexer',
    recipe: 'wokenet-open-indexer-feed-v1',
    viewer: null,
    ...overrides,
  };
}

describe('strict projected-feed parsing', () => {
  it('maps canonical proof, recipe, media, and terminal cursor data', () => {
    const parsed = parseProjectedFeedResponse(feedResponse(), { mode: 'chronological' });

    expect(parsed).toMatchObject({
      mode: 'chronological',
      network: NETWORK_ID,
      nextCursor: null,
      recipe: 'wokenet-open-indexer-feed-v1',
    });
    expect(parsed.entries[0]).toMatchObject({
      post: {
        media: [{ altText: 'A purple sunrise over the water.', mediaType: 'image/webp' }],
        verification: {
          anchor: { finality: 'finalized', slot: 42 },
          state: 'verified',
        },
      },
      reason: { kind: 'chronological' },
    });
  });

  it.each([
    ['an unknown recipe', () => feedResponse({ recipe: 'provider-invented-feed-v1' })],
    [
      'a tombstoned post',
      () => {
        const entry = projectedEntry();
        return feedResponse({
          entries: [{ ...entry, post: { ...entry.post, tombstonedAt: '2026-07-28T12:02:00Z' } }],
        });
      },
    ],
    [
      'unsafe media',
      () => {
        const entry = projectedEntry();
        return feedResponse({
          entries: [
            {
              ...entry,
              post: {
                ...entry.post,
                content: {
                  ...entry.post.content,
                  media: Array.from({ length: 100 }, () => entry.post.content.media[0]),
                },
              },
            },
          ],
        });
      },
    ],
    [
      'a cursor after an empty page',
      () => feedResponse({ entries: [], nextCursor: 'opaque_cursor' }),
    ],
  ])('rejects %s', (_label, value) => {
    expect(() => parseProjectedFeedResponse(value(), { mode: 'chronological' })).toThrow(
      IndexerPayloadError,
    );
  });

  it('accepts only an exactly canonical projected author handle', () => {
    const withoutHandle = parseProjectedFeedResponse(feedResponse(), { mode: 'chronological' });
    expect(withoutHandle.entries[0]?.post.author.handle).toBeNull();

    const explicitNull = parseProjectedFeedResponse(
      feedResponse({ entries: [{ ...projectedEntry(), authorHandle: null }] }),
      { mode: 'chronological' },
    );
    expect(explicitNull.entries[0]?.post.author.handle).toBeNull();

    const claimed = parseProjectedFeedResponse(
      feedResponse({ entries: [{ ...projectedEntry(), authorHandle: 'anon_7n044tsjxrfm5e23' }] }),
      { mode: 'chronological' },
    );
    expect(claimed.entries[0]?.post.author.handle).toBe('anon_7n044tsjxrfm5e23');

    for (const authorHandle of [5, 'River', 'a__b', 'ab', 'anon_7n044tsjxrfm5e23.woke']) {
      expect(() =>
        parseProjectedFeedResponse(
          feedResponse({ entries: [{ ...projectedEntry(), authorHandle }] }),
          { mode: 'chronological' },
        ),
      ).toThrowError(IndexerPayloadError);
    }
  });

  it('enforces descending finalized-time and object-ID order without duplicates', () => {
    expect(() =>
      parseProjectedFeedResponse(
        feedResponse({
          entries: [
            projectedEntry(DIGEST_B, '2026-07-28T11:59:00.000Z'),
            projectedEntry(DIGEST_A, '2026-07-28T12:00:00.000Z'),
          ],
        }),
        { mode: 'chronological' },
      ),
    ).toThrow('descending finalized time and object-ID order');

    const duplicate = projectedEntry();
    expect(() =>
      parseProjectedFeedResponse(feedResponse({ entries: [duplicate, duplicate] }), {
        mode: 'chronological',
      }),
    ).toThrow('cannot repeat a post identifier');
  });

  it('validates public viewer identity and bounded opaque cursor inputs locally', () => {
    expect(validateFollowingViewer(IDENTITY_ID)).toEqual({
      kind: 'valid',
      viewer: IDENTITY_ID,
    });
    expect(validateFollowingViewer('ari')).toMatchObject({ kind: 'invalid' });
    expect(validateFeedCursor('abc_DEF-123')).toEqual({
      cursor: 'abc_DEF-123',
      kind: 'valid',
    });
    expect(validateFeedCursor('not+opaque')).toMatchObject({ kind: 'invalid' });
  });
});

describe('runtime-neutral feed requests', () => {
  it('uses an explicit base URL/fetch/deadline and preserves the keyset cursor', async () => {
    const fetch = vi.fn<IndexerFetch>(async () =>
      Response.json(feedResponse({ nextCursor: 'opaque_cursor_2' })),
    );

    await expect(
      fetchChronologicalFeed(
        { baseUrl: 'https://indexer.example/operator/', deadlineMs: 1_000, fetch },
        { cursor: 'opaque_cursor_1' },
      ),
    ).resolves.toMatchObject({
      endpoint: 'https://indexer.example',
      kind: 'ready',
      value: { mode: 'chronological', nextCursor: 'opaque_cursor_2' },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://indexer.example/operator/v1/feed?limit=20&mode=chronological&before=opaque_cursor_1',
      expect.objectContaining({
        headers: { Accept: 'application/json' },
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it('exposes a typed following client without transmitting invalid viewer input', async () => {
    const fetch = vi.fn<IndexerFetch>(async () =>
      Response.json(
        feedResponse({
          entries: [
            projectedEntry(DIGEST_A, '2026-07-28T12:00:00.000Z', {
              followedIdentityId: IDENTITY_ID,
              kind: 'following',
            }),
          ],
          mode: 'following',
          viewer: IDENTITY_ID,
        }),
      ),
    );
    const client = createIndexerClient({
      baseUrl: 'https://indexer.example/',
      deadlineMs: 1_000,
      fetch,
    });

    await expect(client.following({ viewer: IDENTITY_ID })).resolves.toMatchObject({
      kind: 'ready',
      value: { mode: 'following', viewer: IDENTITY_ID },
    });
    expect(String(fetch.mock.calls[0]?.[0])).toContain(`viewer=${encodeURIComponent(IDENTITY_ID)}`);

    fetch.mockClear();
    await expect(
      fetchFollowingFeed(
        { baseUrl: 'https://indexer.example/', deadlineMs: 1_000, fetch },
        { viewer: 'not-an-identity' },
      ),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects a provider that repeats the requested keyset cursor', async () => {
    const fetch = vi.fn<IndexerFetch>(async () =>
      Response.json(feedResponse({ nextCursor: 'opaque_cursor_1' })),
    );

    await expect(
      fetchChronologicalFeed(
        { baseUrl: 'https://indexer.example/', deadlineMs: 1_000, fetch },
        { cursor: 'opaque_cursor_1' },
      ),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
  });

  it('rejects invalid client configuration before invoking fetch', async () => {
    const fetch = vi.fn<IndexerFetch>();

    await expect(
      fetchChronologicalFeed({
        baseUrl: 'file:///tmp/indexer',
        deadlineMs: 1_000,
        fetch,
      }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-configuration' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces the explicit wall-clock deadline across fetch and body streaming', async () => {
    const stalledFetch: IndexerFetch = () => new Promise<Response>(() => undefined);

    await expect(
      fetchChronologicalFeed({
        baseUrl: 'https://indexer.example/',
        deadlineMs: 5,
        fetch: stalledFetch,
      }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'unavailable' });

    const stalledBodyFetch: IndexerFetch = async () =>
      new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), {
        headers: { 'content-type': 'application/json' },
      });
    await expect(
      fetchChronologicalFeed({
        baseUrl: 'https://indexer.example/',
        deadlineMs: 5,
        fetch: stalledBodyFetch,
      }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'unavailable' });
  });
});

describe('bounded JSON transport', () => {
  it('rejects declared and streamed payloads beyond the six-MiB budget', async () => {
    await expect(
      readIndexerJson(
        new Response('{}', {
          headers: {
            'content-length': String(MAX_INDEXER_JSON_BYTES + 1),
            'content-type': 'application/json',
          },
        }),
      ),
    ).rejects.toThrow('exceeded the JSON byte budget');

    await expect(
      readIndexerJson(
        new Response(new Uint8Array(MAX_INDEXER_JSON_BYTES + 1), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).rejects.toThrow('exceeded the JSON byte budget');
  });

  it('rejects non-JSON content and malformed UTF-8', async () => {
    await expect(readIndexerJson(new Response('{}'))).rejects.toThrow('application/json');
    await expect(
      readIndexerJson(
        new Response(new Uint8Array([0xff]), {
          headers: { 'content-type': 'application/json' },
        }),
      ),
    ).rejects.toThrow('invalid UTF-8');
  });
});
