import {
  buildPostPayload,
  buildProfilePayload,
  canonicalizeEnvelope,
  decodeMultibaseBase64Url,
  getObjectId,
  signPayload,
  type PayloadBuilderIdentity,
  type PostContent,
  type ProfileContent,
  type SignedEnvelope,
  verifyEnvelope,
} from '@socially-woke/protocol';
import type {
  MultiProviderStorage,
  ReplicatedPublication,
  StoragePolicy,
} from '@socially-woke/storage';

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
  readonly privateKey: Uint8Array;
  readonly storage: MultiProviderStorage;
  readonly chain: ProtocolChainWriter;
  readonly onProgress?: (progress: PublicationProgress) => void;
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
  readonly #privateKey: Uint8Array;
  readonly #storage: MultiProviderStorage;
  readonly #chain: ProtocolChainWriter;
  readonly #onProgress: ((progress: PublicationProgress) => void) | undefined;

  constructor(options: PublicationPipelineOptions) {
    this.#identity = options.identity;
    this.#privateKey = options.privateKey.slice();
    this.#storage = options.storage;
    this.#chain = options.chain;
    this.#onProgress = options.onProgress;
  }

  async publishPost(
    content: PostContent,
    policy: StoragePolicy,
    options: { readonly createdAt?: Date; readonly nonce?: Uint8Array } = {},
  ): Promise<PublicationResult> {
    this.#progress('validating', 'Validating the post manifest.');
    const payload = buildPostPayload(this.#identity, content, options);
    return this.#publish(signPayload(payload, this.#privateKey), policy, (anchor) =>
      this.#chain.publishPost(anchor),
    );
  }

  async updateProfile(
    content: ProfileContent,
    policy: StoragePolicy,
    options: { readonly createdAt?: Date; readonly nonce?: Uint8Array } = {},
  ): Promise<PublicationResult> {
    this.#progress('validating', 'Validating the profile manifest.');
    const payload = buildProfilePayload(this.#identity, content, options);
    return this.#publish(signPayload(payload, this.#privateKey), policy, (anchor) =>
      this.#chain.updateProfile(anchor),
    );
  }

  async #publish(
    envelope: SignedEnvelope,
    policy: StoragePolicy,
    anchor: AnchorWriter,
  ): Promise<PublicationResult> {
    let objectId: string | undefined;
    let stored: ReplicatedPublication | undefined;
    let stage: PublicationStage = 'signing';
    try {
      this.#progress('signing', 'Signing canonical manifest bytes.');
      const verified = await verifyEnvelope(envelope);
      objectId = getObjectId(envelope.payload);

      stage = 'storing';
      this.#progress('storing', 'Publishing to configured storage providers.', {
        objectId,
      });
      stored = await this.#storage.publish(canonicalizeEnvelope(envelope), policy);

      stage = 'anchoring';
      this.#progress('anchoring', 'Submitting the verified reference to Woke Network.', {
        objectId,
        cid: stored.cid,
      });
      const chain = await this.#anchor(anchor, {
        identity: this.#identity.author,
        objectId,
        cid: stored.cid,
        payloadHash: decodeMultibaseBase64Url(envelope.proof.payloadHash, 32),
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
