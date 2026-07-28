import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import {
  BN,
  EventParser,
  web3,
  type AnchorProvider,
} from "@coral-xyz/anchor";

import {
  createIdentity,
  digest,
  nonce,
  type IdentityFixture,
  type Phase2Context,
} from "./phase2_test_helpers";

const { PublicKey, SystemProgram } = web3;

const PDA_PREFIX = Buffer.from("wokesocial");
const PDA_VERSION = Buffer.from([1]);
const COMMUNITY_SEED = Buffer.from("community");
const MEMBERSHIP_SEED = Buffer.from("membership");
const PROPOSAL_SEED = Buffer.from("proposal");
const VOTE_SEED = Buffer.from("vote");

export const GOVERNANCE_PROPOSAL_SPACE = 463;
export const GOVERNANCE_VOTE_SPACE = 195;
export const GOVERNANCE_QUORUM_BPS = 5_000;
export const GOVERNANCE_APPROVAL_BPS = 5_001;
export const COMMUNITY_ROLE_MEMBER = 1;
export const SCOPE_PROFILE = 1;
export const SCOPE_SOCIAL = 1 << 2;
export const SCOPE_COMMUNITY = 1 << 3;
export const GOVERNANCE_STRATEGY =
  "wokesocial:governance:one-active-member-one-vote:v1;" +
  "quorum-bps=5000;approval-bps=5001;abstain=quorum-only";
export const GOVERNANCE_STRATEGY_HASH = Array.from(
  createHash("sha256").update(GOVERNANCE_STRATEGY).digest(),
);

export interface GovernanceCommunityFixture {
  address: web3.PublicKey;
  creator: IdentityFixture;
  communityNonce: number[];
  members: GovernanceMemberFixture[];
}

export interface GovernanceMemberFixture extends IdentityFixture {
  membership: web3.PublicKey;
}

export function deriveCommunity(
  programId: web3.PublicKey,
  creatorIdentity: web3.PublicKey,
  communityNonce: number[],
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      COMMUNITY_SEED,
      creatorIdentity.toBuffer(),
      Buffer.from(communityNonce),
    ],
    programId,
  )[0];
}

export function deriveMembership(
  programId: web3.PublicKey,
  community: web3.PublicKey,
  memberIdentity: web3.PublicKey,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      MEMBERSHIP_SEED,
      community.toBuffer(),
      memberIdentity.toBuffer(),
    ],
    programId,
  )[0];
}

export function deriveProposal(
  programId: web3.PublicKey,
  community: web3.PublicKey,
  manifestHash: number[],
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      PROPOSAL_SEED,
      community.toBuffer(),
      Buffer.from(manifestHash),
    ],
    programId,
  )[0];
}

export function deriveVote(
  programId: web3.PublicKey,
  proposal: web3.PublicKey,
  voterIdentity: web3.PublicKey,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      VOTE_SEED,
      proposal.toBuffer(),
      voterIdentity.toBuffer(),
    ],
    programId,
  )[0];
}

export async function createGovernanceCommunity(
  context: Phase2Context,
  nonceStart: number,
  memberCount: number,
  governanceStrategyHash: number[] = GOVERNANCE_STRATEGY_HASH,
): Promise<GovernanceCommunityFixture> {
  const creator = await createIdentity(context, nonceStart);
  const communityNonce = nonce(nonceStart + 1);
  const address = deriveCommunity(
    context.program.programId,
    creator.address,
    communityNonce,
  );
  await context.program.methods
    .createCommunity({
      expectedCreatorSequence: new BN(0),
      communityNonce,
      manifestHash: digest(`governance-community-${nonceStart}`),
      manifestUri: `local://sha256/governance-community-${nonceStart}`,
      governanceVersion: 1,
      governanceStrategyHash,
    })
    .accountsStrict({
      config: context.config,
      creatorIdentity: creator.address,
      community: address,
      rootAuthority: creator.authority.publicKey,
      payer: context.provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([creator.authority])
    .rpc();

  const members: GovernanceMemberFixture[] = [];
  for (let index = 0; index < memberCount; index += 1) {
    const memberIdentity = await createIdentity(
      context,
      nonceStart + 10 + index,
    );
    const membership = deriveMembership(
      context.program.programId,
      address,
      memberIdentity.address,
    );
    await context.program.methods
      .setCommunityMembership({
        expectedAuthoritySequence: new BN(index + 1),
        active: true,
        roles: COMMUNITY_ROLE_MEMBER,
      })
      .accountsStrict({
        config: context.config,
        creatorIdentity: creator.address,
        community: address,
        memberIdentity: memberIdentity.address,
        membership,
        authority: creator.authority.publicKey,
        payer: context.provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
        delegation: null,
      })
      .signers([creator.authority])
      .rpc();
    members.push({ ...memberIdentity, membership });
  }

  return { address, creator, communityNonce, members };
}

export async function waitUntilSlot(
  provider: AnchorProvider,
  targetSlot: number,
): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (
    (await provider.connection.getSlot("confirmed")) < targetSlot &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    (await provider.connection.getSlot("confirmed")) >= targetSlot,
    `local validator did not reach slot ${targetSlot}`,
  );
}

export async function parsedEvents(
  context: Phase2Context,
  signature: string,
): Promise<{ data: unknown; name: string }[]> {
  let transaction: Awaited<
    ReturnType<AnchorProvider["connection"]["getTransaction"]>
  > = null;
  for (let attempt = 0; attempt < 30 && transaction === null; attempt += 1) {
    transaction = await context.provider.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (transaction === null) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.ok(transaction, `transaction ${signature} was not available`);
  const logs = transaction.meta?.logMessages;
  assert.ok(logs, `transaction ${signature} has no logs`);
  const parser = new EventParser(
    context.program.programId,
    context.program.coder,
  );
  return Array.from(parser.parseLogs(logs));
}
