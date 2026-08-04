import { deriveRandomWokeName } from '@wetdrool/protocol';
import { derivePrimaryWokeIdentityCoordinates } from '@wetdrool/sdk';
import bs58 from 'bs58';
import { describe, expect, it, vi } from 'vitest';

import { encodeBase64Url } from '../lib/auth/passkey-codec';
import type { LocalnetPublicationRuntime } from '../lib/localnet-publication-config';
import {
  createSolanaDestinationCache,
  deriveSolanaDestinationDisclosure,
  readSynchronizedRootPublicKey,
  SolanaDestinationError,
} from '../lib/solana-destination';

const GENESIS = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const PROGRAM = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const NETWORK = `droolnet:v1:${GENESIS}:${PROGRAM}`;
const PUBLIC_KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const PUBLIC_KEY = encodeBase64Url(PUBLIC_KEY_BYTES);
const ROOT = bs58.encode(PUBLIC_KEY_BYTES);
const OTHER_PUBLIC_KEY = encodeBase64Url(new Uint8Array(32).fill(7));

const RUNTIME: LocalnetPublicationRuntime = {
  authServiceUrl: 'http://127.0.0.1:8787',
  context: {
    endpoint: 'http://127.0.0.1:8899',
    genesisHash: GENESIS,
    programAddress: PROGRAM,
  },
  indexerUrl: 'http://127.0.0.1:3002',
  networkId: NETWORK,
  targetBalanceLamports: 100_000_000,
};

function bundle(publicKey: string, credentialId = 'credential-1') {
  return {
    credentialId,
    bundle: { publicKey },
    updatedAt: '2026-07-29T12:00:00.000Z',
  };
}

describe('readSynchronizedRootPublicKey', () => {
  it('returns the one key every synchronized wrapper agrees on', () => {
    expect(
      readSynchronizedRootPublicKey([bundle(PUBLIC_KEY), bundle(PUBLIC_KEY, 'credential-2')]),
    ).toBe(PUBLIC_KEY);
  });

  it('fails closed on absence, disagreement, and malformed wrappers', () => {
    expect(() => readSynchronizedRootPublicKey([])).toThrowError(
      expect.objectContaining({ code: 'bundle-missing' }),
    );
    expect(() =>
      readSynchronizedRootPublicKey([bundle(PUBLIC_KEY), bundle(OTHER_PUBLIC_KEY, 'credential-2')]),
    ).toThrowError(expect.objectContaining({ code: 'bundle-conflict' }));
    for (const malformed of [
      { credentialId: 'credential-1', bundle: null, updatedAt: '2026-07-29T12:00:00.000Z' },
      { credentialId: 'credential-1', bundle: {}, updatedAt: '2026-07-29T12:00:00.000Z' },
      bundle('not base64url !!'),
      bundle(encodeBase64Url(new Uint8Array(16))),
    ]) {
      expect(() => readSynchronizedRootPublicKey([malformed])).toThrowError(
        expect.objectContaining({ code: 'invalid-public-key' }),
      );
    }
  });
});

describe('deriveSolanaDestinationDisclosure', () => {
  it('derives the exact root, identity account, identity ID, and .drool candidate', async () => {
    const disclosure = await deriveSolanaDestinationDisclosure({
      accountId: 'account-1',
      publicKey: PUBLIC_KEY,
      runtime: RUNTIME,
    });
    const coordinates = await derivePrimaryWokeIdentityCoordinates(RUNTIME.context, ROOT);
    expect(disclosure).toMatchObject({
      binding: {
        accountId: 'account-1',
        networkId: NETWORK,
        programAddress: PROGRAM,
        publicKey: PUBLIC_KEY,
      },
      genesisHash: GENESIS,
      identityAddress: coordinates.identityAddress,
      identityId: `wetdroolid:v1:${NETWORK}:${coordinates.identityAddress}`,
      networkId: NETWORK,
      programAddress: PROGRAM,
      rootAuthority: ROOT,
      wokeNameCandidate: deriveRandomWokeName(ROOT).name,
    });
    expect(disclosure.wokeNameCandidate).toMatch(/^anon_[0-9a-z]{16}\.drool$/u);
    expect(Object.isFrozen(disclosure)).toBe(true);
  });

  it('rejects a key that is not one canonical 32-byte Solana authority', async () => {
    for (const publicKey of ['not base64url !!', encodeBase64Url(new Uint8Array(31))]) {
      await expect(
        deriveSolanaDestinationDisclosure({ accountId: 'account-1', publicKey, runtime: RUNTIME }),
      ).rejects.toBeInstanceOf(SolanaDestinationError);
    }
  });
});

describe('createSolanaDestinationCache', () => {
  it('reuses a disclosure only while every binding coordinate matches exactly', async () => {
    const derive = vi.fn(deriveSolanaDestinationDisclosure);
    const cache = createSolanaDestinationCache({ derive });
    const input = { accountId: 'account-1', publicKey: PUBLIC_KEY, runtime: RUNTIME };

    const first = await cache.resolve(input);
    const second = await cache.resolve(input);
    expect(second).toBe(first);
    expect(derive).toHaveBeenCalledTimes(1);

    const rotatedKey = await cache.resolve({ ...input, publicKey: OTHER_PUBLIC_KEY });
    expect(rotatedKey).not.toBe(first);
    expect(rotatedKey.rootAuthority).not.toBe(first.rootAuthority);
    expect(derive).toHaveBeenCalledTimes(2);

    await cache.resolve({ ...input, accountId: 'account-2' });
    expect(derive).toHaveBeenCalledTimes(3);

    const otherProgram = bs58.encode(new Uint8Array(32).fill(9));
    await cache.resolve({
      ...input,
      runtime: {
        ...RUNTIME,
        context: { ...RUNTIME.context, programAddress: otherProgram },
        networkId: `droolnet:v1:${GENESIS}:${otherProgram}`,
      },
    });
    expect(derive).toHaveBeenCalledTimes(4);
  });

  it('discards the cached disclosure on invalidate and on a failed re-derivation', async () => {
    const derive = vi.fn(deriveSolanaDestinationDisclosure);
    const cache = createSolanaDestinationCache({ derive });
    const input = { accountId: 'account-1', publicKey: PUBLIC_KEY, runtime: RUNTIME };

    await cache.resolve(input);
    cache.invalidate();
    expect(cache.peek()).toBeNull();
    await cache.resolve(input);
    expect(derive).toHaveBeenCalledTimes(2);

    await expect(cache.resolve({ ...input, publicKey: 'not base64url !!' })).rejects.toBeInstanceOf(
      SolanaDestinationError,
    );
    expect(cache.peek()).toBeNull();
  });
});
