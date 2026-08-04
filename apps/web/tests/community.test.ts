import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  communityGovernanceStrategyCommitment,
} from '@wetdrool/protocol';

import { getCommunityDetail, getCommunityDirectory } from '../lib/community';

const NETWORK_ID =
  'droolnet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const IDENTITY_ID =
  'wetdroolid:v1:droolnet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD:8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE';
const COMMUNITY_ADDRESS = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const DIGEST = `u${'A'.repeat(43)}`;
const CID = 'bafkreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm';
const CONTENT = {
  description: 'A public space for portable social software.',
  federationPolicy: {
    allow: [],
    block: [],
    mode: 'open',
  },
  governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  membershipPolicy: 'open',
  name: 'Portable Commons',
  replacement: { sequence: 1 },
  slug: 'portable-commons',
  visibility: 'public',
} as const;
const GOVERNANCE = communityGovernanceStrategyCommitment(CONTENT);

const COMMUNITY = {
  communityAddress: COMMUNITY_ADDRESS,
  content: CONTENT,
  createdAt: '2026-07-28T12:01:00.000Z',
  createdSlot: '42',
  creatorIdentityId: IDENTITY_ID,
  creatorSequence: '7',
  governanceStrategyHash: GOVERNANCE.digest,
  governanceVersion: GOVERNANCE.governanceVersion,
  latestActionAuthority: '11111111111111111111111111111111',
  membershipPolicy: 'open',
  membershipPolicySequence: '1',
  membershipSequence: '0',
  manifestAuthority: '11111111111111111111111111111111',
  manifestCid: CID,
  manifestCreatedAt: '2026-07-28T12:00:00.000Z',
  manifestGovernanceStrategyHash: GOVERNANCE.digest,
  manifestGovernanceVersion: GOVERNANCE.governanceVersion,
  manifestHash: DIGEST,
  manifestVerified: true,
  networkId: NETWORK_ID,
  objectId: `wetdroolobj:v1:community:${DIGEST}`,
  schemaVersion: 2,
  signingKeyId: `${IDENTITY_ID}#root/${'1'.repeat(32)}`,
  updatedAt: '2026-07-28T12:01:00.000Z',
  updatedSlot: '42',
  visibility: 'public',
} as const;

const META = {
  checkpointSlot: 50,
  indexedAt: '2026-07-28T12:02:00.000Z',
  source: 'DroolNet open indexer',
} as const;

const originalEnvironment = {
  INDEXER_NETWORK_ID: process.env['INDEXER_NETWORK_ID'],
  WOKENET_NETWORK_ID: process.env['WOKENET_NETWORK_ID'],
  WETDROOL_INDEXER_URL: process.env['WETDROOL_INDEXER_URL'],
};

function restoreEnvironment(): void {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = value;
    }
  }
}

describe.sequential('web community provider wrapper', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnvironment();
  });

  it('degrades honestly when the server-only network scope is absent', async () => {
    process.env['WETDROOL_INDEXER_URL'] = 'https://indexer.example/';
    delete process.env['WOKENET_NETWORK_ID'];
    delete process.env['INDEXER_NETWORK_ID'];
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);

    await expect(getCommunityDirectory({})).resolves.toMatchObject({
      detail: expect.stringContaining('WOKENET_NETWORK_ID'),
      kind: 'degraded',
      reason: 'unconfigured',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an invalid address or cursor before reading or contacting a provider', async () => {
    delete process.env['WETDROOL_INDEXER_URL'];
    delete process.env['WOKENET_NETWORK_ID'];
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal('fetch', fetch);

    await expect(getCommunityDetail('portable-commons')).resolves.toMatchObject({
      kind: 'degraded',
      reason: 'invalid-response',
    });
    await expect(getCommunityDirectory({ cursor: 'not+opaque' })).resolves.toMatchObject({
      kind: 'degraded',
      reason: 'invalid-response',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('requests an explicitly scoped public directory without exposing path secrets', async () => {
    process.env['WETDROOL_INDEXER_URL'] =
      'https://indexer.example/operator/?access_token=not-forwarded';
    process.env['WOKENET_NETWORK_ID'] = NETWORK_ID;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        canonical: false,
        communities: [COMMUNITY],
        meta: META,
        network: NETWORK_ID,
        nextCursor: null,
        projection: 'droolnet-open-indexer',
        recipe: 'community-directory-v1',
      }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(getCommunityDirectory({ cursor: 'page_1' })).resolves.toMatchObject({
      endpoint: 'https://indexer.example',
      kind: 'ready',
      value: {
        communities: [{ communityAddress: COMMUNITY_ADDRESS }],
        network: NETWORK_ID,
      },
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://indexer.example/operator/v1/communities?network=${encodeURIComponent(
        NETWORK_ID,
      )}&limit=20&before=page_1`,
    );
  });

  it('maps exact-address 404 to a privacy-preserving not-found state', async () => {
    process.env['WETDROOL_INDEXER_URL'] = 'https://indexer.example/';
    process.env['WOKENET_NETWORK_ID'] = NETWORK_ID;
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ error: { code: 'not-found' } }, { status: 404 }),
    );
    vi.stubGlobal('fetch', fetch);

    await expect(getCommunityDetail(COMMUNITY_ADDRESS)).resolves.toEqual({
      kind: 'not-found',
    });
  });

  it('accepts exact verified detail and rejects a provider-added membership roster', async () => {
    process.env['WETDROOL_INDEXER_URL'] = 'https://indexer.example/';
    process.env['WOKENET_NETWORK_ID'] = NETWORK_ID;
    const readyResponse = {
      canonical: false,
      community: COMMUNITY,
      meta: META,
      network: NETWORK_ID,
      projection: 'droolnet-open-indexer',
    } as const;
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(readyResponse))
      .mockResolvedValueOnce(
        Response.json({
          ...readyResponse,
          memberships: [{ memberIdentityId: IDENTITY_ID }],
        }),
      );
    vi.stubGlobal('fetch', fetch);

    await expect(getCommunityDetail(COMMUNITY_ADDRESS)).resolves.toMatchObject({
      endpoint: 'https://indexer.example',
      kind: 'ready',
      value: {
        community: {
          communityAddress: COMMUNITY_ADDRESS,
          manifestVerified: true,
        },
      },
    });
    await expect(getCommunityDetail(COMMUNITY_ADDRESS)).resolves.toMatchObject({
      kind: 'degraded',
      reason: 'invalid-response',
    });
  });
});
