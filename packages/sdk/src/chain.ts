import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';

import {
  identityIdSchema,
  networkIdSchema,
  solanaPublicKeySchema,
  type ProfilePayload,
} from '@wokesocial/protocol';

const PDA_PREFIX = new TextEncoder().encode('wokesocial');
const PDA_VERSION = Uint8Array.of(1);
const COMMUNITY_SEED = new TextEncoder().encode('community');
const MEMBERSHIP_SEED = new TextEncoder().encode('membership');
const ADDRESS_ENCODER = getAddressEncoder();

export interface AnchorManifestInput {
  readonly identity: string;
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: Uint8Array;
}

export interface AnchorProfileInput extends AnchorManifestInput {
  readonly profileSchemaVersion: ProfilePayload['schemaVersion'];
}

export interface AnchorCommunityInput extends AnchorManifestInput {
  /** Exact PDA derived from the creator identity and signed community nonce. */
  readonly communityAddress: string;
  readonly communityNonce: Uint8Array;
  readonly governanceVersion: number;
  readonly governanceStrategyHash: Uint8Array;
  /** Effective onchain join policy bound to the signed community manifest. */
  readonly membershipPolicy: 'open' | 'request' | 'invite';
  /** Effective onchain discovery boundary bound to the signed community manifest. */
  readonly visibility: 'public' | 'unlisted' | 'private';
}

export interface AnchorCommunityMembershipInput extends AnchorManifestInput {
  readonly action: 'join' | 'leave';
  readonly communityAddress: string;
  readonly expectedCommunityMembershipSequence: bigint;
  readonly expectedMemberIdentitySequence: bigint;
  readonly expectedMembershipPolicySequence: bigint;
  readonly expectedMembershipStateSequence: bigint;
  readonly memberIdentityAddress: string;
  readonly membershipAddress: string;
  /** The exact portable replacement sequence committed by payloadHash. */
  readonly membershipStateSequence: bigint;
}

export interface ChainConfirmation {
  readonly signature: string;
  readonly slot: bigint;
  readonly finalized: boolean;
}

export interface CommunityChainConfirmation extends ChainConfirmation {
  readonly communityAddress: string;
}

export interface CommunityMembershipChainConfirmation extends ChainConfirmation {
  readonly membershipAddress: string;
}

export type CommunityCreationReconciliation =
  | { readonly status: 'absent' }
  | {
      /**
       * The expected PDA already exists and exactly matches every immutable
       * field in the supplied AnchorCommunityInput.
       */
      readonly status: 'existing';
      readonly confirmation: CommunityChainConfirmation;
    };

export type CommunityMembershipActionReconciliation =
  | { readonly status: 'ready' }
  | {
      /**
       * The exact membership action already landed. Implementations must throw
       * instead of returning this status when any state, sequence, hash, URI,
       * community, or member field differs.
       */
      readonly status: 'existing';
      readonly confirmation: CommunityMembershipChainConfirmation;
    };

export interface ProtocolChainWriter {
  updateProfile(input: AnchorProfileInput): Promise<ChainConfirmation>;
  publishPost(input: AnchorManifestInput): Promise<ChainConfirmation>;
  /**
   * Reconcile the exact derived PDA before submitting Anchor's non-idempotent
   * `init` instruction. Return `absent` only when it is safe to submit create.
   * Return `existing` for both pending and finalized matching creations so a
   * response-lost retry never blindly resubmits `init`; throw on any mismatch.
   */
  reconcileCommunityCreation(input: AnchorCommunityInput): Promise<CommunityCreationReconciliation>;
  createCommunity(input: AnchorCommunityInput): Promise<CommunityChainConfirmation>;
  /**
   * Re-read the deterministic membership PDA before a sequence-consuming
   * action. This makes a landed-but-response-lost retry observable instead of
   * submitting a second transition.
   */
  reconcileCommunityMembershipAction?(
    input: AnchorCommunityMembershipInput,
  ): Promise<CommunityMembershipActionReconciliation>;
  applyCommunityMembershipAction?(
    input: AnchorCommunityMembershipInput,
  ): Promise<CommunityMembershipChainConfirmation>;
  follow(input: {
    readonly followerIdentity: string;
    readonly followedIdentity: string;
  }): Promise<ChainConfirmation>;
  unfollow(input: {
    readonly followerIdentity: string;
    readonly followedIdentity: string;
  }): Promise<ChainConfirmation>;
}

export async function deriveWokeCommunityAddress(input: {
  readonly networkId: string;
  readonly creatorIdentityId: string;
  readonly communityNonce: Uint8Array;
}): Promise<string> {
  const networkId = networkIdSchema.parse(input.networkId);
  const creatorIdentityAddress = identityAddressForNetwork(
    networkId,
    input.creatorIdentityId,
    'Community creator identity',
  );
  if (!(input.communityNonce instanceof Uint8Array) || input.communityNonce.byteLength !== 16) {
    throw new TypeError('Community PDA nonces must contain exactly 16 bytes.');
  }

  const programAddress = networkId.split(':')[3];
  if (programAddress === undefined) {
    throw new TypeError('WokeNet network or creator identity is malformed.');
  }
  const [communityAddress] = await getProgramDerivedAddress({
    programAddress: address(programAddress),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      COMMUNITY_SEED,
      ADDRESS_ENCODER.encode(address(creatorIdentityAddress)),
      input.communityNonce,
    ],
  });
  return solanaPublicKeySchema.parse(communityAddress);
}

export async function deriveWokeCommunityMembershipAddressForNetwork(input: {
  readonly networkId: string;
  readonly communityAddress: string;
  readonly memberIdentityId: string;
}): Promise<string> {
  const networkId = networkIdSchema.parse(input.networkId);
  const communityAddress = solanaPublicKeySchema.parse(input.communityAddress);
  const memberIdentityAddress = identityAddressForNetwork(
    networkId,
    input.memberIdentityId,
    'Community member identity',
  );
  const programAddress = networkId.split(':')[3];
  if (programAddress === undefined) {
    throw new TypeError('WokeNet network is malformed.');
  }
  const [membershipAddress] = await getProgramDerivedAddress({
    programAddress: address(programAddress),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      MEMBERSHIP_SEED,
      ADDRESS_ENCODER.encode(address(communityAddress)),
      ADDRESS_ENCODER.encode(address(memberIdentityAddress)),
    ],
  });
  return solanaPublicKeySchema.parse(membershipAddress);
}

export function wokeIdentityAddressFromId(input: {
  readonly networkId: string;
  readonly identityId: string;
}): string {
  const networkId = networkIdSchema.parse(input.networkId);
  return identityAddressForNetwork(networkId, input.identityId, 'WokeSocial identity');
}

function identityAddressForNetwork(
  networkId: string,
  identityIdInput: string,
  label: string,
): string {
  const identityId = identityIdSchema.parse(identityIdInput);
  const identityPrefix = `wokesocialid:v1:${networkId}:`;
  if (!identityId.startsWith(identityPrefix)) {
    throw new TypeError(`${label} must belong to the supplied WokeNet network.`);
  }
  const identityAddress = identityId.slice(identityPrefix.length);
  return solanaPublicKeySchema.parse(identityAddress);
}

export function assertFinalized<Confirmation extends ChainConfirmation>(
  confirmation: Confirmation,
): Confirmation {
  if (!confirmation.finalized) {
    throw new ChainConfirmationError(confirmation.signature, confirmation.slot);
  }
  return confirmation;
}

export class ChainConfirmationError extends Error {
  override readonly name = 'ChainConfirmationError';

  constructor(
    readonly transactionSignature: string,
    readonly slot: bigint,
  ) {
    super(
      `Transaction ${transactionSignature} reached slot ${slot.toString()} but was not finalized.`,
    );
  }
}
