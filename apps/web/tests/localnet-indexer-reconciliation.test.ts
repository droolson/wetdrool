import { describe, expect, it, vi } from 'vitest';

import { waitForIndexedIdentity, waitForIndexedPost } from '../lib/localnet-indexer-reconciliation';

const GENESIS = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const PROGRAM = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const IDENTITY_ADDRESS = '8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE';
const ROOT = '11111111111111111111111111111111';
const NETWORK = `droolnet:v1:${GENESIS}:${PROGRAM}`;
const IDENTITY_ID = `wetdroolid:v1:${NETWORK}:${IDENTITY_ADDRESS}`;
const OBJECT_ID = `wetdroolobj:v1:post:u${'A'.repeat(43)}`;
const CID = 'bafkreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm';
const HASH = `u${'B'.repeat(43)}`;
const SIGNATURE = '1'.repeat(64);

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function identityResponse(overrides: Record<string, unknown> = {}) {
  return {
    canonical: false,
    delegations: [],
    identity: {
      active: true,
      identityId: IDENTITY_ID,
      identitySequence: '0',
      rootAuthority: ROOT,
      rootRotationCount: '0',
      updatedSlot: '42',
      ...overrides,
    },
  };
}

function postResponse(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      checkpointSlot: 45,
      indexedAt: '2026-07-29T12:00:01.000Z',
      source: 'DroolNet open indexer',
    },
    post: {
      author: {
        displayName: 'Unnamed member',
        handle: null,
        identityId: IDENTITY_ID,
      },
      body: 'A finalized localnet post.',
      bodyReference: null,
      createdAt: '2026-07-29T12:00:00.000Z',
      id: OBJECT_ID,
      language: 'und',
      media: [],
      verification: {
        anchor: {
          finality: 'finalized',
          slot: 45,
          transaction: SIGNATURE,
        },
        contentHash: HASH,
        contentHashValid: true,
        manifestUri: `ipfs://${CID}`,
        signatureValid: true,
        state: 'verified',
      },
    },
    ...overrides,
  };
}

describe('localnet indexer reconciliation', () => {
  it('waits through absence and returns only the exact active passkey identity', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(json({ error: { code: 'not-found' } }, 404))
      .mockResolvedValueOnce(json(identityResponse()));

    await expect(
      waitForIndexedIdentity(
        {
          baseUrl: 'http://127.0.0.1:4000',
          fetch,
          maximumAttempts: 2,
          pollDelayMilliseconds: 0,
        },
        {
          identityId: IDENTITY_ID,
          minimumSequence: 0n,
          minimumSlot: 42n,
          rootAuthority: ROOT,
        },
      ),
    ).resolves.toEqual({
      active: true,
      identityId: IDENTITY_ID,
      identitySequence: 0n,
      rootAuthority: ROOT,
      rootRotationCount: 0n,
      updatedSlot: 42n,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['another root', { rootAuthority: PROGRAM }],
    ['another identity', { identityId: `wetdroolid:v1:${NETWORK}:${PROGRAM}` }],
    ['inactive state', { active: false, deactivatedSlot: '42' }],
    ['unknown field', { privateProfile: 'leak' }],
  ])('rejects %s instead of selecting substituted identity state', async (_label, override) => {
    await expect(
      waitForIndexedIdentity(
        {
          baseUrl: 'http://localhost:4000',
          fetch: vi.fn(async () => json(identityResponse(override))),
          maximumAttempts: 1,
          pollDelayMilliseconds: 0,
        },
        {
          identityId: IDENTITY_ID,
          minimumSequence: 0n,
          minimumSlot: 42n,
          rootAuthority: ROOT,
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('requires checkpoint coverage and every signed/finalized post coordinate', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        json(
          postResponse({
            meta: {
              checkpointSlot: 44,
              indexedAt: '2026-07-29T12:00:01.000Z',
              source: 'DroolNet open indexer',
            },
          }),
        ),
      )
      .mockResolvedValueOnce(json(postResponse()));

    const result = await waitForIndexedPost(
      {
        baseUrl: 'http://localhost:4000',
        fetch,
        maximumAttempts: 2,
        pollDelayMilliseconds: 0,
      },
      {
        authorIdentityId: IDENTITY_ID,
        body: 'A finalized localnet post.',
        cid: CID,
        finalizedSlot: 45n,
        language: 'und',
        objectId: OBJECT_ID,
        payloadHash: HASH,
        transactionSignature: SIGNATURE,
      },
    );

    expect(result.meta.checkpointSlot).toBe(45);
    expect(result.post.id).toBe(OBJECT_ID);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['object', { id: `wetdroolobj:v1:post:u${'C'.repeat(43)}` }],
    ['author', { author: { displayName: 'x', handle: null, identityId: IDENTITY_ID.slice(1) } }],
    ['body', { body: 'substituted' }],
    ['invalid event time', { createdAt: 'not-a-date' }],
    ['language', { language: 'en' }],
    ['hash', { verification: { ...postResponse().post.verification, contentHash: HASH.slice(1) } }],
    [
      'transaction',
      {
        verification: {
          ...postResponse().post.verification,
          anchor: { finality: 'finalized', slot: 45, transaction: '2'.repeat(64) },
        },
      },
    ],
  ])('rejects a substituted indexed %s', async (_label, postOverride) => {
    const candidate = postResponse();
    candidate.post = { ...candidate.post, ...postOverride };
    await expect(
      waitForIndexedPost(
        {
          baseUrl: 'http://127.0.0.1:4000',
          fetch: vi.fn(async () => json(candidate)),
          maximumAttempts: 1,
          pollDelayMilliseconds: 0,
        },
        {
          authorIdentityId: IDENTITY_ID,
          body: 'A finalized localnet post.',
          cid: CID,
          finalizedSlot: 45n,
          language: 'und',
          objectId: OBJECT_ID,
          payloadHash: HASH,
          transactionSignature: SIGNATURE,
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('times out honestly when the finalized post remains absent', async () => {
    await expect(
      waitForIndexedPost(
        {
          baseUrl: 'http://localhost:4000',
          fetch: vi.fn(async () => json({ error: { code: 'not-found' } }, 404)),
          maximumAttempts: 2,
          pollDelayMilliseconds: 0,
        },
        {
          authorIdentityId: IDENTITY_ID,
          body: 'A finalized localnet post.',
          cid: CID,
          finalizedSlot: 45n,
          language: 'und',
          objectId: OBJECT_ID,
          payloadHash: HASH,
          transactionSignature: SIGNATURE,
        },
      ),
    ).rejects.toMatchObject({ code: 'timeout' });
  });

  it('rejects a remote indexer before making a request', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    await expect(
      waitForIndexedIdentity(
        { baseUrl: 'https://indexer.example', fetch },
        {
          identityId: IDENTITY_ID,
          minimumSequence: 0n,
          minimumSlot: 42n,
          rootAuthority: ROOT,
        },
      ),
    ).rejects.toMatchObject({ code: 'invalid-config' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
