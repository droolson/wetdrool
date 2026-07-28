import { describe, expect, it } from 'vitest';

import {
  IndexerPayloadError,
  isValidPostId,
  parseFeedResponse,
  parseIndexedPost,
} from '../lib/indexer';

const VERIFIED_POST = {
  author: {
    displayName: 'Ari',
    handle: 'ari',
    identityId:
      'swid:v1:woke:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD:8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE',
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
    ).toThrow('inline body or a body reference');
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
