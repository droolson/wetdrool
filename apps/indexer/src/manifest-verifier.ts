import { decodeCanonicalEnvelope, type SignedEnvelope, verifyEnvelope } from '@wokesocial/protocol';

import type { ProtocolEvent } from './events.js';
import type { VerifiedManifest } from './projection.js';

export interface ManifestSource {
  get(cid: string): Promise<Uint8Array>;
}

export interface OnchainKeyAuthorizer {
  authorize(input: {
    readonly authorIdentityId: string;
    readonly keyId: string;
    readonly objectType: string;
    readonly slot: bigint;
    readonly transactionIndex?: number;
    readonly transactionSignature: string;
    readonly logIndex: number;
  }): Promise<boolean>;
}

export class ManifestVerificationError extends Error {
  override readonly name = 'ManifestVerificationError';

  constructor(
    message: string,
    readonly code:
      | 'unsupported-event'
      | 'cid-mismatch'
      | 'object-mismatch'
      | 'author-mismatch'
      | 'hash-mismatch'
      | 'type-mismatch'
      | 'unauthorized-key',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class ManifestVerifier {
  constructor(
    private readonly source: ManifestSource,
    private readonly authorizer: OnchainKeyAuthorizer,
  ) {}

  async forEvent(event: ProtocolEvent): Promise<VerifiedManifest | undefined> {
    if (
      event.type !== 'profile-updated' &&
      event.type !== 'post-published' &&
      event.type !== 'tombstoned'
    ) {
      return undefined;
    }
    if (event.type === 'tombstoned' && event.cid === undefined) {
      return undefined;
    }

    const cid = event.cid;
    if (cid === undefined) {
      throw new ManifestVerificationError(
        'The onchain event does not include a manifest reference.',
        'cid-mismatch',
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.source.get(cid);
    } catch (error) {
      throw new ManifestVerificationError(
        `Content ${cid} could not be retrieved and verified.`,
        'cid-mismatch',
        { cause: error },
      );
    }

    let envelope: SignedEnvelope;
    try {
      envelope = decodeCanonicalEnvelope(bytes);
    } catch (error) {
      throw new ManifestVerificationError(
        'Stored envelope is invalid or non-canonical.',
        'cid-mismatch',
        { cause: error },
      );
    }

    const verified = await verifyEnvelope(envelope, ({ author, keyId, objectType }) =>
      this.authorizer.authorize({
        authorIdentityId: author,
        keyId,
        objectType,
        slot: event.slot,
        ...(event.transactionIndex === undefined
          ? {}
          : { transactionIndex: event.transactionIndex }),
        transactionSignature: event.transactionSignature,
        logIndex: event.logIndex,
      }),
    );

    if (
      (event.type === 'profile-updated' || event.type === 'post-published') &&
      event.authority !== undefined &&
      envelope.proof.keyId !== `${event.identityId}#root/${event.authority}` &&
      envelope.proof.keyId !== `${event.identityId}#delegation/${event.authority}`
    ) {
      throw new ManifestVerificationError(
        'Envelope signing key does not match the authority recorded by the on-chain event.',
        'unauthorized-key',
      );
    }

    const expectedObjectId = event.type === 'tombstoned' ? event.tombstoneObjectId : event.objectId;
    if (expectedObjectId === undefined) {
      throw new ManifestVerificationError(
        'The onchain event does not include a manifest object ID.',
        'object-mismatch',
      );
    }
    if (verified.cid !== cid) {
      throw new ManifestVerificationError(
        'Envelope CID does not match the onchain reference.',
        'cid-mismatch',
      );
    }
    if (verified.objectId !== expectedObjectId) {
      throw new ManifestVerificationError(
        'Envelope object ID does not match the onchain reference.',
        'object-mismatch',
      );
    }
    if (envelope.payload.author !== event.identityId) {
      throw new ManifestVerificationError(
        'Envelope author does not match the onchain identity.',
        'author-mismatch',
      );
    }
    if (envelope.proof.payloadHash !== event.payloadHash) {
      throw new ManifestVerificationError(
        'Envelope payload hash does not match the onchain reference.',
        'hash-mismatch',
      );
    }

    const expectedType =
      event.type === 'profile-updated'
        ? 'profile'
        : event.type === 'post-published'
          ? 'post'
          : 'tombstone';
    if (envelope.payload.type !== expectedType) {
      throw new ManifestVerificationError(`Expected a ${expectedType} manifest.`, 'type-mismatch');
    }

    return {
      objectId: verified.objectId,
      cid: verified.cid,
      payloadHash: envelope.proof.payloadHash,
      signingKeyId: envelope.proof.keyId,
      authorIdentityId: envelope.payload.author,
      createdAt: envelope.payload.createdAt,
      type: envelope.payload.type,
      content: envelope.payload.content,
    };
  }
}
