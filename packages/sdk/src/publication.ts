import {
  PROFILE_SCHEMA_VERSION,
  buildCommunityMembershipPayload,
  buildCommunityPayload,
  buildPostPayload,
  buildProfilePayload,
  canonicalizePayload,
  communityGovernanceStrategyCommitment,
  decodeMultibaseBase64Url,
  solanaPublicKeySchema,
  type CommunityContent,
  type CommunityMembershipContent,
  type CommunityMembershipPayload,
  type CommunityPayload,
  type PayloadBuildOptions,
  type PayloadBuilderIdentity,
  type PostContent,
  type PostPayload,
  type PortablePayload,
  type ProfileContent,
  type ProfilePayload,
  type SignedEnvelope,
  verifyEnvelope,
} from '@wokesocial/protocol';
import type {
  MultiProviderStorage,
  ReplicatedPublication,
  StoragePolicy,
} from '@wokesocial/storage';

import {
  assertFinalized,
  deriveWokeCommunityAddress,
  deriveWokeCommunityMembershipAddressForNetwork,
  wokeIdentityAddressFromId,
  type ChainConfirmation,
  type CommunityChainConfirmation,
  type CommunityMembershipChainConfirmation,
  type ProtocolChainWriter,
} from './chain.js';

export type PublicationStage =
  'validating' | 'signing' | 'storing' | 'anchoring' | 'confirming' | 'complete';

export interface PublicationProgress {
  readonly stage: PublicationStage;
  readonly objectId?: string;
  readonly cid?: string;
  readonly message: string;
}

export interface PublicationResult<Confirmation extends ChainConfirmation = ChainConfirmation> {
  readonly envelope: SignedEnvelope;
  readonly objectId: string;
  readonly storage: ReplicatedPublication;
  readonly chain: Confirmation;
}

interface AnchorInput {
  readonly identity: string;
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: Uint8Array;
}

type AnchorWriter<Confirmation extends ChainConfirmation> = (
  input: AnchorInput,
) => Promise<Confirmation>;

export interface PublicationPipelineOptions {
  readonly identity: PayloadBuilderIdentity;
  readonly storage: MultiProviderStorage;
  readonly chain: ProtocolChainWriter;
  readonly onProgress?: (progress: PublicationProgress) => void;
}

export type PublicationSigner<Payload extends PortablePayload> = (
  payload: Payload,
) => SignedEnvelope | Promise<SignedEnvelope>;

export interface PublicationOperationOptions<
  Payload extends PortablePayload,
> extends PayloadBuildOptions {
  readonly signer: PublicationSigner<Payload>;
}

/**
 * Community creation derives its onchain PDA from the signed nonce. Callers
 * must persist and reuse both fields after an ambiguous publication failure.
 */
export interface CommunityPublicationOperationOptions extends PublicationOperationOptions<CommunityPayload> {
  readonly createdAt: Date;
  readonly nonce: Uint8Array;
}

export type MemberCommunityMembershipContent = Extract<
  CommunityMembershipContent,
  { action: 'join' | 'leave' }
>;

/**
 * Membership actions consume several optimistic onchain sequences. Callers
 * must persist and reuse this entire operation input after an ambiguous
 * failure; changing any coordinate creates a different action.
 */
export interface CommunityMembershipPublicationOperationOptions extends PublicationOperationOptions<CommunityMembershipPayload> {
  readonly createdAt: Date;
  readonly nonce: Uint8Array;
  readonly expectedCommunityMembershipSequence: bigint;
  readonly expectedMemberIdentitySequence: bigint;
  readonly expectedMembershipPolicySequence: bigint;
  readonly expectedMembershipStateSequence: bigint;
}

export class PublicationError extends Error {
  override readonly name = 'PublicationError';

  constructor(
    message: string,
    readonly stage: PublicationStage,
    readonly recoverableCid?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class PublicationPipeline {
  readonly #identity: PayloadBuilderIdentity;
  readonly #storage: MultiProviderStorage;
  readonly #chain: ProtocolChainWriter;
  readonly #onProgress: ((progress: PublicationProgress) => void) | undefined;

  constructor(options: PublicationPipelineOptions) {
    this.#identity = { ...options.identity };
    this.#storage = options.storage;
    this.#chain = options.chain;
    this.#onProgress = options.onProgress;
  }

  async publishPost(
    content: PostContent,
    policy: StoragePolicy,
    options: PublicationOperationOptions<PostPayload>,
  ): Promise<PublicationResult> {
    this.#progress('validating', 'Validating the post manifest.');
    if (!['public', 'unlisted'].includes(content.visibility.kind)) {
      throw new PublicationError(
        'Restricted post publication is disabled until the official client can encrypt and verify every referenced payload before upload.',
        'validating',
      );
    }
    const payload = buildPostPayload(this.#identity, content, options);
    return this.#publish(payload, options.signer, policy, (anchor) =>
      this.#chain.publishPost(anchor),
    );
  }

  async publishCommunity(
    content: CommunityContent,
    policy: StoragePolicy,
    options: CommunityPublicationOperationOptions,
  ): Promise<PublicationResult<CommunityChainConfirmation>> {
    this.#progress('validating', 'Validating the community manifest.');
    if (
      !(options.createdAt instanceof Date) ||
      !Number.isFinite(options.createdAt.getTime()) ||
      !(options.nonce instanceof Uint8Array) ||
      options.nonce.byteLength !== 16
    ) {
      throw new PublicationError(
        'Community publication requires an explicit valid createdAt and 16-byte nonce that callers persist and reuse for retries.',
        'validating',
      );
    }
    if (content.replacement.sequence !== 1) {
      throw new PublicationError(
        'Community publication only supports the first manifest sequence because the current program has no community-manifest update path.',
        'validating',
      );
    }
    const visibility = content.visibility;
    if (visibility !== 'public' && visibility !== 'unlisted') {
      throw new PublicationError(
        'Private and restricted community publication is disabled until encrypted publication is connected.',
        'validating',
      );
    }

    const payload = buildCommunityPayload(this.#identity, content, options);
    if (!payload.signingKey.startsWith(`${payload.author}#root/`)) {
      throw new PublicationError(
        'community objects must be signed by an identity root key.',
        'validating',
      );
    }
    const governance = communityGovernanceStrategyCommitment(payload.content);
    const membershipPolicy = payload.content.membershipPolicy;
    const anchoredVisibility = payload.content.visibility;
    if (anchoredVisibility !== 'public' && anchoredVisibility !== 'unlisted') {
      throw new PublicationError(
        'The constructed community manifest changed its validated visibility.',
        'validating',
      );
    }
    const communityNonce = decodeMultibaseBase64Url(payload.nonce, 16);
    const communityAddress = await deriveWokeCommunityAddress({
      networkId: payload.network,
      creatorIdentityId: payload.author,
      communityNonce,
    });
    return this.#publish(payload, options.signer, policy, async (anchor) => {
      const input = {
        ...anchor,
        communityAddress,
        communityNonce,
        governanceVersion: governance.governanceVersion,
        governanceStrategyHash: governance.bytes,
        membershipPolicy,
        visibility: anchoredVisibility,
      };
      const reconciliation = await this.#chain.reconcileCommunityCreation(input);
      const confirmation =
        reconciliation.status === 'existing'
          ? reconciliation.confirmation
          : reconciliation.status === 'absent'
            ? await this.#chain.createCommunity(input)
            : (() => {
                throw new TypeError(
                  'Community creation reconciliation returned an invalid status.',
                );
              })();
      const confirmedAddress = solanaPublicKeySchema.parse(confirmation.communityAddress);
      if (confirmedAddress !== communityAddress) {
        throw new TypeError(
          'Community chain confirmation does not match the PDA derived from the signed nonce.',
        );
      }
      return { ...confirmation, communityAddress: confirmedAddress };
    });
  }

  async publishOwnCommunityMembership(
    content: MemberCommunityMembershipContent,
    policy: StoragePolicy,
    options: CommunityMembershipPublicationOperationOptions,
  ): Promise<PublicationResult<CommunityMembershipChainConfirmation>> {
    this.#progress('validating', `Validating the community ${content.action} manifest.`);
    validatePersistentCoordinates(options, 'Community membership publication');
    const reconcileCommunityMembershipAction = this.#chain.reconcileCommunityMembershipAction?.bind(
      this.#chain,
    );
    const applyCommunityMembershipAction = this.#chain.applyCommunityMembershipAction?.bind(
      this.#chain,
    );
    if (
      reconcileCommunityMembershipAction === undefined ||
      applyCommunityMembershipAction === undefined
    ) {
      throw new PublicationError(
        'The configured chain writer does not implement member-signed community actions.',
        'validating',
      );
    }
    const expectedMemberIdentitySequence = incrementableU64(
      options.expectedMemberIdentitySequence,
      'expected member identity sequence',
    );
    const expectedMembershipStateSequence = incrementableU64(
      options.expectedMembershipStateSequence,
      'expected membership state sequence',
    );
    const expectedMembershipPolicySequence = positiveU64(
      options.expectedMembershipPolicySequence,
      'expected membership policy sequence',
    );
    const expectedCommunityMembershipSequence = incrementableU64(
      options.expectedCommunityMembershipSequence,
      'expected community membership sequence',
    );
    if (BigInt(content.replacement.sequence) !== expectedMembershipStateSequence + 1n) {
      throw new PublicationError(
        'The portable membership replacement sequence must be exactly one greater than the current onchain membership state sequence.',
        'validating',
      );
    }

    const payload = buildCommunityMembershipPayload(this.#identity, content, options);
    const action = payload.content.action;
    if (action !== 'join' && action !== 'leave') {
      throw new PublicationError(
        'Member-owned publication can only anchor a join or leave action.',
        'validating',
      );
    }
    const communityAddress = payload.content.communityAddress;
    const membershipStateSequence = BigInt(payload.content.replacement.sequence);
    const memberIdentityAddress = wokeIdentityAddressFromId({
      networkId: payload.network,
      identityId: payload.content.member,
    });
    const membershipAddress = await deriveWokeCommunityMembershipAddressForNetwork({
      networkId: payload.network,
      communityAddress,
      memberIdentityId: payload.content.member,
    });

    return this.#publish(payload, options.signer, policy, async (anchor) => {
      const input = {
        ...anchor,
        action,
        communityAddress,
        expectedCommunityMembershipSequence,
        expectedMemberIdentitySequence,
        expectedMembershipPolicySequence,
        expectedMembershipStateSequence,
        memberIdentityAddress,
        membershipAddress,
        membershipStateSequence,
      };
      const reconciliation = await reconcileCommunityMembershipAction(input);
      const confirmation =
        reconciliation.status === 'existing'
          ? reconciliation.confirmation
          : reconciliation.status === 'ready'
            ? await applyCommunityMembershipAction(input)
            : (() => {
                throw new TypeError(
                  'Community membership reconciliation returned an invalid status.',
                );
              })();
      const confirmedAddress = solanaPublicKeySchema.parse(confirmation.membershipAddress);
      if (confirmedAddress !== membershipAddress) {
        throw new TypeError(
          'Community membership confirmation does not match the deterministic member PDA.',
        );
      }
      return { ...confirmation, membershipAddress: confirmedAddress };
    });
  }

  async updateProfile(
    content: ProfileContent,
    policy: StoragePolicy,
    options: PublicationOperationOptions<ProfilePayload>,
  ): Promise<PublicationResult> {
    this.#progress('validating', 'Validating the profile manifest.');
    if (hasProtectedProfileReferences(content)) {
      throw new PublicationError(
        'Protected profile publication is disabled until the official client can encrypt and verify every referenced value before upload.',
        'validating',
      );
    }
    const payload = buildProfilePayload(this.#identity, content, options);
    return this.#publish(payload, options.signer, policy, (anchor) =>
      this.#chain.updateProfile({
        ...anchor,
        profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      }),
    );
  }

  async #publish<
    Payload extends PortablePayload,
    Confirmation extends ChainConfirmation = ChainConfirmation,
  >(
    payload: Payload,
    signer: PublicationSigner<Payload>,
    policy: StoragePolicy,
    anchor: AnchorWriter<Confirmation>,
  ): Promise<PublicationResult<Confirmation>> {
    let objectId: string | undefined;
    let stored: ReplicatedPublication | undefined;
    let stage: PublicationStage = 'signing';
    try {
      this.#progress('signing', 'Signing canonical manifest bytes.');
      const expectedPayloadBytes = canonicalizePayload(payload);
      const envelope = await signer(payload);
      const signedPayloadBytes = canonicalizePayload(envelope.payload);
      if (!equalBytes(expectedPayloadBytes, signedPayloadBytes)) {
        throw new TypeError(
          'Signer returned an envelope that does not exactly match the constructed payload and identity.',
        );
      }
      const verified = await verifyEnvelope(envelope);
      objectId = verified.objectId;

      stage = 'storing';
      this.#progress('storing', 'Publishing to configured storage providers.', {
        objectId,
      });
      stored = await this.#storage.publish(verified.canonicalBytes, policy);

      stage = 'anchoring';
      this.#progress('anchoring', 'Submitting the verified reference to WokeNet.', {
        objectId,
        cid: stored.cid,
      });
      const chain = await this.#anchor(anchor, {
        identity: verified.envelope.payload.author,
        objectId,
        cid: stored.cid,
        payloadHash: decodeMultibaseBase64Url(verified.envelope.proof.payloadHash, 32),
      });

      stage = 'confirming';
      this.#progress('confirming', 'Waiting for finalized confirmation.', {
        objectId,
        cid: stored.cid,
      });
      const finalizedChain = assertFinalized(chain);
      this.#progress('complete', 'Publication is finalized and verifiable.', {
        objectId,
        cid: stored.cid,
      });

      return {
        envelope: verified.envelope,
        objectId,
        storage: stored,
        chain: finalizedChain,
      };
    } catch (error) {
      throw new PublicationError(
        error instanceof Error ? error.message : 'Publication failed.',
        stage,
        stored?.cid,
        { cause: error },
      );
    }
  }

  async #anchor<Confirmation extends ChainConfirmation>(
    writer: AnchorWriter<Confirmation>,
    input: AnchorInput,
  ): Promise<Confirmation> {
    return writer(input);
  }

  #progress(
    stage: PublicationStage,
    message: string,
    context: Pick<PublicationProgress, 'objectId' | 'cid'> = {},
  ): void {
    this.#onProgress?.({ stage, message, ...context });
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

const U64_MAX = 18_446_744_073_709_551_615n;

function validatePersistentCoordinates(
  options: { readonly createdAt: Date; readonly nonce: Uint8Array },
  label: string,
): void {
  if (
    !(options.createdAt instanceof Date) ||
    !Number.isFinite(options.createdAt.getTime()) ||
    !(options.nonce instanceof Uint8Array) ||
    options.nonce.byteLength !== 16
  ) {
    throw new PublicationError(
      `${label} requires an explicit valid createdAt and 16-byte nonce that callers persist and reuse for retries.`,
      'validating',
    );
  }
}

function incrementableU64(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value >= U64_MAX) {
    throw new PublicationError(
      `The ${label} must fit the incrementable unsigned 64-bit range.`,
      'validating',
    );
  }
  return value;
}

function positiveU64(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value <= 0n || value > U64_MAX) {
    throw new PublicationError(
      `The ${label} must fit the positive unsigned 64-bit range.`,
      'validating',
    );
  }
  return value;
}

function hasProtectedProfileReferences(content: ProfileContent): boolean {
  return [
    ...content.pronouns,
    ...content.chosenFamilyLabels,
    ...(content.gender === undefined ? [] : [content.gender]),
    ...(content.location === undefined ? [] : [content.location]),
  ].some((value) => value.visibility !== 'public');
}
