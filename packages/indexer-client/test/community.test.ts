import { describe, expect, it, vi } from 'vitest';

import {
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  communityGovernanceStrategyCommitment,
} from '@wokesocial/protocol';

import {
  fetchCommunityDetail,
  fetchCommunityDirectory,
  parseCommunityDetailResponse,
  parseCommunityDirectoryResponse,
  validateCommunityAddress,
  validateCommunityCursor,
} from '../src/community.js';
import { IndexerPayloadError, parseVerifiedCommunity } from '../src/contract.js';

const NETWORK_ID =
  'wokenet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const IDENTITY_ID =
  'wokesocialid:v1:wokenet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD:8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE';
const COMMUNITY_ADDRESS = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const SECOND_COMMUNITY_ADDRESS = '8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE';
const AUTHORITY = '11111111111111111111111111111111';
const DIGEST_A = `u${'A'.repeat(43)}`;
const DIGEST_B = `u${'B'.repeat(43)}`;
const CID = 'bafkreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm';

const PUBLIC_CONTENT = {
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
const COMMUNITY_GOVERNANCE_STRATEGY_HASH =
  communityGovernanceStrategyCommitment(PUBLIC_CONTENT).digest;

function verifiedCommunity(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const content =
    typeof overrides.content === 'object' && overrides.content !== null
      ? overrides.content
      : PUBLIC_CONTENT;
  const manifestHash =
    typeof overrides.manifestHash === 'string' ? overrides.manifestHash : DIGEST_A;
  const governance = communityGovernanceStrategyCommitment(
    content as { governance: typeof WOKENET_ONE_MEMBER_ONE_VOTE_V1 },
  );
  return {
    communityAddress: COMMUNITY_ADDRESS,
    content,
    createdAt: '2026-07-28T12:01:00.000Z',
    createdSlot: '42',
    creatorIdentityId: IDENTITY_ID,
    creatorSequence: '7',
    governanceStrategyHash: governance.digest,
    governanceVersion: governance.governanceVersion,
    latestActionAuthority: AUTHORITY,
    manifestAuthority: AUTHORITY,
    manifestCid: CID,
    manifestCreatedAt: '2026-07-28T12:00:00.000Z',
    manifestGovernanceStrategyHash: governance.digest,
    manifestGovernanceVersion: governance.governanceVersion,
    manifestHash,
    manifestVerified: true,
    networkId: NETWORK_ID,
    objectId: `wokesocialobj:v1:community:${manifestHash}`,
    schemaVersion: 2,
    signingKeyId: `${IDENTITY_ID}#root/${'1'.repeat(32)}`,
    updatedAt: '2026-07-28T12:01:00.000Z',
    updatedSlot: '42',
    ...overrides,
  };
}

function directoryResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    canonical: false,
    communities: [verifiedCommunity()],
    meta: {
      checkpointSlot: 50,
      indexedAt: '2026-07-28T12:02:00.000Z',
      source: 'WokeNet open indexer',
    },
    network: NETWORK_ID,
    nextCursor: null,
    projection: 'wokenet-open-indexer',
    recipe: 'community-directory-v1',
    ...overrides,
  };
}

function detailResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    canonical: false,
    community: verifiedCommunity(),
    meta: {
      checkpointSlot: 50,
      indexedAt: '2026-07-28T12:02:00.000Z',
      source: 'WokeNet open indexer',
    },
    network: NETWORK_ID,
    projection: 'wokenet-open-indexer',
    ...overrides,
  };
}

describe('verified community parsing', () => {
  it('accepts a v2 public manifest whose identity, object, and governance commitments agree', () => {
    const parsed = parseVerifiedCommunity(verifiedCommunity(), 'public');

    expect(parsed).toMatchObject({
      communityAddress: COMMUNITY_ADDRESS,
      content: {
        governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
        name: 'Portable Commons',
        visibility: 'public',
      },
      manifestHash: DIGEST_A,
      manifestVerified: true,
      networkId: NETWORK_ID,
      schemaVersion: 2,
    });
  });

  it.each([
    [
      'an unbound object ID',
      () => verifiedCommunity({ objectId: `wokesocialobj:v1:community:${DIGEST_B}` }),
    ],
    ['an unverified manifest', () => verifiedCommunity({ manifestVerified: false })],
    ['a legacy schema', () => verifiedCommunity({ schemaVersion: 1 })],
    [
      'a signing key from another identity',
      () =>
        verifiedCommunity({
          signingKeyId: `wokesocialid:v1:${NETWORK_ID}:${AUTHORITY}#root/${'1'.repeat(32)}`,
        }),
    ],
    [
      'a delegation signing key',
      () => verifiedCommunity({ signingKeyId: `${IDENTITY_ID}#delegation/${AUTHORITY}` }),
    ],
    [
      'a root signing key for another authority',
      () => verifiedCommunity({ signingKeyId: `${IDENTITY_ID}#root/${SECOND_COMMUNITY_ADDRESS}` }),
    ],
    [
      'a manifest authority that does not bind the signing key',
      () => verifiedCommunity({ manifestAuthority: SECOND_COMMUNITY_ADDRESS }),
    ],
    ['a zero creator sequence', () => verifiedCommunity({ creatorSequence: '0' })],
    [
      'a mismatched manifest governance digest',
      () => verifiedCommunity({ manifestGovernanceStrategyHash: DIGEST_B }),
    ],
    ['a stale update slot', () => verifiedCommunity({ createdSlot: '43', updatedSlot: '42' })],
    [
      'a membership roster',
      () => verifiedCommunity({ memberships: [{ identityId: IDENTITY_ID }] }),
    ],
    ['a legacy misleading authority field', () => verifiedCommunity({ authority: AUTHORITY })],
  ])('rejects %s', (_label, fixture) => {
    expect(() => parseVerifiedCommunity(fixture(), 'public')).toThrow(IndexerPayloadError);
  });

  it('allows direct unlisted detail but never unlisted or private discovery', () => {
    const unlisted = verifiedCommunity({
      content: { ...PUBLIC_CONTENT, visibility: 'unlisted' },
    });
    const privateCommunity = verifiedCommunity({
      content: { ...PUBLIC_CONTENT, visibility: 'private' },
    });

    expect(parseVerifiedCommunity(unlisted, 'direct').content.visibility).toBe('unlisted');
    expect(() => parseVerifiedCommunity(unlisted, 'public')).toThrow('only explicitly public');
    expect(() => parseVerifiedCommunity(privateCommunity, 'direct')).toThrow(
      'only public or unlisted',
    );
  });

  it('keeps the immutable manifest proof valid after current onchain governance advances', () => {
    const parsed = parseVerifiedCommunity(
      verifiedCommunity({
        latestActionAuthority: SECOND_COMMUNITY_ADDRESS,
        governanceStrategyHash: DIGEST_B,
        governanceVersion: 2,
      }),
      'public',
    );

    expect(parsed).toMatchObject({
      governanceStrategyHash: DIGEST_B,
      governanceVersion: 2,
      manifestAuthority: AUTHORITY,
      manifestGovernanceStrategyHash: COMMUNITY_GOVERNANCE_STRATEGY_HASH,
      manifestGovernanceVersion: 1,
    });
  });
});

describe('community directory and detail contracts', () => {
  it('accepts the exact public directory recipe and immutable descending order', () => {
    const newer = verifiedCommunity({
      communityAddress: SECOND_COMMUNITY_ADDRESS,
      createdAt: '2026-07-28T12:02:00.000Z',
      createdSlot: '43',
      updatedAt: '2026-07-28T12:02:00.000Z',
      updatedSlot: '43',
    });
    const parsed = parseCommunityDirectoryResponse(
      directoryResponse({ communities: [newer, verifiedCommunity()], nextCursor: 'opaque_2' }),
      { network: NETWORK_ID },
    );

    expect(parsed.communities.map(({ communityAddress }) => communityAddress)).toEqual([
      SECOND_COMMUNITY_ADDRESS,
      COMMUNITY_ADDRESS,
    ]);
    expect(parsed.nextCursor).toBe('opaque_2');
    expect(parsed.recipe).toBe('community-directory-v1');
  });

  it.each([
    ['provider-invented recipe', () => directoryResponse({ recipe: 'popular-communities-v1' })],
    [
      'wrong ordering',
      () => {
        const newer = verifiedCommunity({
          communityAddress: SECOND_COMMUNITY_ADDRESS,
          createdAt: '2026-07-28T12:02:00.000Z',
          createdSlot: '43',
          updatedAt: '2026-07-28T12:02:00.000Z',
          updatedSlot: '43',
        });
        return directoryResponse({ communities: [verifiedCommunity(), newer] });
      },
    ],
    [
      'duplicate address',
      () => directoryResponse({ communities: [verifiedCommunity(), verifiedCommunity()] }),
    ],
    ['cursor on an empty page', () => directoryResponse({ communities: [], nextCursor: 'more' })],
    [
      'nonpublic directory entry',
      () =>
        directoryResponse({
          communities: [
            verifiedCommunity({ content: { ...PUBLIC_CONTENT, visibility: 'unlisted' } }),
          ],
        }),
    ],
    [
      'membership roster beside directory rows',
      () => directoryResponse({ memberships: [{ identityId: IDENTITY_ID }] }),
    ],
  ])('rejects %s', (_label, fixture) => {
    expect(() => parseCommunityDirectoryResponse(fixture(), { network: NETWORK_ID })).toThrow(
      IndexerPayloadError,
    );
  });

  it('accepts exact-address unlisted detail and rejects a scope change', () => {
    const community = verifiedCommunity({
      content: { ...PUBLIC_CONTENT, visibility: 'unlisted' },
    });
    expect(
      parseCommunityDetailResponse(detailResponse({ community }), {
        address: COMMUNITY_ADDRESS,
        network: NETWORK_ID,
      }).community.content.visibility,
    ).toBe('unlisted');
    expect(() =>
      parseCommunityDetailResponse(detailResponse({ community }), {
        address: SECOND_COMMUNITY_ADDRESS,
        network: NETWORK_ID,
      }),
    ).toThrow('changed its requested scope');
  });

  it('validates address and opaque cursor URL state locally', () => {
    expect(validateCommunityAddress(COMMUNITY_ADDRESS)).toEqual({
      address: COMMUNITY_ADDRESS,
      kind: 'valid',
    });
    expect(validateCommunityAddress('portable-commons')).toMatchObject({ kind: 'invalid' });
    expect(validateCommunityCursor('abc_DEF-123')).toEqual({
      cursor: 'abc_DEF-123',
      kind: 'valid',
    });
    expect(validateCommunityCursor('not+opaque')).toMatchObject({ kind: 'invalid' });
  });
});

describe('community indexer requests', () => {
  const options = (fetch: typeof globalThis.fetch) => ({
    baseUrl: 'https://indexer.example/operator/',
    deadlineMs: 1_000,
    fetch,
  });

  it('requests an explicit-network directory page and preserves its opaque cursor', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(directoryResponse({ nextCursor: 'next_page' })),
    );

    const result = await fetchCommunityDirectory(options(fetch), {
      cursor: 'current_page',
      limit: 20,
      network: NETWORK_ID,
    });

    expect(result).toMatchObject({
      endpoint: 'https://indexer.example',
      kind: 'ready',
      value: { nextCursor: 'next_page' },
    });
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `https://indexer.example/operator/v1/communities?network=${encodeURIComponent(
        NETWORK_ID,
      )}&limit=20&before=current_page`,
    );
  });

  it('does not transmit malformed address, cursor, network, or limit values', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    await expect(
      fetchCommunityDetail(options(fetch), {
        address: 'portable-commons',
        network: NETWORK_ID,
      }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
    await expect(
      fetchCommunityDirectory(options(fetch), {
        cursor: 'not+opaque',
        network: NETWORK_ID,
      }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
    await expect(
      fetchCommunityDirectory(options(fetch), {
        limit: 51,
        network: NETWORK_ID,
      }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
    await expect(
      fetchCommunityDirectory(options(fetch), {
        network: 'devnet',
      }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps exact detail 404 to not-found without accepting a body', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ memberships: [{ member: IDENTITY_ID }] }, { status: 404 }),
    );

    await expect(
      fetchCommunityDetail(options(fetch), {
        address: COMMUNITY_ADDRESS,
        network: NETWORK_ID,
      }),
    ).resolves.toEqual({ kind: 'not-found' });
  });

  it('fails closed when a provider adds roster data to detail', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        ...detailResponse(),
        memberships: [{ memberIdentityId: IDENTITY_ID }],
      }),
    );

    await expect(
      fetchCommunityDetail(options(fetch), {
        address: COMMUNITY_ADDRESS,
        network: NETWORK_ID,
      }),
    ).resolves.toMatchObject({ kind: 'degraded', reason: 'invalid-response' });
  });
});
