import type { ProfilePayload } from '@wokesocial/protocol';

export interface AnchorManifestInput {
  readonly identity: string;
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: Uint8Array;
}

export interface AnchorProfileInput extends AnchorManifestInput {
  readonly profileSchemaVersion: ProfilePayload['schemaVersion'];
}

export interface ChainConfirmation {
  readonly signature: string;
  readonly slot: bigint;
  readonly finalized: boolean;
}

export interface ProtocolChainWriter {
  updateProfile(input: AnchorProfileInput): Promise<ChainConfirmation>;
  publishPost(input: AnchorManifestInput): Promise<ChainConfirmation>;
  follow(input: {
    readonly followerIdentity: string;
    readonly followedIdentity: string;
  }): Promise<ChainConfirmation>;
  unfollow(input: {
    readonly followerIdentity: string;
    readonly followedIdentity: string;
  }): Promise<ChainConfirmation>;
}

export function assertFinalized(confirmation: ChainConfirmation): ChainConfirmation {
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
