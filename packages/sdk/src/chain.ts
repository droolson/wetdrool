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
}

export interface ChainConfirmation {
  readonly signature: string;
  readonly slot: bigint;
  readonly finalized: boolean;
}

export interface CommunityChainConfirmation extends ChainConfirmation {
  readonly communityAddress: string;
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
  const creatorIdentityId = identityIdSchema.parse(input.creatorIdentityId);
  const identityPrefix = `wokesocialid:v1:${networkId}:`;
  if (!creatorIdentityId.startsWith(identityPrefix)) {
    throw new TypeError('Community creator identity must belong to the supplied WokeNet network.');
  }
  if (!(input.communityNonce instanceof Uint8Array) || input.communityNonce.byteLength !== 16) {
    throw new TypeError('Community PDA nonces must contain exactly 16 bytes.');
  }

  const programAddress = networkId.split(':')[3];
  const creatorIdentityAddress = creatorIdentityId.slice(identityPrefix.length);
  if (programAddress === undefined || creatorIdentityAddress.length === 0) {
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
