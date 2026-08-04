import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';

import { verifySolanaDeployment, type SolanaDeploymentRpc } from '../src/deployment';
import type { MobileRuntimeConfig } from '../src/runtime-config';

const genesisHash = '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB';
const programId = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';

function config(deployed = true): MobileRuntimeConfig {
  return {
    chain: 'solana:devnet',
    deployment: deployed
      ? {
          expectedGenesisHash: genesisHash,
          id: `droolnet:v1:${genesisHash}:${programId}`,
          programId,
        }
      : null,
    indexerUrl: deployed ? 'https://indexer.example.test/' : null,
    rpcUrl: 'https://rpc.example.test/',
  };
}

function rpc(
  overrides: Partial<{
    executable: boolean;
    genesisHash: string;
    missing: boolean;
    reject: boolean;
    slot: number;
  }> = {},
): SolanaDeploymentRpc {
  return {
    async getAccountInfo() {
      if (overrides.reject === true) throw new Error('offline');
      if (overrides.missing === true) return null;
      return {
        executable: overrides.executable ?? true,
        owner: new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'),
      };
    },
    async getGenesisHash() {
      if (overrides.reject === true) throw new Error('offline');
      return overrides.genesisHash ?? genesisHash;
    },
    async getSlot() {
      if (overrides.reject === true) throw new Error('offline');
      return overrides.slot ?? 42;
    },
  };
}

describe('verifySolanaDeployment', () => {
  it('keeps program behavior disabled when no deployment is configured', async () => {
    await expect(verifySolanaDeployment(config(false), rpc())).resolves.toMatchObject({
      kind: 'unconfigured',
    });
  });

  it('verifies genesis, executable program account, and finalized slot', async () => {
    await expect(verifySolanaDeployment(config(), rpc())).resolves.toEqual({
      genesisHash,
      kind: 'verified',
      owner: 'BPFLoaderUpgradeab1e11111111111111111111111',
      programId,
      slot: 42,
    });
  });

  it('rejects the wrong Solana genesis or a non-executable account', async () => {
    await expect(
      verifySolanaDeployment(config(), rpc({ genesisHash: programId })),
    ).resolves.toMatchObject({ kind: 'rejected' });
    await expect(
      verifySolanaDeployment(config(), rpc({ executable: false })),
    ).resolves.toMatchObject({ kind: 'rejected' });
  });

  it('fails closed when the RPC is unavailable', async () => {
    await expect(verifySolanaDeployment(config(), rpc({ reject: true }))).resolves.toMatchObject({
      kind: 'unavailable',
    });
  });
});
