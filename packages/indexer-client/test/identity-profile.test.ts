import { describe, expect, it, vi } from 'vitest';

import { IndexerPayloadError } from '../src/contract.js';
import { fetchIdentityProfile, parseIdentityProfileResponse } from '../src/identity-profile.js';

const NETWORK =
  'wokenet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const IDENTITY_ADDRESS = '8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE';
const IDENTITY_ID = `wokesocialid:v1:${NETWORK}:${IDENTITY_ADDRESS}`;
const ROOT = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const CID = 'bafkreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm';
const DIGEST = `u${'A'.repeat(43)}`;
const OBJECT_ID = `wokesocialobj:v1:profile:${DIGEST}`;

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    canonical: false,
    network: NETWORK,
    identity: {
      identityId: IDENTITY_ID,
      identityAddress: IDENTITY_ADDRESS,
      rootAuthority: ROOT,
      active: true,
      identitySequence: '3',
      updatedSlot: '40',
    },
    handle: 'anon_7n044tsjxrfm5e23',
    profile: {
      objectId: OBJECT_ID,
      cid: CID,
      payloadHash: DIGEST,
      content: {
        displayName: 'River Chen',
        bio: 'Portable identity.',
        pronouns: [{ visibility: 'public', value: 'they/them' }],
        chosenFamilyLabels: [],
        links: [{ label: 'Site', url: 'https://example.org/about' }],
      },
      updatedSlot: '41',
      updatedAt: '2026-07-28T14:02:01.000Z',
    },
    meta: {
      checkpointSlot: 42,
      indexedAt: '2026-07-29T12:00:00.000Z',
      source: 'WokeNet open indexer',
    },
    ...overrides,
  };
}

describe('parseIdentityProfileResponse', () => {
  it('accepts one exact identity, public profile, handle, and covering checkpoint', () => {
    const view = parseIdentityProfileResponse(response(), { identityId: IDENTITY_ID });
    expect(view).toMatchObject({
      canonical: false,
      network: NETWORK,
      identity: { identityId: IDENTITY_ID, active: true },
      handle: 'anon_7n044tsjxrfm5e23',
      profile: { objectId: OBJECT_ID, content: { displayName: 'River Chen' } },
      meta: { checkpointSlot: 42 },
    });
    expect(view.identity.deactivatedAt).toBeUndefined();
  });

  it('accepts a null profile and a null handle, and binds deactivation honestly', () => {
    const bare = parseIdentityProfileResponse(response({ handle: null, profile: null }));
    expect(bare.handle).toBeNull();
    expect(bare.profile).toBeNull();

    const deactivated = parseIdentityProfileResponse(
      response({
        handle: null,
        identity: {
          identityId: IDENTITY_ID,
          identityAddress: IDENTITY_ADDRESS,
          rootAuthority: ROOT,
          active: false,
          identitySequence: '4',
          updatedSlot: '41',
          deactivatedAt: '2026-07-29T11:00:00.000Z',
        },
      }),
    );
    expect(deactivated.identity.active).toBe(false);
    expect(deactivated.identity.deactivatedAt).toBe('2026-07-29T11:00:00.000Z');
  });

  it('rejects broken bindings, stale checkpoints, and unsupported fields', () => {
    const cases: Record<string, unknown>[] = [
      // A handle on a deactivated identity contradicts fail-closed resolution.
      response({
        identity: {
          identityId: IDENTITY_ID,
          identityAddress: IDENTITY_ADDRESS,
          rootAuthority: ROOT,
          active: false,
          identitySequence: '4',
          updatedSlot: '41',
          deactivatedAt: '2026-07-29T11:00:00.000Z',
        },
      }),
      // An active identity must not carry a deactivation timestamp.
      response({
        identity: {
          identityId: IDENTITY_ID,
          identityAddress: IDENTITY_ADDRESS,
          rootAuthority: ROOT,
          active: true,
          identitySequence: '3',
          updatedSlot: '40',
          deactivatedAt: '2026-07-29T11:00:00.000Z',
        },
      }),
      // Identity ID must equal wokesocialid:v1:<network>:<identityAddress>.
      response({
        identity: {
          identityId: `wokesocialid:v1:${NETWORK}:${ROOT}`,
          identityAddress: IDENTITY_ADDRESS,
          rootAuthority: ROOT,
          active: true,
          identitySequence: '3',
          updatedSlot: '40',
        },
      }),
      // Checkpoint must cover the identity and profile slots.
      response({
        meta: { checkpointSlot: 39, indexedAt: '2026-07-29T12:00:00.000Z', source: 'X' },
      }),
      response({
        meta: { checkpointSlot: null, indexedAt: '2026-07-29T12:00:00.000Z', source: 'X' },
      }),
      response({ handle: 'Not_Canonical' }),
      response({ handle: 'anon_7n044tsjxrfm5e23.woke' }),
      response({ operatorOverride: true }),
      response({
        profile: {
          objectId: `wokesocialobj:v1:post:${DIGEST}`,
          cid: CID,
          payloadHash: DIGEST,
          content: { displayName: 'x', bio: '', pronouns: [], chosenFamilyLabels: [], links: [] },
          updatedSlot: '41',
          updatedAt: '2026-07-28T14:02:01.000Z',
        },
      }),
    ];
    for (const value of cases) {
      expect(() => parseIdentityProfileResponse(value)).toThrowError(IndexerPayloadError);
    }
    expect(() =>
      parseIdentityProfileResponse(response(), {
        identityId: `wokesocialid:v1:${NETWORK}:${ROOT}`,
      }),
    ).toThrowError(IndexerPayloadError);
  });
});

describe('fetchIdentityProfile', () => {
  const options = (fetchImpl: typeof globalThis.fetch) => ({
    baseUrl: 'http://127.0.0.1:4000',
    deadlineMs: 1_000,
    fetch: fetchImpl,
  });

  it('resolves one identity profile from the exact route', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe(
        `http://127.0.0.1:4000/v1/identities/${encodeURIComponent(IDENTITY_ID)}/profile`,
      );
      return new Response(JSON.stringify(response()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    const result = await fetchIdentityProfile(options(fetchImpl), { identityId: IDENTITY_ID });
    expect(result).toMatchObject({
      endpoint: 'http://127.0.0.1:4000',
      kind: 'ready',
      value: { identity: { identityId: IDENTITY_ID } },
    });
  });

  it('maps 404, invalid payloads, and bad configuration to honest results', async () => {
    const notFound = await fetchIdentityProfile(
      options(async () => new Response('{}', { status: 404 })),
      { identityId: IDENTITY_ID },
    );
    expect(notFound).toEqual({ kind: 'not-found' });

    const invalid = await fetchIdentityProfile(
      options(
        async () =>
          new Response(JSON.stringify(response({ canonical: true })), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
      { identityId: IDENTITY_ID },
    );
    expect(invalid).toMatchObject({ kind: 'degraded', reason: 'invalid-response' });

    const misconfigured = await fetchIdentityProfile(
      options(async () => new Response('{}')),
      {
        identityId: 'not-an-identity',
      },
    );
    expect(misconfigured).toMatchObject({ kind: 'degraded', reason: 'invalid-configuration' });
  });
});
