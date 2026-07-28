export interface SocialDeviceAddress {
  readonly identityId: string;
  readonly deviceId: string;
}

export interface LocalDeviceKeyBinding extends SocialDeviceAddress {
  readonly version: 1;
  readonly curve25519PublicKey: string;
  readonly ed25519PublicKey: string;
}

/**
 * A Woke Social authorization assertion which the injected resolver has
 * already verified against the current identity delegation/device registry.
 */
export interface CurrentDeviceAuthorization extends LocalDeviceKeyBinding {
  readonly assertionId: string;
  readonly revision: number;
  readonly issuedAtEpochMs: number;
  readonly expiresAtEpochMs: number;
  readonly status: 'active';
}

/**
 * This is an authority boundary, not a key-directory callback. Implementations
 * must authenticate a current Woke Social assertion and return null for an
 * absent, expired, revoked, superseded, or invalid assertion.
 */
export interface CurrentDeviceAuthorizationResolver {
  getCurrentDeviceAuthorization(
    address: SocialDeviceAddress,
    context: BoundedRequestContext,
  ): Promise<CurrentDeviceAuthorization | null>;
}

export type KeyDirectoryOperation = 'keys-claim' | 'keys-query' | 'keys-upload';

export interface BoundedRequestContext {
  readonly signal: AbortSignal;
  readonly deadlineEpochMs: number;
}

/**
 * Serialized engine protocol bytes. Callers should forward these without
 * parsing, logging, caching, or treating their contents as authorization.
 */
export interface OpaqueKeyDirectoryRequest {
  readonly version: 1;
  readonly operation: KeyDirectoryOperation;
  readonly opaqueBody: Uint8Array;
  readonly signal: AbortSignal;
  readonly deadlineEpochMs: number;
}

export interface OpaqueKeyDirectoryResponse {
  readonly version: 1;
  readonly opaqueBody: Uint8Array;
}

/**
 * A per-device, authenticated connection to a replaceable but untrusted key
 * directory. Authentication only identifies the local publisher; it does not
 * make directory responses authoritative for Woke Social device access.
 */
export interface UntrustedKeyDirectoryTransport {
  exchange(request: OpaqueKeyDirectoryRequest): Promise<OpaqueKeyDirectoryResponse>;
}

export interface PairwiseMemoryStorage {
  readonly kind: 'memory';
  readonly usage: 'test-or-development';
  /** Required acknowledgement that all keys and replay state are volatile. */
  readonly acknowledgeVolatileKeyLoss: true;
}

export interface CreatePairwiseDeviceOptions {
  readonly localDevice: SocialDeviceAddress;
  readonly authorizationResolver: CurrentDeviceAuthorizationResolver;
  readonly keyDirectory: UntrustedKeyDirectoryTransport;
  readonly storage: PairwiseMemoryStorage;
  /**
   * Must be supplied by the host runtime. `production` always fails closed
   * while only volatile storage exists.
   */
  readonly runtimeEnvironment: 'development' | 'production' | 'test';
  readonly authorizationTimeoutMs?: number;
  readonly directoryTimeoutMs?: number;
  /** Bounded volatile duplicate filter. Durable replay state is not implemented. */
  readonly replayWindowSize?: number;
}

export interface PairwiseEncryptInput {
  readonly recipient: SocialDeviceAddress;
  readonly plaintext: Uint8Array;
  readonly contentType: string;
}

export interface PairwiseCiphertextEnvelope {
  readonly version: 1;
  readonly protocol: 'woke.social.messaging.pairwise.v1';
  readonly algorithm: 'olm-v1';
  readonly messageId: string;
  readonly sender: SocialDeviceAddress;
  readonly recipient: SocialDeviceAddress;
  /** Base64url-wrapped upstream encrypted event content. */
  readonly ciphertext: string;
  /** Detached signature over the canonical envelope fields and ciphertext. */
  readonly signature: {
    readonly algorithm: 'ed25519';
    readonly value: string;
  };
}

export interface PairwiseDecryptInput {
  readonly envelope: unknown;
}

export interface PairwiseDecryptedMessage {
  readonly version: 1;
  readonly messageId: string;
  readonly sender: SocialDeviceAddress;
  readonly recipient: SocialDeviceAddress;
  readonly contentType: string;
  readonly plaintext: Uint8Array;
}

export interface RefreshedDeviceAuthorization {
  readonly address: SocialDeviceAddress;
  readonly assertionId: string;
  readonly revision: number;
  readonly expiresAtEpochMs: number;
}

export interface PairwiseMessagingDevice {
  readonly capabilities: typeof MESSAGING_CAPABILITIES;
  readonly localDevice: SocialDeviceAddress;

  getLocalDeviceKeyBinding(): LocalDeviceKeyBinding;
  refreshDevice(address: SocialDeviceAddress): Promise<RefreshedDeviceAuthorization>;
  encrypt(input: PairwiseEncryptInput): Promise<PairwiseCiphertextEnvelope>;
  decrypt(input: PairwiseDecryptInput): Promise<PairwiseDecryptedMessage>;
  close(): Promise<void>;
}

export const MESSAGING_CAPABILITIES = Object.freeze({
  pairwiseEncryption: 'enabled',
  groupEncryption: 'disabled',
  roomEncryption: 'disabled',
} as const);
