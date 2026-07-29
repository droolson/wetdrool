import { describe, expect, it } from 'vitest';

import { getLocalnetPublicationConfig } from '../lib/localnet-publication-config';

const GENESIS = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const PROGRAM = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const NETWORK = `wokenet:v1:${GENESIS}:${PROGRAM}`;

function environment(
  overrides: Record<string, string | undefined> = {},
): Record<string, string | undefined> {
  return {
    APP_ENV: 'development',
    NEXT_PUBLIC_AUTH_SERVICE_URL: 'http://localhost:4300',
    NEXT_PUBLIC_INDEXER_URL: 'http://127.0.0.1:4000',
    NEXT_PUBLIC_PROGRAM_ID: PROGRAM,
    NEXT_PUBLIC_SOLANA_CLUSTER: 'localnet',
    NEXT_PUBLIC_SOLANA_RPC_URL: 'http://127.0.0.1:8899',
    NODE_ENV: 'test',
    CONTENT_STORAGE_PATH: '/tmp/wokesocial-localnet-publication-cas',
    WOKENET_NETWORK_ID: NETWORK,
    WOKESOCIAL_LOCAL_CAS_MODE: 'localnet',
    WOKESOCIAL_LOCAL_CAS_ORIGIN: 'http://localhost:3000',
    WOKESOCIAL_LOCALNET_WRITES: '1',
    ...overrides,
  };
}

describe('localnet publication configuration', () => {
  it('returns the exact loopback deployment only after explicit development opt-in', () => {
    expect(getLocalnetPublicationConfig(environment())).toEqual({
      kind: 'available',
      runtime: {
        authServiceUrl: 'http://localhost:4300',
        context: {
          endpoint: 'http://127.0.0.1:8899/',
          genesisHash: GENESIS,
          programAddress: PROGRAM,
        },
        indexerUrl: 'http://127.0.0.1:4000/',
        networkId: NETWORK,
        targetBalanceLamports: 100_000_000,
      },
    });
  });

  it.each([
    ['missing opt-in', { WOKESOCIAL_LOCALNET_WRITES: '0' }],
    ['missing CAS opt-in', { WOKESOCIAL_LOCAL_CAS_MODE: undefined }],
    ['relative CAS storage', { CONTENT_STORAGE_PATH: '.local/content' }],
    ['remote CAS origin', { WOKESOCIAL_LOCAL_CAS_ORIGIN: 'https://woke.social' }],
    ['production mode', { NODE_ENV: 'production' }],
    ['remote RPC', { NEXT_PUBLIC_SOLANA_RPC_URL: 'https://api.devnet.solana.com' }],
    ['remote indexer', { NEXT_PUBLIC_INDEXER_URL: 'https://indexer.example' }],
    ['remote authentication', { NEXT_PUBLIC_AUTH_SERVICE_URL: 'https://auth.example' }],
    ['devnet label', { NEXT_PUBLIC_SOLANA_CLUSTER: 'devnet' }],
    ['embedded credentials', { NEXT_PUBLIC_SOLANA_RPC_URL: 'http://user:secret@localhost:8899' }],
    ['network mismatch', { NEXT_PUBLIC_PROGRAM_ID: GENESIS }],
  ])('fails closed for %s', (_label, overrides) => {
    expect(getLocalnetPublicationConfig(environment(overrides))).toMatchObject({
      kind: 'unavailable',
    });
  });

  it('rejects the legacy redirect-only host as a remote endpoint by requiring loopback', () => {
    expect(
      getLocalnetPublicationConfig(
        environment({ NEXT_PUBLIC_AUTH_SERVICE_URL: 'https://sociallywoke.com' }),
      ),
    ).toMatchObject({ kind: 'unavailable' });
  });
});
