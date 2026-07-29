import { describe, expect, it, vi } from 'vitest';

import { digestSha256Multibase, utf8 } from '@wokesocial/protocol';

import { parseWokeNameResolution, resolveWokeName } from '../src/woke-name.js';
import { IndexerPayloadError } from '../src/contract.js';

const NETWORK =
  'wokenet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const IDENTITY_ADDRESS = '8qbHbw2BbbTHBW1sbeqakYXVzPpQ2R2moVnuhjXGhfE';
const ROOT = '11111111111111111111111111111111';
const CLAIM = 'SysvarRent111111111111111111111111111111111';
const NAME = 'river_chen.woke';
const HANDLE = 'river_chen';

function resolution(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    canonical: false,
    projection: 'wokenet-open-indexer',
    network: NETWORK,
    namespace: 'woke',
    namespaceVersion: 1,
    name: NAME,
    handle: HANDLE,
    destination: {
      chain: 'solana',
      address: ROOT,
      nativeAddress: false,
      semantics: 'current-identity-root-authority',
    },
    identity: {
      identityId: `wokesocialid:v1:${NETWORK}:${IDENTITY_ADDRESS}`,
      identityAddress: IDENTITY_ADDRESS,
      rootAuthority: ROOT,
      rootRotationCount: '1',
      active: true,
      identitySequence: '3',
      updatedSlot: '44',
    },
    claim: {
      handleClaimAddress: CLAIM,
      handleHash: digestSha256Multibase(utf8(HANDLE)),
      identitySequence: '1',
      claimedSlot: '42',
      claimedAt: '2026-07-29T12:00:00.000Z',
    },
    meta: {
      checkpointSlot: 45,
      indexedAt: '2026-07-29T12:01:00.000Z',
      source: 'WokeNet open indexer',
    },
    ...overrides,
  };
}

describe('.woke resolver contract', () => {
  it('accepts a checkpoint-covered claim and current rotated Solana root', () => {
    expect(parseWokeNameResolution(resolution(), { name: NAME, network: NETWORK })).toMatchObject({
      name: NAME,
      handle: HANDLE,
      destination: { address: ROOT, nativeAddress: false },
      identity: { identitySequence: '3', rootRotationCount: '1' },
      claim: { identitySequence: '1', claimedSlot: '42' },
    });
  });

  it.each([
    ['scope substitution', { network: NETWORK.replace('4vJ9', '5vJ9') }],
    [
      'destination substitution',
      {
        destination: {
          ...(resolution()['destination'] as Record<string, unknown>),
          address: CLAIM,
        },
      },
    ],
    [
      'identity substitution',
      {
        identity: {
          ...(resolution()['identity'] as Record<string, unknown>),
          identityAddress: CLAIM,
        },
      },
    ],
    [
      'deactivated identity',
      {
        identity: {
          ...(resolution()['identity'] as Record<string, unknown>),
          active: false,
        },
      },
    ],
    [
      'handle commitment substitution',
      {
        claim: {
          ...(resolution()['claim'] as Record<string, unknown>),
          handleHash: digestSha256Multibase(utf8('other_handle')),
        },
      },
    ],
    [
      'stale checkpoint',
      {
        meta: {
          ...(resolution()['meta'] as Record<string, unknown>),
          checkpointSlot: 43,
        },
      },
    ],
    ['unexpected field', { injected: true }],
  ])('rejects %s', (_label, override) => {
    expect(() => parseWokeNameResolution(resolution(override))).toThrow(IndexerPayloadError);
  });

  it('fetches the canonical endpoint and distinguishes not-found from invalid data', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(resolution()), {
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: 'not-found' } }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(resolution({ handle: 'substituted' })), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    const options = {
      baseUrl: 'https://indexer.example/operator/',
      deadlineMs: 1_000,
      fetch,
    };

    await expect(
      resolveWokeName(options, { name: '@River_Chen.WOKE', network: NETWORK }),
    ).resolves.toMatchObject({ kind: 'ready', value: { name: NAME } });
    expect(fetch.mock.calls[0]?.[0]).toContain(
      `/operator/v1/woke-names/${NAME}?network=${encodeURIComponent(NETWORK)}`,
    );
    await expect(resolveWokeName(options, { name: NAME, network: NETWORK })).resolves.toEqual({
      kind: 'not-found',
    });
    await expect(resolveWokeName(options, { name: NAME, network: NETWORK })).resolves.toMatchObject(
      {
        kind: 'degraded',
        reason: 'invalid-response',
      },
    );
  });
});
