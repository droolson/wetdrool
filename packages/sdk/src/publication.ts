import {
  buildPostPayload,
  buildProfilePayload,
  canonicalizePayload,
  decodeMultibaseBase64Url,
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

import { assertFinalized, type ChainConfirmation, type ProtocolChainWriter } from './chain.js';

export type PublicationStage =
  'validating' | 'signing' | 'storing' | 'anchoring' | 'confirming' | 'complete';

export interface PublicationProgress {
  readonly stage: PublicationStage;
  readonly objectId?: string;
  readonly cid?: string;
  readonly message: string;
}

export interface PublicationResult {
  readonly envelope: SignedEnvelope;
  readonly objectId: string;
  readonly storage: ReplicatedPublication;
  readonly chain: ChainConfirmation;
}

interface AnchorInput {
  readonly identity: string;
  readonly objectId: string;
  readonly cid: string;
  readonly payloadHash: Uint8Array;
}

type AnchorWriter = (input: AnchorInput) => Promise<ChainConfirmation>;

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
    const payload = buildPostPayload(this.#identity, content, options);
    return this.#publish(payload, options.signer, policy, (anchor) =>
      this.#chain.publishPost(anchor),
    );
  }

  async updateProfile(
    content: ProfileContent,
    policy: StoragePolicy,
    options: PublicationOperationOptions<ProfilePayload>,
  ): Promise<PublicationResult> {
    this.#progress('validating', 'Validating the profile manifest.');
    const payload = buildProfilePayload(this.#identity, content, options);
    return this.#publish(payload, options.signer, policy, (anchor) =>
      this.#chain.updateProfile(anchor),
    );
  }

  async #publish<Payload extends PortablePayload>(
    payload: Payload,
    signer: PublicationSigner<Payload>,
    policy: StoragePolicy,
    anchor: AnchorWriter,
  ): Promise<PublicationResult> {
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
      assertFinalized(chain);
      this.#progress('complete', 'Publication is finalized and verifiable.', {
        objectId,
        cid: stored.cid,
      });

      return {
        envelope: verified.envelope,
        objectId,
        storage: stored,
        chain,
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

  async #anchor(writer: AnchorWriter, input: AnchorInput): Promise<ChainConfirmation> {
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
