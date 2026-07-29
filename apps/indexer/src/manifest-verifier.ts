import {
  cidSchema,
  decodeCanonicalEnvelope,
  extractWokeManifestCid,
  PROFILE_SCHEMA_VERSION,
  type SignedEnvelope,
  verifyEnvelope,
} from '@wokesocial/protocol';

import type { ProtocolEvent } from './events.js';
import type { TerminalManifestFailureCode, VerifiedManifest } from './projection.js';

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
    readonly code: TerminalManifestFailureCode | 'manifest-unavailable',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

const TERMINAL_MANIFEST_FAILURE_CODES: ReadonlySet<string> = new Set([
  'author-mismatch',
  'cid-mismatch',
  'hash-mismatch',
  'manifest-invalid',
  'manifest-uri',
  'object-mismatch',
  'schema-version',
  'type-mismatch',
  'unauthorized-key',
  'unsupported-event',
]);

export function isTerminalManifestFailureCode(value: string): value is TerminalManifestFailureCode {
  return TERMINAL_MANIFEST_FAILURE_CODES.has(value);
}

export function isTerminalManifestVerificationError(
  error: unknown,
): error is ManifestVerificationError & { readonly code: TerminalManifestFailureCode } {
  return error instanceof ManifestVerificationError && isTerminalManifestFailureCode(error.code);
}

export class ManifestVerifier {
  readonly #profileSchemaV2ActivationSlot: bigint;

  constructor(
    private readonly source: ManifestSource,
    private readonly authorizer: OnchainKeyAuthorizer,
    options: Readonly<{ profileSchemaV2ActivationSlot?: bigint }> = {},
  ) {
    this.#profileSchemaV2ActivationSlot = options.profileSchemaV2ActivationSlot ?? 0n;
    if (this.#profileSchemaV2ActivationSlot < 0n) {
      throw new TypeError('The profile schema-v2 activation slot cannot be negative.');
    }
  }

  async forEvent(event: ProtocolEvent): Promise<VerifiedManifest | undefined> {
    if (
      event.type !== 'profile-updated' &&
      event.type !== 'post-published' &&
      event.type !== 'tombstoned'
    ) {
      return undefined;
    }
    if (event.type === 'tombstoned') {
      // PostTombstoned authenticates the author and target on chain. Optional
      // legacy tombstone bytes are detached audit metadata; their availability
      // must never gate canonical suppression or finalized checkpoint progress.
      return undefined;
    }

    const manifestUri = event.manifestUri;
    const uriCid = manifestUri === undefined ? undefined : extractWokeManifestCid(manifestUri);
    const explicitCid = event.cid === undefined ? undefined : cidSchema.safeParse(event.cid);
    if (
      (manifestUri !== undefined && uriCid === undefined) ||
      (explicitCid !== undefined && !explicitCid.success) ||
      (explicitCid?.success === true && uriCid !== undefined && explicitCid.data !== uriCid)
    ) {
      throw new ManifestVerificationError(
        'The on-chain event contains a malformed or inconsistent manifest URI.',
        'manifest-uri',
      );
    }
    const cid = explicitCid?.success === true ? explicitCid.data : uriCid;
    if (cid === undefined) {
      throw new ManifestVerificationError(
        'The on-chain event does not include a supported content-addressed manifest URI.',
        'manifest-uri',
      );
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.source.get(cid);
    } catch (error) {
      throw new ManifestVerificationError(
        `Content ${cid} could not be retrieved and verified.`,
        'manifest-unavailable',
        { cause: error },
      );
    }

    let envelope: SignedEnvelope;
    try {
      envelope = decodeCanonicalEnvelope(bytes);
    } catch (error) {
      throw new ManifestVerificationError(
        'Stored envelope is invalid or non-canonical.',
        'manifest-invalid',
        { cause: error },
      );
    }

    let verified: Awaited<ReturnType<typeof verifyEnvelope>>;
    try {
      verified = await verifyEnvelope(envelope);
    } catch (error) {
      throw new ManifestVerificationError(
        'Stored envelope has an invalid payload, proof, or signature.',
        'manifest-invalid',
        { cause: error },
      );
    }

    const expectedType = event.type === 'profile-updated' ? 'profile' : 'post';
    if (envelope.payload.type !== expectedType) {
      throw new ManifestVerificationError(`Expected a ${expectedType} manifest.`, 'type-mismatch');
    }
    if (event.type === 'profile-updated') {
      const hasCurrentOnchainCommitment = event.profileSchemaVersion === PROFILE_SCHEMA_VERSION;
      const legacyCommitmentAllowed =
        event.profileSchemaVersion === undefined &&
        event.slot < this.#profileSchemaV2ActivationSlot;
      if (
        (!hasCurrentOnchainCommitment && !legacyCommitmentAllowed) ||
        (hasCurrentOnchainCommitment &&
          envelope.payload.schemaVersion !== PROFILE_SCHEMA_VERSION) ||
        (event.slot >= this.#profileSchemaV2ActivationSlot &&
          envelope.payload.schemaVersion !== PROFILE_SCHEMA_VERSION)
      ) {
        throw new ManifestVerificationError(
          `Profile reference requires an explicit on-chain schema version ${String(PROFILE_SCHEMA_VERSION)} at or after slot ${this.#profileSchemaV2ActivationSlot.toString()}, and every explicit commitment must match a schema-v${String(PROFILE_SCHEMA_VERSION)} envelope.`,
          'schema-version',
        );
      }
    }

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

    const expectedObjectId = event.objectId;
    if (verified.cid !== cid) {
      throw new ManifestVerificationError(
        'Envelope CID does not match the onchain reference.',
        'cid-mismatch',
      );
    }
    if (expectedObjectId !== undefined && verified.objectId !== expectedObjectId) {
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

    const authorized = await this.authorizer.authorize({
      authorIdentityId: envelope.payload.author,
      keyId: envelope.proof.keyId,
      objectType: envelope.payload.type,
      slot: event.slot,
      ...(event.transactionIndex === undefined ? {} : { transactionIndex: event.transactionIndex }),
      transactionSignature: event.transactionSignature,
      logIndex: event.logIndex,
    });
    if (!authorized) {
      throw new ManifestVerificationError(
        'Signing key was not authorized for this finalized event.',
        'unauthorized-key',
      );
    }

    return {
      objectId: verified.objectId,
      cid: verified.cid,
      payloadHash: envelope.proof.payloadHash,
      schemaVersion: envelope.payload.schemaVersion,
      signingKeyId: envelope.proof.keyId,
      authorIdentityId: envelope.payload.author,
      createdAt: envelope.payload.createdAt,
      type: envelope.payload.type,
      content: envelope.payload.content,
    };
  }
}
