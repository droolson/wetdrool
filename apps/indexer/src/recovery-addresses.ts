import { address, getProgramDerivedAddress } from '@solana/kit';
import bs58 from 'bs58';

const PDA_PREFIX = Uint8Array.from(Buffer.from('wetdrool', 'ascii'));
const PDA_VERSION = Uint8Array.of(1);
const RECOVERY_POLICY_SEED = Uint8Array.from(Buffer.from('recovery_policy', 'ascii'));
const RECOVERY_REQUEST_SEED = Uint8Array.from(Buffer.from('recovery_request', 'ascii'));

export async function deriveRecoveryPolicyAddress(
  programId: string,
  identityAddress: string,
): Promise<string> {
  const [policyAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [PDA_PREFIX, PDA_VERSION, RECOVERY_POLICY_SEED, bs58.decode(identityAddress)],
  });
  return policyAddress;
}

export async function deriveRecoveryRequestAddress(
  programId: string,
  identityAddress: string,
  requestNonce: Uint8Array,
): Promise<string> {
  if (requestNonce.byteLength !== 16) {
    throw new Error('Recovery request nonce must contain exactly 16 bytes.');
  }
  const [requestAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      RECOVERY_REQUEST_SEED,
      bs58.decode(identityAddress),
      requestNonce,
    ],
  });
  return requestAddress;
}
