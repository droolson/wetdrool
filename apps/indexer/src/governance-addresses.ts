import { address, getProgramDerivedAddress } from '@solana/kit';
import bs58 from 'bs58';

import { decodeMultibaseBase64Url } from '@wetdrool/protocol';

const PDA_PREFIX = Uint8Array.from(Buffer.from('wetdrool', 'ascii'));
const PDA_VERSION = Uint8Array.of(1);
const PROPOSAL_SEED = Uint8Array.from(Buffer.from('proposal', 'ascii'));
const VOTE_SEED = Uint8Array.from(Buffer.from('vote', 'ascii'));
const MEMBERSHIP_SEED = Uint8Array.from(Buffer.from('membership', 'ascii'));

export async function deriveCommunityMembershipAddress(
  programId: string,
  communityAddress: string,
  memberIdentityAddress: string,
): Promise<string> {
  const [membershipAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      MEMBERSHIP_SEED,
      bs58.decode(communityAddress),
      bs58.decode(memberIdentityAddress),
    ],
  });
  return membershipAddress;
}

export async function deriveGovernanceProposalAddress(
  programId: string,
  communityAddress: string,
  manifestHash: string,
): Promise<string> {
  const [proposalAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      PROPOSAL_SEED,
      bs58.decode(communityAddress),
      decodeMultibaseBase64Url(manifestHash, 32),
    ],
  });
  return proposalAddress;
}

export async function deriveGovernanceVoteAddress(
  programId: string,
  proposalAddress: string,
  voterIdentityAddress: string,
): Promise<string> {
  const [voteAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      VOTE_SEED,
      bs58.decode(proposalAddress),
      bs58.decode(voterIdentityAddress),
    ],
  });
  return voteAddress;
}
