import { describe, expect, it } from 'vitest';

import { parseMobileRuntimeConfig, runtimeEndpointLabel } from '../src/runtime-config';

const genesisHash = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const programId = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const deploymentId = `droolnet:v1:${genesisHash}:${programId}`;

describe('parseMobileRuntimeConfig', () => {
  it('defaults to Solana devnet without inventing a program deployment', () => {
    expect(parseMobileRuntimeConfig({})).toEqual({
      kind: 'ready',
      value: {
        chain: 'solana:devnet',
        deployment: null,
        indexerUrl: null,
        rpcUrl: 'https://api.devnet.solana.com/',
      },
    });
  });

  it('binds an indexer to the exact Solana genesis and program deployment', () => {
    expect(
      parseMobileRuntimeConfig({
        EXPO_PUBLIC_SOLANA_CHAIN: 'solana:devnet',
        EXPO_PUBLIC_SOLANA_RPC_URL: 'https://rpc.example.test/solana?key=public',
        EXPO_PUBLIC_WETDROOL_DEPLOYMENT_ID: deploymentId,
        EXPO_PUBLIC_WETDROOL_INDEXER_URL: 'https://indexer.example.test/operator/',
        EXPO_PUBLIC_WETDROOL_PROGRAM_ID: programId,
      }),
    ).toEqual({
      kind: 'ready',
      value: {
        chain: 'solana:devnet',
        deployment: {
          expectedGenesisHash: genesisHash,
          id: deploymentId,
          programId,
        },
        indexerUrl: 'https://indexer.example.test/operator/',
        rpcUrl: 'https://rpc.example.test/solana?key=public',
      },
    });
  });

  it('rejects mismatched and partial deployment configuration', () => {
    expect(
      parseMobileRuntimeConfig({
        EXPO_PUBLIC_WETDROOL_DEPLOYMENT_ID: deploymentId,
      }),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      parseMobileRuntimeConfig({
        EXPO_PUBLIC_WETDROOL_DEPLOYMENT_ID: deploymentId.replace(programId, genesisHash),
        EXPO_PUBLIC_WETDROOL_PROGRAM_ID: programId,
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('rejects an indexer that cannot be bound to a configured deployment', () => {
    expect(
      parseMobileRuntimeConfig({
        EXPO_PUBLIC_WETDROOL_INDEXER_URL: 'https://indexer.example.test',
      }),
    ).toMatchObject({ kind: 'invalid' });
  });

  it('permits HTTP only when a development build opts in', () => {
    expect(
      parseMobileRuntimeConfig({
        EXPO_PUBLIC_SOLANA_RPC_URL: 'http://10.0.2.2:8899',
      }),
    ).toMatchObject({ kind: 'invalid' });
    expect(
      parseMobileRuntimeConfig(
        {
          EXPO_PUBLIC_SOLANA_RPC_URL: 'http://10.0.2.2:8899',
        },
        { allowInsecureDevelopmentEndpoints: true },
      ),
    ).toMatchObject({ kind: 'ready' });
  });

  it('rejects retired DroolNet RPC and network variables', () => {
    expect(
      parseMobileRuntimeConfig({
        EXPO_PUBLIC_WOKENET_RPC_URL: 'https://retired.example.test',
      }),
    ).toMatchObject({
      detail: expect.stringContaining('retired'),
      kind: 'invalid',
    });
  });
});

describe('runtimeEndpointLabel', () => {
  it('never includes a public query value in the display label', () => {
    expect(runtimeEndpointLabel('https://rpc.example.test/path?key=public')).toBe(
      'rpc.example.test',
    );
  });
});
