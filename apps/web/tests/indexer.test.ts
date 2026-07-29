import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getHomeFeed,
  getPostById,
  IndexerPayloadError,
  isValidPostId,
  parseFeedResponse,
  parseIndexedPost,
  parseSearchResponse,
  searchPublic,
  validatePublicSearchQuery,
} from '../lib/indexer';
import {
  getProjectedFeed,
  parseProjectedFeedResponse,
  validateFeedCursor,
  validateFollowingViewer,
} from '../lib/projected-feed';

const NETWORK_ID =
  'wokenet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const PROTOCOL_DIGEST = `u${'A'.repeat(43)}`;
const PROJECTED_POST_ID = `wokesocialobj:v1:post:${PROTOCOL_DIGEST}`;
const PROJECTED_POST_CID = 'bafkreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm';
const PROJECTED_TRANSACTION_SIGNATURE = '1'.repeat(64);

const VERIFIED_POST = {
  author: {
    displayName: 'Ari',
    handle: 'ari',
    identityId:
      'wokesocialid:v1:wokenet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD:8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE',
  },
  body: 'Portable identity, ordinary language.',
  bodyReference: null,
  createdAt: '2026-07-28T12:00:00.000Z',
  id: 'post:example_1',
  language: 'en',
  verification: {
    anchor: {
      finality: 'finalized',
      slot: 42,
      transaction: 'transaction-signature',
    },
    contentHash: 'sha256:1234',
    contentHashValid: true,
    manifestUri: 'ipfs://bafy-example',
    signatureValid: true,
    state: 'verified',
  },
} as const;

describe('typed indexer response parsing', () => {
  it('accepts a bounded, internally consistent feed response', () => {
    const response = parseFeedResponse({
      meta: {
        checkpointSlot: 42,
        indexedAt: '2026-07-28T12:01:00.000Z',
        source: 'Local indexer',
      },
      posts: [VERIFIED_POST],
    });

    expect(response.posts).toHaveLength(1);
    expect(response.posts[0]?.verification.state).toBe('verified');
    expect(response.meta.checkpointSlot).toBe(42);
  });

  it('rejects a verified label without all required proof fields', () => {
    expect(() =>
      parseIndexedPost({
        ...VERIFIED_POST,
        verification: {
          ...VERIFIED_POST.verification,
          signatureValid: false,
        },
      }),
    ).toThrow(IndexerPayloadError);
  });

  it('rejects unbounded feed arrays', () => {
    expect(() =>
      parseFeedResponse({
        meta: {
          checkpointSlot: null,
          indexedAt: '2026-07-28T12:01:00.000Z',
          source: 'Oversized indexer',
        },
        posts: Array.from({ length: 51 }, () => VERIFIED_POST),
      }),
    ).toThrow('at most 50');
  });

  it('rejects dates and objects that do not match the contract', () => {
    expect(() =>
      parseIndexedPost({
        ...VERIFIED_POST,
        createdAt: 'not-a-date',
      }),
    ).toThrow('ISO-compatible');
    expect(() => parseFeedResponse(null)).toThrow('must be an object');
  });

  it('accepts an honest unclaimed handle and a separately stored body', () => {
    const parsed = parseIndexedPost({
      ...VERIFIED_POST,
      author: {
        ...VERIFIED_POST.author,
        handle: null,
      },
      body: null,
      bodyReference: {
        bytes: 256,
        cid: 'bafkreibm6jg3ux5qugxf2bk3xika2dr2qak7r7ycz4ghxr2r2wuo5w7cge',
        digest: 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        mediaType: 'text/plain',
      },
    });

    expect(parsed.author.handle).toBeNull();
    expect(parsed.bodyReference?.mediaType).toBe('text/plain');
  });

  it('rejects a post with neither inline nor referenced body content', () => {
    expect(() =>
      parseIndexedPost({
        ...VERIFIED_POST,
        body: null,
        bodyReference: null,
      }),
    ).toThrow('inline body, body reference, or media');
  });

  it('accepts a media-only post without inventing body text', () => {
    const parsed = parseIndexedPost({
      ...VERIFIED_POST,
      body: null,
      bodyReference: null,
      media: [
        {
          altText: 'A purple sunrise over the water.',
          bytes: 512,
          cid: 'bafy-media',
          digest: 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          mediaType: 'image/webp',
        },
      ],
    });

    expect(parsed.body).toBeNull();
    expect(parsed.media).toEqual([
      expect.objectContaining({
        altText: 'A purple sunrise over the water.',
        mediaType: 'image/webp',
      }),
    ]);
  });
});

const PROJECTED_FEED_RESPONSE = {
  canonical: false,
  entries: [
    {
      author: {
        active: true,
        identityId: VERIFIED_POST.author.identityId,
      },
      post: {
        anchoredSlot: '42',
        authorIdentityId: VERIFIED_POST.author.identityId,
        cid: PROJECTED_POST_CID,
        content: {
          body: VERIFIED_POST.body,
          format: 'plain',
          language: 'en',
          media: [],
          quotePolicy: 'allowed',
          replyPolicy: 'anyone',
          visibility: { kind: 'public' },
        },
        createdAt: VERIFIED_POST.createdAt,
        networkId: NETWORK_ID,
        objectId: PROJECTED_POST_ID,
        payloadHash: PROTOCOL_DIGEST,
        signingKeyId: `${VERIFIED_POST.author.identityId}#root/${'1'.repeat(32)}`,
        transactionSignature: PROJECTED_TRANSACTION_SIGNATURE,
        verified: true,
      },
      profile: {
        content: { displayName: VERIFIED_POST.author.displayName },
        identityId: VERIFIED_POST.author.identityId,
      },
      reason: { kind: 'chronological' },
    },
  ],
  meta: {
    checkpointSlot: 42,
    indexedAt: '2026-07-28T12:01:00.000Z',
    source: 'WokeNet open indexer',
  },
  mode: 'chronological',
  network: NETWORK_ID,
  nextCursor: null,
  projection: 'wokenet-open-indexer',
  recipe: 'wokenet-open-indexer-feed-v1',
  viewer: null,
} as const;

describe('typed projected-feed parsing and requests', () => {
  const originalIndexerUrl = process.env['WOKESOCIAL_INDEXER_URL'];

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalIndexerUrl === undefined) {
      delete process.env['WOKESOCIAL_INDEXER_URL'];
    } else {
      process.env['WOKESOCIAL_INDEXER_URL'] = originalIndexerUrl;
    }
  });

  it('maps the replaceable low-level projection into proof-bearing post cards', () => {
    const parsed = parseProjectedFeedResponse(PROJECTED_FEED_RESPONSE, {
      mode: 'chronological',
    });

    expect(parsed.entries[0]).toMatchObject({
      post: {
        author: { displayName: 'Ari' },
        body: VERIFIED_POST.body,
        media: [],
        verification: {
          anchor: { finality: 'finalized', slot: 42 },
          state: 'verified',
        },
      },
      reason: { kind: 'chronological' },
    });
    expect(parsed.network).toBe(NETWORK_ID);
    expect(parsed.nextCursor).toBeNull();
    expect(parsed.recipe).toBe('wokenet-open-indexer-feed-v1');
    expect(() =>
      parseProjectedFeedResponse(
        { ...PROJECTED_FEED_RESPONSE, recipe: 'provider-invented-feed-v1' },
        { mode: 'chronological' },
      ),
    ).toThrow(IndexerPayloadError);
  });

  it('accepts an explicitly scoped public following projection', () => {
    const response = {
      ...PROJECTED_FEED_RESPONSE,
      entries: [
        {
          ...PROJECTED_FEED_RESPONSE.entries[0],
          reason: {
            followedIdentityId: VERIFIED_POST.author.identityId,
            kind: 'following',
          },
        },
      ],
      mode: 'following',
      viewer: VERIFIED_POST.author.identityId,
    } as const;

    expect(
      parseProjectedFeedResponse(response, {
        mode: 'following',
        viewer: VERIFIED_POST.author.identityId,
      }),
    ).toMatchObject({
      mode: 'following',
      viewer: VERIFIED_POST.author.identityId,
    });
  });

  it.each([
    [
      'a nonpublic post',
      {
        ...PROJECTED_FEED_RESPONSE,
        entries: [
          {
            ...PROJECTED_FEED_RESPONSE.entries[0],
            post: {
              ...PROJECTED_FEED_RESPONSE.entries[0].post,
              content: {
                ...PROJECTED_FEED_RESPONSE.entries[0].post.content,
                visibility: { kind: 'unlisted' },
              },
            },
          },
        ],
      },
    ],
    [
      'an unsafe anchor slot',
      {
        ...PROJECTED_FEED_RESPONSE,
        entries: [
          {
            ...PROJECTED_FEED_RESPONSE.entries[0],
            post: {
              ...PROJECTED_FEED_RESPONSE.entries[0].post,
              anchoredSlot: '9007199254740992',
            },
          },
        ],
      },
    ],
    [
      'a duplicate post',
      {
        ...PROJECTED_FEED_RESPONSE,
        entries: [PROJECTED_FEED_RESPONSE.entries[0], PROJECTED_FEED_RESPONSE.entries[0]],
      },
    ],
    [
      'a tombstoned post',
      {
        ...PROJECTED_FEED_RESPONSE,
        entries: [
          {
            ...PROJECTED_FEED_RESPONSE.entries[0],
            post: {
              ...PROJECTED_FEED_RESPONSE.entries[0].post,
              tombstonedAt: '2026-07-28T12:02:00.000Z',
            },
          },
        ],
      },
    ],
    [
      'a malformed protocol field',
      {
        ...PROJECTED_FEED_RESPONSE,
        entries: [
          {
            ...PROJECTED_FEED_RESPONSE.entries[0],
            post: {
              ...PROJECTED_FEED_RESPONSE.entries[0].post,
              transactionSignature: 'not-a-wokenet-signature',
            },
          },
        ],
      },
    ],
    [
      'a nonempty page without a checkpoint',
      {
        ...PROJECTED_FEED_RESPONSE,
        meta: {
          ...PROJECTED_FEED_RESPONSE.meta,
          checkpointSlot: null,
        },
      },
    ],
    [
      'a cursor on an empty page',
      {
        ...PROJECTED_FEED_RESPONSE,
        entries: [],
        nextCursor: 'opaque_cursor',
      },
    ],
  ])('rejects %s', (_label, response) => {
    expect(() => parseProjectedFeedResponse(response, { mode: 'chronological' })).toThrow(
      IndexerPayloadError,
    );
  });

  it('rejects pages outside descending finalized-time and object-ID order', () => {
    const olderEntry = {
      ...PROJECTED_FEED_RESPONSE.entries[0],
      post: {
        ...PROJECTED_FEED_RESPONSE.entries[0].post,
        createdAt: '2026-07-28T11:59:00.000Z',
        objectId: `wokesocialobj:v1:post:u${'B'.repeat(43)}`,
      },
    } as const;

    expect(() =>
      parseProjectedFeedResponse(
        {
          ...PROJECTED_FEED_RESPONSE,
          entries: [olderEntry, PROJECTED_FEED_RESPONSE.entries[0]],
        },
        { mode: 'chronological' },
      ),
    ).toThrow('descending finalized time and object-ID order');
  });

  it('validates viewer identities and opaque cursor URL state before a request', () => {
    expect(validateFollowingViewer(VERIFIED_POST.author.identityId)).toEqual({
      kind: 'valid',
      viewer: VERIFIED_POST.author.identityId,
    });
    expect(validateFollowingViewer('ari')).toMatchObject({ kind: 'invalid' });
    expect(validateFollowingViewer(['one', 'two'])).toMatchObject({ kind: 'invalid' });
    expect(validateFeedCursor('abc_DEF-123')).toEqual({
      cursor: 'abc_DEF-123',
      kind: 'valid',
    });
    expect(validateFeedCursor('not+opaque')).toMatchObject({ kind: 'invalid' });
  });

  it('requests the default-network chronological route with an encoded opaque cursor', async () => {
    process.env['WOKESOCIAL_INDEXER_URL'] = 'https://indexer.example/operator/';
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(PROJECTED_FEED_RESPONSE),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(
      getProjectedFeed({ cursor: 'abc_DEF-123', mode: 'chronological' }),
    ).resolves.toMatchObject({
      endpoint: 'https://indexer.example',
      kind: 'ready',
      value: { mode: 'chronological' },
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://indexer.example/operator/v1/feed?limit=20&mode=chronological&before=abc_DEF-123',
    );
  });

  it('does not transmit malformed viewer or cursor input', async () => {
    process.env['WOKESOCIAL_INDEXER_URL'] = 'https://indexer.example/';
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);

    await expect(
      getProjectedFeed({ mode: 'following', viewer: 'not-an-identity' }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
    await expect(
      getProjectedFeed({ cursor: 'not+opaque', mode: 'chronological' }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('post identifiers', () => {
  it.each(['post:abc-123', 'QmExample_42', 'abc'])('accepts safe identifier %s', (identifier) => {
    expect(isValidPostId(identifier)).toBe(true);
  });

  it.each(['', '../secret', 'contains space', '/leading-slash'])(
    'rejects unsafe identifier %s',
    (identifier) => {
      expect(isValidPostId(identifier)).toBe(false);
    },
  );
});

describe('typed public-search response parsing', () => {
  const originalIndexerUrl = process.env['WOKESOCIAL_INDEXER_URL'];
  const communityResult = {
    kind: 'community',
    matchedBy: 'exact-identifier',
    communityAddress: '11111111111111111111111111111111',
    creatorIdentityId: VERIFIED_POST.author.identityId,
    manifestHash: 'uAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    manifestUri: 'ipfs://bafy-community',
    metadataVerified: false,
    governanceVersion: 1,
    updatedAt: '2026-07-28T12:00:00.000Z',
  } as const;
  const response = {
    canonical: false,
    meta: {
      checkpointSlot: 42,
      indexedAt: '2026-07-28T12:01:00.000Z',
      source: 'WokeNet open indexer',
    },
    query: 'river',
    ranking: {
      deterministic: true,
      version: 'public-match-v1',
    },
    scope: 'public-finalized-projection',
    results: [
      {
        kind: 'person',
        matchedBy: 'handle',
        identityId: VERIFIED_POST.author.identityId,
        displayName: 'River Chen',
        handle: 'river',
        bio: '',
        updatedAt: '2026-07-28T12:00:00.000Z',
      },
      {
        kind: 'post',
        matchedBy: 'post-body',
        post: {
          ...VERIFIED_POST,
          visibility: 'public',
        },
      },
    ],
  } as const;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalIndexerUrl === undefined) {
      delete process.env['WOKESOCIAL_INDEXER_URL'];
    } else {
      process.env['WOKESOCIAL_INDEXER_URL'] = originalIndexerUrl;
    }
  });

  it('accepts bounded public-only result variants and proof-bearing posts', () => {
    const parsed = parseSearchResponse(response);
    expect(parsed.results.map((result) => result.kind)).toEqual(['person', 'post']);
    expect(parsed.results[0]).toMatchObject({ handle: 'river', matchedBy: 'handle' });
  });

  it('accepts the protocol display-name byte limit and rejects values beyond it', () => {
    expect(
      parseSearchResponse({
        ...response,
        results: [{ ...response.results[0], displayName: 'a'.repeat(160) }],
      }).results[0],
    ).toMatchObject({ displayName: 'a'.repeat(160) });
    expect(() =>
      parseSearchResponse({
        ...response,
        results: [{ ...response.results[0], displayName: 'a'.repeat(161) }],
      }),
    ).toThrow('no longer than 160 characters');
    expect(() =>
      parseSearchResponse({
        ...response,
        results: [{ ...response.results[0], displayName: '😀'.repeat(41) }],
      }),
    ).toThrow('no longer than 160 UTF-8 bytes');
  });

  it.each([
    ['a pending post', { state: 'pending' }],
    ['an invalid signature', { signatureValid: false }],
    ['an invalid content hash', { contentHashValid: false }],
    [
      'a merely confirmed anchor',
      {
        anchor: {
          ...VERIFIED_POST.verification.anchor,
          finality: 'confirmed',
        },
      },
    ],
  ])('rejects %s from public post results', (_label, verificationChange) => {
    expect(() =>
      parseSearchResponse({
        ...response,
        results: [
          {
            ...response.results[1],
            post: {
              ...response.results[1].post,
              verification: {
                ...VERIFIED_POST.verification,
                ...verificationChange,
              },
            },
          },
        ],
      }),
    ).toThrow();
  });

  it.each([undefined, 'private', 'unlisted'])(
    'rejects a missing or nonpublic visibility claim (%s) on a post result',
    (visibility) => {
      const post = { ...response.results[1].post } as Record<string, unknown>;
      if (visibility === undefined) {
        delete post.visibility;
      } else {
        post.visibility = visibility;
      }

      expect(() =>
        parseSearchResponse({
          ...response,
          results: [
            {
              ...response.results[1],
              post,
            },
          ],
        }),
      ).toThrow('explicit public visibility');
    },
  );

  it('rejects a nonpublic visibility claim even when proofs are otherwise valid', () => {
    expect(() =>
      parseSearchResponse({
        ...response,
        results: [
          {
            ...response.results[1],
            post: {
              ...response.results[1].post,
              visibility: 'private',
            },
          },
        ],
      }),
    ).toThrow('explicit public visibility');
  });

  it('rejects community results without verified metadata and public visibility proof', () => {
    expect(() =>
      parseSearchResponse({
        ...response,
        results: [communityResult],
      }),
    ).toThrow('verified metadata and an explicit public visibility proof');
  });

  it('rejects cross-kind ranking reasons and oversized result arrays', () => {
    expect(() =>
      parseSearchResponse({
        ...response,
        results: [
          {
            ...response.results[0],
            matchedBy: 'post-body',
          },
        ],
      }),
    ).toThrow('invalid match reason');
    expect(() =>
      parseSearchResponse({
        ...response,
        results: Array.from({ length: 51 }, () => response.results[0]),
      }),
    ).toThrow('metadata is invalid');
  });

  it('sends a bounded canonical query only to the configured indexer', async () => {
    process.env['WOKESOCIAL_INDEXER_URL'] = 'https://indexer.example/operator/';
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ ...response, query: 'river chen' }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(searchPublic('  River Chen  ')).resolves.toMatchObject({
      endpoint: 'https://indexer.example',
      kind: 'ready',
      value: { query: 'river chen' },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://indexer.example/operator/v1/search/public?q=river%20chen&limit=30',
    );
  });

  it('rejects a two-code-point local query without transmitting it', async () => {
    process.env['WOKESOCIAL_INDEXER_URL'] = 'https://indexer.example/';
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);

    await expect(searchPublic('xy')).resolves.toMatchObject({
      detail: 'Use at least 3 normalized Unicode code points.',
      kind: 'degraded',
      reason: 'invalid-response',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('normalizes and counts Unicode code points before enforcing canonical query length', async () => {
    expect(validatePublicSearchQuery('ﬃ')).toEqual({ kind: 'valid', query: 'ffi' });
    expect(validatePublicSearchQuery('ÄBC')).toEqual({ kind: 'valid', query: 'Äbc' });
    expect(validatePublicSearchQuery('😀😀')).toMatchObject({
      kind: 'invalid',
      reason: 'too-short',
    });
    expect(validatePublicSearchQuery('😀😀😀')).toEqual({
      kind: 'valid',
      query: '😀😀😀',
    });
    expect(validatePublicSearchQuery('😀'.repeat(120))).toMatchObject({ kind: 'valid' });
    expect(validatePublicSearchQuery('😀'.repeat(121))).toMatchObject({
      kind: 'invalid',
      reason: 'too-long',
    });

    const compatibilityExpansion = 'ﬃ'.repeat(41);
    expect(compatibilityExpansion).toHaveLength(41);
    expect(validatePublicSearchQuery(compatibilityExpansion)).toMatchObject({
      kind: 'invalid',
      query: 'ffi'.repeat(41),
      reason: 'too-long',
    });

    process.env['WOKESOCIAL_INDEXER_URL'] = 'https://indexer.example/';
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);

    await expect(searchPublic('x'.repeat(121))).resolves.toMatchObject({
      detail: 'Use no more than 120 normalized Unicode code points.',
      kind: 'degraded',
      reason: 'invalid-response',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('classifies ambiguous and control-character URL queries as invalid', () => {
    expect(validatePublicSearchQuery(['river', 'private-term'])).toMatchObject({
      kind: 'invalid',
      reason: 'ambiguous',
    });
    expect(validatePublicSearchQuery('river\nprivate-term')).toMatchObject({
      kind: 'invalid',
      reason: 'control-characters',
    });
  });

  it('rejects oversized declared responses for every indexer fetch', async () => {
    process.env['WOKESOCIAL_INDEXER_URL'] = 'https://indexer.example/';
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response('{}', {
          headers: {
            'content-length': '999999999',
            'content-type': 'application/json',
          },
        }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(getHomeFeed()).resolves.toMatchObject({
      kind: 'degraded',
      reason: 'invalid-response',
    });
    await expect(getPostById('post:example_1')).resolves.toMatchObject({
      kind: 'degraded',
      reason: 'invalid-response',
    });
    await expect(searchPublic('river')).resolves.toMatchObject({
      kind: 'degraded',
      reason: 'invalid-response',
    });
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('stops an oversized streamed JSON body before parsing ignored properties', async () => {
    process.env['WOKESOCIAL_INDEXER_URL'] = 'https://indexer.example/';
    const encoder = new TextEncoder();
    let part = 0;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        if (part === 0) {
          controller.enqueue(encoder.encode('{"ignored":"'));
        } else if (part <= 7) {
          controller.enqueue(new Uint8Array(1024 * 1024).fill(97));
        } else {
          controller.enqueue(encoder.encode('"}'));
          controller.close();
        }
        part += 1;
      },
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        new Response(body, {
          headers: {
            'content-type': 'application/json',
          },
        }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(searchPublic('river')).resolves.toMatchObject({
      kind: 'degraded',
      reason: 'invalid-response',
    });
    expect(cancel).toHaveBeenCalledOnce();
  });
});
