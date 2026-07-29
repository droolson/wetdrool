import { Connection, PublicKey, type Commitment } from '@solana/web3.js';

import type { MobileRuntimeConfig } from './runtime-config';

export type SolanaDeploymentVerification =
  | {
      readonly detail: string;
      readonly kind: 'rejected' | 'unavailable' | 'unconfigured';
    }
  | {
      readonly genesisHash: string;
      readonly kind: 'verified';
      readonly owner: string;
      readonly programId: string;
      readonly slot: number;
    };

export interface SolanaDeploymentRpc {
  getAccountInfo(
    publicKey: PublicKey,
    commitment: Commitment,
  ): Promise<{ readonly executable: boolean; readonly owner: PublicKey } | null>;
  getGenesisHash(): Promise<string>;
  getSlot(commitment: Commitment): Promise<number>;
}

export async function verifySolanaDeployment(
  config: MobileRuntimeConfig,
  rpc: SolanaDeploymentRpc = new Connection(config.rpcUrl, 'finalized'),
): Promise<SolanaDeploymentVerification> {
  if (config.deployment === null) {
    return {
      detail:
        'No public WokeSocial Solana program deployment is configured. Wallet connection remains available, but protocol reads and writes stay disabled.',
      kind: 'unconfigured',
    };
  }

  const programPublicKey = new PublicKey(config.deployment.programId);
  try {
    const [genesisHash, programAccount, slot] = await Promise.all([
      rpc.getGenesisHash(),
      rpc.getAccountInfo(programPublicKey, 'finalized'),
      rpc.getSlot('finalized'),
    ]);
    if (genesisHash !== config.deployment.expectedGenesisHash) {
      return {
        detail:
          'The configured Solana RPC belongs to a different genesis than the WokeNet deployment ID.',
        kind: 'rejected',
      };
    }
    if (programAccount === null) {
      return {
        detail: 'The configured WokeSocial program account does not exist on this Solana cluster.',
        kind: 'rejected',
      };
    }
    if (!programAccount.executable) {
      return {
        detail: 'The configured WokeSocial program account is not executable.',
        kind: 'rejected',
      };
    }
    if (!Number.isSafeInteger(slot) || slot < 0) {
      return {
        detail: 'The Solana RPC returned an invalid finalized slot.',
        kind: 'rejected',
      };
    }
    return {
      genesisHash,
      kind: 'verified',
      owner: programAccount.owner.toBase58(),
      programId: config.deployment.programId,
      slot,
    };
  } catch {
    return {
      detail:
        'The configured Solana deployment could not be verified at finalized commitment. No program action was enabled.',
      kind: 'unavailable',
    };
  }
}
