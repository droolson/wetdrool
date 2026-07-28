import {
  DecryptedToDeviceEvent,
  DecryptionSettings,
  DeviceId,
  DeviceLists,
  LocalTrust,
  OlmMachine,
  ProcessedToDeviceEventType,
  RequestType,
  TrustRequirement,
  UserId,
  initAsync,
  type Device,
} from '@matrix-org/matrix-sdk-crypto-wasm';
import { ed25519 } from '@noble/curves/ed25519.js';
import { canonicalize } from 'json-canonicalize';

import { PairwiseMessagingError, messagingError } from './errors.js';
import {
  MAX_DIRECTORY_BODY_BYTES,
  copyAddress,
  decodeBase64Url,
  decodeUnpaddedBase64,
  decodeUtf8,
  deriveInternalAddress,
  encodeBase64Url,
  encodeUtf8,
  equalAddress,
  externalAddressKey,
  hasExactlyKeys,
  internalAddressKey,
  parseJsonRecord,
  requireActiveAuthorization,
  requireAddress,
  requireContentType,
  requireMessageId,
  requirePlaintext,
  secureMessageId,
  type InternalAddress,
} from './internal.js';
import {
  MESSAGING_CAPABILITIES,
  type CreatePairwiseDeviceOptions,
  type BoundedRequestContext,
  type CurrentDeviceAuthorization,
  type CurrentDeviceAuthorizationResolver,
  type KeyDirectoryOperation,
  type LocalDeviceKeyBinding,
  type PairwiseCiphertextEnvelope,
  type PairwiseDecryptInput,
  type PairwiseDecryptedMessage,
  type PairwiseEncryptInput,
  type PairwiseMessagingDevice,
  type RefreshedDeviceAuthorization,
  type SocialDeviceAddress,
  type UntrustedKeyDirectoryTransport,
} from './types.js';

const PAIRWISE_EVENT_TYPE = 'woke.social.messaging.pairwise.v1';
const PAIRWISE_ENVELOPE_PROTOCOL = 'woke.social.messaging.pairwise.v1';
const PAIRWISE_ENVELOPE_SIGNATURE_DOMAIN = 'woke.social/messaging/pairwise-envelope-signature/v1';
const ENCRYPTED_EVENT_TYPE = 'm.room.encrypted';
const DIRECTORY_RESPONSE_MAX_BYTES = 16 * 1024 * 1024;
const DEFAULT_REPLAY_WINDOW_SIZE = 4096;
const MAX_REPLAY_WINDOW_SIZE = 100_000;
const MAX_BOOTSTRAP_PASSES = 8;
const DEFAULT_AUTHORIZATION_TIMEOUT_MS = 10_000;
const DEFAULT_DIRECTORY_TIMEOUT_MS = 10_000;
const MIN_OPERATION_TIMEOUT_MS = 10;
const MAX_OPERATION_TIMEOUT_MS = 120_000;
const directoryDecoder = new TextDecoder('utf-8', { fatal: true });

let wasmInitialization: Promise<void> | undefined;

interface EngineRequest {
  readonly id: string;
  readonly type: RequestType;
  readonly body: string;
  free(): void;
}

interface EngineDeviceAuthorization {
  readonly device: Device;
  readonly assertion: CurrentDeviceAuthorization;
  readonly curve25519PublicKey: string;
  readonly ed25519PublicKey: string;
}

interface ParsedEnvelope {
  readonly envelope: PairwiseCiphertextEnvelope;
  readonly encryptedContent: Record<string, unknown>;
}

interface InnerPairwiseContent {
  readonly version: 1;
  readonly messageId: string;
  readonly sender: SocialDeviceAddress;
  readonly recipient: SocialDeviceAddress;
  readonly contentType: string;
  readonly body: string;
}

type PairwiseEnvelopeSigningFields = Omit<PairwiseCiphertextEnvelope, 'signature'>;

async function ensureWasmInitialized(): Promise<void> {
  wasmInitialization ??= initAsync();
  try {
    await wasmInitialization;
  } catch {
    throw messagingError('ENGINE_UNAVAILABLE');
  }
}

function requireReplayWindowSize(input: number | undefined): number {
  const value = input ?? DEFAULT_REPLAY_WINDOW_SIZE;
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_REPLAY_WINDOW_SIZE) {
    throw messagingError('INVALID_INPUT');
  }
  return value;
}

function requireOperationTimeout(input: number | undefined, defaultValue: number): number {
  const value = input ?? defaultValue;
  if (
    !Number.isSafeInteger(value) ||
    value < MIN_OPERATION_TIMEOUT_MS ||
    value > MAX_OPERATION_TIMEOUT_MS
  ) {
    throw messagingError('INVALID_INPUT');
  }
  return value;
}

function detectedNodeEnvironment(): string | undefined {
  return (
    globalThis as typeof globalThis & {
      readonly process?: {
        readonly env?: Readonly<Record<string, string | undefined>>;
      };
    }
  ).process?.env?.['NODE_ENV'];
}

function requireOptions(input: CreatePairwiseDeviceOptions): {
  readonly authorizationResolver: CurrentDeviceAuthorizationResolver;
  readonly authorizationTimeoutMs: number;
  readonly directoryTimeoutMs: number;
  readonly keyDirectory: UntrustedKeyDirectoryTransport;
  readonly localDevice: SocialDeviceAddress;
  readonly replayWindowSize: number;
} {
  if (typeof input !== 'object' || input === null) {
    throw messagingError('INVALID_INPUT');
  }
  if (
    input.storage?.kind !== 'memory' ||
    input.storage.usage !== 'test-or-development' ||
    input.storage.acknowledgeVolatileKeyLoss !== true ||
    !['development', 'production', 'test'].includes(input.runtimeEnvironment) ||
    typeof input.authorizationResolver?.getCurrentDeviceAuthorization !== 'function' ||
    typeof input.keyDirectory?.exchange !== 'function'
  ) {
    throw messagingError('INVALID_INPUT');
  }
  if (input.runtimeEnvironment === 'production' || detectedNodeEnvironment() === 'production') {
    throw messagingError('PRODUCTION_STORAGE_UNAVAILABLE');
  }
  return {
    authorizationResolver: input.authorizationResolver,
    authorizationTimeoutMs: requireOperationTimeout(
      input.authorizationTimeoutMs,
      DEFAULT_AUTHORIZATION_TIMEOUT_MS,
    ),
    directoryTimeoutMs: requireOperationTimeout(
      input.directoryTimeoutMs,
      DEFAULT_DIRECTORY_TIMEOUT_MS,
    ),
    keyDirectory: input.keyDirectory,
    localDevice: requireAddress(input.localDevice),
    replayWindowSize: requireReplayWindowSize(input.replayWindowSize),
  };
}

function envelopeSigningMessage(envelope: PairwiseEnvelopeSigningFields): string {
  return `${PAIRWISE_ENVELOPE_SIGNATURE_DOMAIN}\n${canonicalize(envelope)}`;
}

function validDetachedSignature(
  envelope: PairwiseCiphertextEnvelope,
  ed25519PublicKey: string,
): boolean {
  try {
    const signature = decodeUnpaddedBase64(envelope.signature.value, 64);
    const publicKey = decodeUnpaddedBase64(ed25519PublicKey, 32);
    if (signature.byteLength !== 64 || publicKey.byteLength !== 32) {
      return false;
    }
    const signingFields: PairwiseEnvelopeSigningFields = {
      version: envelope.version,
      protocol: envelope.protocol,
      algorithm: envelope.algorithm,
      messageId: envelope.messageId,
      sender: envelope.sender,
      recipient: envelope.recipient,
      ciphertext: envelope.ciphertext,
    };
    return ed25519.verify(signature, encodeUtf8(envelopeSigningMessage(signingFields)), publicKey, {
      zip215: false,
    });
  } catch {
    return false;
  }
}

function engineRequest(input: unknown): EngineRequest {
  const request = input as Partial<EngineRequest>;
  if (
    typeof request.id !== 'string' ||
    typeof request.type !== 'number' ||
    typeof request.body !== 'string' ||
    typeof request.free !== 'function'
  ) {
    throw messagingError('UNSUPPORTED_ENGINE_REQUEST');
  }
  return request as EngineRequest;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function requireEmptyFailures(record: Record<string, unknown>): void {
  const failures = getRecord(record.failures);
  if (failures === undefined || Object.keys(failures).length !== 0) {
    throw messagingError('DIRECTORY_PROTOCOL_ERROR');
  }
}

function mapEngineFailure(
  error: unknown,
  fallback:
    | 'DECRYPTION_FAILED'
    | 'DEVICE_NOT_FOUND'
    | 'ENCRYPTION_FAILED'
    | 'ENGINE_UNAVAILABLE'
    | 'SESSION_UNAVAILABLE',
): never {
  if (error instanceof PairwiseMessagingError) {
    throw error;
  }
  throw messagingError(fallback);
}

function readDeviceKeys(device: Device): {
  readonly curve25519PublicKey: string;
  readonly ed25519PublicKey: string;
} {
  const curve25519 = device.curve25519Key;
  const ed25519 = device.ed25519Key;
  if (curve25519 === undefined || ed25519 === undefined) {
    curve25519?.free();
    ed25519?.free();
    throw messagingError('DEVICE_NOT_FOUND');
  }
  try {
    return {
      curve25519PublicKey: curve25519.toBase64(),
      ed25519PublicKey: ed25519.toBase64(),
    };
  } finally {
    curve25519.free();
    ed25519.free();
  }
}

function sameAuthorization(
  left: CurrentDeviceAuthorization,
  right: CurrentDeviceAuthorization,
): boolean {
  return (
    left.assertionId === right.assertionId &&
    left.revision === right.revision &&
    left.identityId === right.identityId &&
    left.deviceId === right.deviceId &&
    left.curve25519PublicKey === right.curve25519PublicKey &&
    left.ed25519PublicKey === right.ed25519PublicKey &&
    left.issuedAtEpochMs === right.issuedAtEpochMs &&
    left.expiresAtEpochMs === right.expiresAtEpochMs
  );
}

function parseEnvelope(input: unknown): ParsedEnvelope {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw messagingError('INVALID_ENVELOPE');
  }
  const record = input as Record<string, unknown>;
  if (
    !hasExactlyKeys(record, [
      'algorithm',
      'ciphertext',
      'messageId',
      'protocol',
      'recipient',
      'sender',
      'signature',
      'version',
    ]) ||
    record.version !== 1 ||
    record.protocol !== PAIRWISE_ENVELOPE_PROTOCOL ||
    record.algorithm !== 'olm-v1'
  ) {
    throw messagingError('INVALID_ENVELOPE');
  }

  let sender: SocialDeviceAddress;
  let recipient: SocialDeviceAddress;
  try {
    sender = requireAddress(record.sender);
    recipient = requireAddress(record.recipient);
  } catch {
    throw messagingError('INVALID_ENVELOPE');
  }

  const messageId = requireMessageId(record.messageId);
  const signature = getRecord(record.signature);
  if (
    signature === undefined ||
    !hasExactlyKeys(signature, ['algorithm', 'value']) ||
    signature.algorithm !== 'ed25519' ||
    typeof signature.value !== 'string'
  ) {
    throw messagingError('INVALID_ENVELOPE');
  }
  const signatureBytes = decodeUnpaddedBase64(signature.value, 64);
  if (signatureBytes.byteLength !== 64) {
    throw messagingError('INVALID_ENVELOPE');
  }
  const encryptedBytes = decodeBase64Url(record.ciphertext, MAX_DIRECTORY_BODY_BYTES);
  const encryptedContent = parseJsonRecord(decodeUtf8(encryptedBytes), 'INVALID_ENVELOPE');
  if (
    encryptedContent.algorithm !== 'm.olm.v1.curve25519-aes-sha2' ||
    typeof encryptedContent.sender_key !== 'string' ||
    getRecord(encryptedContent.ciphertext) === undefined
  ) {
    throw messagingError('INVALID_ENVELOPE');
  }
  const senderKeyBytes = decodeUnpaddedBase64(encryptedContent.sender_key, 32);
  if (senderKeyBytes.byteLength !== 32) {
    throw messagingError('INVALID_ENVELOPE');
  }

  return {
    envelope: {
      version: 1,
      protocol: PAIRWISE_ENVELOPE_PROTOCOL,
      algorithm: 'olm-v1',
      messageId,
      sender: copyAddress(sender),
      recipient: copyAddress(recipient),
      ciphertext: record.ciphertext as string,
      signature: {
        algorithm: 'ed25519',
        value: signature.value,
      },
    },
    encryptedContent,
  };
}

function parseInnerContent(rawEvent: string): InnerPairwiseContent {
  const event = parseJsonRecord(rawEvent, 'DECRYPTION_FAILED');
  if (event.type !== PAIRWISE_EVENT_TYPE || typeof event.sender !== 'string') {
    throw messagingError('DECRYPTION_FAILED');
  }
  const content = getRecord(event.content);
  if (
    content === undefined ||
    !hasExactlyKeys(content, [
      'body',
      'contentType',
      'messageId',
      'recipient',
      'sender',
      'version',
    ]) ||
    content.version !== 1 ||
    typeof content.body !== 'string'
  ) {
    throw messagingError('DECRYPTION_FAILED');
  }

  try {
    return {
      version: 1,
      messageId: requireMessageId(content.messageId),
      sender: requireAddress(content.sender),
      recipient: requireAddress(content.recipient),
      contentType: requireContentType(content.contentType),
      body: content.body,
    };
  } catch {
    throw messagingError('DECRYPTION_FAILED');
  }
}

/**
 * A single-writer, volatile pairwise cryptographic device. Construct with
 * {@link createPairwiseDevice}; production persistence is intentionally absent.
 */
class PairwiseMessagingDeviceImplementation implements PairwiseMessagingDevice {
  readonly capabilities = MESSAGING_CAPABILITIES;
  readonly localDevice: SocialDeviceAddress;

  readonly #authorizationResolver: CurrentDeviceAuthorizationResolver;
  readonly #authorizationTimeoutMs: number;
  readonly #directoryTimeoutMs: number;
  readonly #keyDirectory: UntrustedKeyDirectoryTransport;
  readonly #localInternal: InternalAddress;
  readonly #machine: OlmMachine;
  readonly #replayWindowSize: number;
  readonly #lifecycle = new AbortController();
  readonly #knownInternalAddresses = new Map<string, InternalAddress>();
  readonly #knownExternalAddresses = new Map<string, InternalAddress>();
  readonly #processedMessageIds = new Set<string>();
  readonly #localBinding: LocalDeviceKeyBinding;
  #serialTail: Promise<void> = Promise.resolve();
  #state: 'closed' | 'closing' | 'open' = 'open';
  #closePromise: Promise<void> | undefined;

  private constructor(input: {
    readonly authorizationResolver: CurrentDeviceAuthorizationResolver;
    readonly authorizationTimeoutMs: number;
    readonly directoryTimeoutMs: number;
    readonly keyDirectory: UntrustedKeyDirectoryTransport;
    readonly localInternal: InternalAddress;
    readonly machine: OlmMachine;
    readonly replayWindowSize: number;
    readonly localBinding: LocalDeviceKeyBinding;
  }) {
    this.#authorizationResolver = input.authorizationResolver;
    this.#authorizationTimeoutMs = input.authorizationTimeoutMs;
    this.#directoryTimeoutMs = input.directoryTimeoutMs;
    this.#keyDirectory = input.keyDirectory;
    this.#localInternal = input.localInternal;
    this.#machine = input.machine;
    this.#replayWindowSize = input.replayWindowSize;
    this.#localBinding = input.localBinding;
    this.localDevice = Object.freeze(copyAddress(input.localInternal.external));
    this.#registerInternalAddress(input.localInternal);
  }

  static async create(
    options: CreatePairwiseDeviceOptions,
  ): Promise<PairwiseMessagingDeviceImplementation> {
    const parsed = requireOptions(options);
    const localInternal = await deriveInternalAddress(parsed.localDevice);
    await ensureWasmInitialized();

    let machine: OlmMachine;
    const userId = new UserId(localInternal.userId);
    const deviceId = new DeviceId(localInternal.deviceId);
    try {
      machine = await OlmMachine.initialize(userId, deviceId);
    } catch (error) {
      mapEngineFailure(error, 'ENGINE_UNAVAILABLE');
    } finally {
      userId.free();
      deviceId.free();
    }

    machine.roomKeyForwardingEnabled = false;
    machine.roomKeyRequestsEnabled = false;
    const identityKeys = machine.identityKeys;
    const curve25519 = identityKeys.curve25519;
    const ed25519 = identityKeys.ed25519;
    let localBinding: LocalDeviceKeyBinding;
    try {
      localBinding = {
        version: 1,
        ...copyAddress(localInternal.external),
        curve25519PublicKey: curve25519.toBase64(),
        ed25519PublicKey: ed25519.toBase64(),
      };
    } finally {
      curve25519.free();
      ed25519.free();
      identityKeys.free();
    }

    const result = new PairwiseMessagingDeviceImplementation({
      authorizationResolver: parsed.authorizationResolver,
      authorizationTimeoutMs: parsed.authorizationTimeoutMs,
      directoryTimeoutMs: parsed.directoryTimeoutMs,
      keyDirectory: parsed.keyDirectory,
      localInternal,
      machine,
      replayWindowSize: parsed.replayWindowSize,
      localBinding,
    });
    try {
      await result.#bootstrap();
      return result;
    } catch (error) {
      machine.close();
      throw error;
    }
  }

  getLocalDeviceKeyBinding(): LocalDeviceKeyBinding {
    return { ...this.#localBinding };
  }

  async refreshDevice(address: SocialDeviceAddress): Promise<RefreshedDeviceAuthorization> {
    const requested = requireAddress(address);
    return this.#enqueue(async () => {
      const localBefore = await this.#authorizeLocalDevice();
      const internal = await this.#resolveInternalAddress(requested);
      const authorized = await this.#refreshDeviceUnlocked(internal);
      try {
        const localAfter = await this.#authorizeLocalDevice();
        if (!sameAuthorization(localBefore, localAfter)) {
          throw messagingError('AUTHORIZATION_CHANGED');
        }
        return {
          address: copyAddress(internal.external),
          assertionId: authorized.assertion.assertionId,
          revision: authorized.assertion.revision,
          expiresAtEpochMs: authorized.assertion.expiresAtEpochMs,
        };
      } finally {
        authorized.device.free();
      }
    });
  }

  async encrypt(input: PairwiseEncryptInput): Promise<PairwiseCiphertextEnvelope> {
    if (typeof input !== 'object' || input === null) {
      throw messagingError('INVALID_INPUT');
    }
    const recipient = requireAddress(input.recipient);
    if (equalAddress(recipient, this.#localInternal.external)) {
      throw messagingError('INVALID_INPUT');
    }
    const contentType = requireContentType(input.contentType);
    const plaintext = requirePlaintext(input.plaintext);

    try {
      return await this.#enqueue(async () => {
        try {
          const localBefore = await this.#authorizeLocalDevice();
          const internal = await this.#resolveInternalAddress(recipient);
          const before = await this.#refreshDeviceUnlocked(internal);
          const messageId = secureMessageId();
          try {
            const missingSessions = await this.#getMissingSessions(internal.userId);
            if (missingSessions !== null) {
              await this.#routeClaim(missingSessions);
            }

            const current = await this.#authorizeKnownDevice(internal);
            try {
              if (!sameAuthorization(before.assertion, current.assertion)) {
                throw messagingError('AUTHORIZATION_CHANGED');
              }

              const inner: InnerPairwiseContent = {
                version: 1,
                messageId,
                sender: copyAddress(this.#localInternal.external),
                recipient: copyAddress(recipient),
                contentType,
                body: encodeBase64Url(plaintext),
              };

              let encryptedJson: string;
              try {
                encryptedJson = await current.device.encryptToDeviceEvent(
                  PAIRWISE_EVENT_TYPE,
                  inner,
                );
              } catch (error) {
                mapEngineFailure(error, 'SESSION_UNAVAILABLE');
              }
              const encryptedContent = parseJsonRecord(encryptedJson, 'ENCRYPTION_FAILED');
              if (
                encryptedContent.algorithm !== 'm.olm.v1.curve25519-aes-sha2' ||
                encryptedContent.sender_key !== this.#localBinding.curve25519PublicKey ||
                getRecord(encryptedContent.ciphertext) === undefined
              ) {
                throw messagingError('ENCRYPTION_FAILED');
              }

              const after = await this.#authorizeKnownDevice(internal);
              try {
                if (!sameAuthorization(current.assertion, after.assertion)) {
                  throw messagingError('AUTHORIZATION_CHANGED');
                }
              } finally {
                after.device.free();
              }

              const signingFields: PairwiseEnvelopeSigningFields = {
                version: 1,
                protocol: PAIRWISE_ENVELOPE_PROTOCOL,
                algorithm: 'olm-v1',
                messageId,
                sender: copyAddress(this.#localInternal.external),
                recipient: copyAddress(recipient),
                ciphertext: encodeBase64Url(encodeUtf8(encryptedJson)),
              };
              const signature = await this.#signEnvelope(signingFields);
              const localAfter = await this.#authorizeLocalDevice();
              if (!sameAuthorization(localBefore, localAfter)) {
                throw messagingError('AUTHORIZATION_CHANGED');
              }

              return {
                ...signingFields,
                signature: {
                  algorithm: 'ed25519',
                  value: signature,
                },
              };
            } finally {
              current.device.free();
            }
          } finally {
            before.device.free();
          }
        } catch (error) {
          if (error instanceof PairwiseMessagingError) {
            throw error;
          }
          throw messagingError('ENCRYPTION_FAILED');
        }
      });
    } finally {
      plaintext.fill(0);
    }
  }

  async decrypt(input: PairwiseDecryptInput): Promise<PairwiseDecryptedMessage> {
    if (typeof input !== 'object' || input === null) {
      throw messagingError('INVALID_ENVELOPE');
    }
    const parsed = parseEnvelope(input.envelope);
    if (!equalAddress(parsed.envelope.recipient, this.#localInternal.external)) {
      throw messagingError('WRONG_RECIPIENT');
    }

    return this.#enqueue(async () => {
      try {
        const localBefore = await this.#authorizeLocalDevice();
        const senderInternal = await this.#resolveInternalAddress(parsed.envelope.sender);
        const before = await this.#refreshDeviceUnlocked(senderInternal);
        let processed: Awaited<ReturnType<OlmMachine['receiveSyncChanges']>>;
        try {
          if (
            parsed.encryptedContent.sender_key !== before.curve25519PublicKey ||
            !validDetachedSignature(parsed.envelope, before.ed25519PublicKey)
          ) {
            throw messagingError('DECRYPTION_FAILED');
          }
          if (this.#processedMessageIds.has(parsed.envelope.messageId)) {
            throw messagingError('DUPLICATE_MESSAGE');
          }

          const encryptedEvent = JSON.stringify([
            {
              sender: senderInternal.userId,
              type: ENCRYPTED_EVENT_TYPE,
              content: parsed.encryptedContent,
            },
          ]);
          const deviceLists = new DeviceLists();
          const settings = new DecryptionSettings(TrustRequirement.Untrusted);
          try {
            processed = await this.#machine.receiveSyncChanges(
              encryptedEvent,
              deviceLists,
              new Map(),
              undefined,
              settings,
            );
          } catch (error) {
            mapEngineFailure(error, 'DECRYPTION_FAILED');
          } finally {
            deviceLists.free();
          }

          const event = processed[0];
          if (
            processed.length !== 1 ||
            !(event instanceof DecryptedToDeviceEvent) ||
            event.type !== ProcessedToDeviceEventType.Decrypted
          ) {
            for (const item of processed) item.free();
            throw messagingError('DECRYPTION_FAILED');
          }

          let rawEvent: string;
          let engineSender: string;
          let engineSenderDevice: string | undefined;
          let engineCurve25519Key: string;
          try {
            rawEvent = event.rawEvent;
            const info = event.encryptionInfo;
            try {
              const sender = info.sender;
              const senderDevice = info.senderDevice;
              try {
                engineSender = sender.toString();
                engineSenderDevice = senderDevice?.toString();
                engineCurve25519Key = info.senderCurve25519Key;
              } finally {
                sender.free();
                senderDevice?.free();
              }
            } finally {
              info.free();
            }
          } finally {
            for (const item of processed) item.free();
          }

          if (
            engineSender !== senderInternal.userId ||
            engineSenderDevice !== senderInternal.deviceId ||
            engineCurve25519Key !== before.curve25519PublicKey
          ) {
            throw messagingError('DECRYPTION_FAILED');
          }

          const after = await this.#authorizeKnownDevice(senderInternal);
          try {
            if (!sameAuthorization(before.assertion, after.assertion)) {
              throw messagingError('AUTHORIZATION_CHANGED');
            }
          } finally {
            after.device.free();
          }
          const localAfter = await this.#authorizeLocalDevice();
          if (!sameAuthorization(localBefore, localAfter)) {
            throw messagingError('AUTHORIZATION_CHANGED');
          }

          const content = parseInnerContent(rawEvent);
          if (
            content.messageId !== parsed.envelope.messageId ||
            !equalAddress(content.sender, parsed.envelope.sender) ||
            !equalAddress(content.recipient, parsed.envelope.recipient)
          ) {
            throw messagingError('DECRYPTION_FAILED');
          }

          let plaintext: Uint8Array;
          try {
            plaintext = decodeBase64Url(content.body);
          } catch {
            throw messagingError('DECRYPTION_FAILED');
          }
          this.#rememberProcessedMessage(content.messageId);
          return {
            version: 1,
            messageId: content.messageId,
            sender: copyAddress(content.sender),
            recipient: copyAddress(content.recipient),
            contentType: content.contentType,
            plaintext,
          };
        } finally {
          before.device.free();
        }
      } catch (error) {
        if (error instanceof PairwiseMessagingError) {
          throw error;
        }
        throw messagingError('DECRYPTION_FAILED');
      }
    });
  }

  close(): Promise<void> {
    if (this.#closePromise !== undefined) {
      return this.#closePromise;
    }
    this.#state = 'closing';
    this.#lifecycle.abort(messagingError('CLOSED'));
    this.#closePromise = this.#enqueueRaw(async () => {
      this.#processedMessageIds.clear();
      this.#knownExternalAddresses.clear();
      this.#knownInternalAddresses.clear();
      this.#machine.close();
      this.#state = 'closed';
    });
    return this.#closePromise;
  }

  async #bootstrap(): Promise<void> {
    for (let pass = 0; pass < MAX_BOOTSTRAP_PASSES; pass += 1) {
      let outgoing: readonly unknown[];
      try {
        outgoing = await this.#machine.outgoingRequests();
      } catch (error) {
        mapEngineFailure(error, 'ENGINE_UNAVAILABLE');
      }
      if (outgoing.length === 0) {
        return;
      }
      for (const rawRequest of outgoing) {
        const request = engineRequest(rawRequest);
        try {
          if (request.type === RequestType.KeysUpload) {
            await this.#routeUpload(request);
          } else if (request.type === RequestType.KeysQuery) {
            await this.#routeQuery(request, this.#localInternal);
          } else {
            throw messagingError('UNSUPPORTED_ENGINE_REQUEST');
          }
        } finally {
          request.free();
        }
      }
    }
    throw messagingError('UNSUPPORTED_ENGINE_REQUEST');
  }

  async #refreshDeviceUnlocked(internal: InternalAddress): Promise<EngineDeviceAuthorization> {
    let request: EngineRequest;
    try {
      request = engineRequest(this.#machine.queryKeysForUsers([new UserId(internal.userId)]));
    } catch (error) {
      mapEngineFailure(error, 'ENGINE_UNAVAILABLE');
    }
    try {
      await this.#routeQuery(request, internal);
    } finally {
      request.free();
    }
    return this.#authorizeKnownDevice(internal);
  }

  async #getMissingSessions(userId: string): Promise<EngineRequest | null> {
    try {
      const request = await this.#machine.getMissingSessions([new UserId(userId)]);
      return request === null ? null : engineRequest(request);
    } catch (error) {
      mapEngineFailure(error, 'SESSION_UNAVAILABLE');
    }
  }

  async #authorizeLocalDevice(): Promise<CurrentDeviceAuthorization> {
    return this.#currentAuthorization(
      this.#localInternal.external,
      this.#localBinding.curve25519PublicKey,
      this.#localBinding.ed25519PublicKey,
    );
  }

  async #authorizeKnownDevice(internal: InternalAddress): Promise<EngineDeviceAuthorization> {
    const userId = new UserId(internal.userId);
    const deviceId = new DeviceId(internal.deviceId);
    let device: Device | undefined;
    try {
      device = await this.#machine.getDevice(userId, deviceId);
    } catch (error) {
      mapEngineFailure(error, 'DEVICE_NOT_FOUND');
    } finally {
      userId.free();
      deviceId.free();
    }
    if (device === undefined) {
      throw messagingError('DEVICE_NOT_FOUND');
    }

    let keys: ReturnType<typeof readDeviceKeys>;
    try {
      keys = readDeviceKeys(device);
    } catch (error) {
      device.free();
      throw error;
    }

    let assertion: CurrentDeviceAuthorization;
    try {
      assertion = await this.#currentAuthorization(
        internal.external,
        keys.curve25519PublicKey,
        keys.ed25519PublicKey,
      );
    } catch (error) {
      await this.#blacklist(device);
      device.free();
      if (error instanceof PairwiseMessagingError && error.code === 'CLOSED') {
        throw error;
      }
      throw messagingError('DEVICE_UNAUTHORIZED');
    }

    if (device.isBlacklisted()) {
      try {
        await device.setLocalTrust(LocalTrust.Unset);
      } catch {
        device.free();
        throw messagingError('DEVICE_UNAUTHORIZED');
      }
    }
    return {
      device,
      assertion,
      ...keys,
    };
  }

  async #currentAuthorization(
    address: SocialDeviceAddress,
    curve25519PublicKey: string,
    ed25519PublicKey: string,
  ): Promise<CurrentDeviceAuthorization> {
    let candidate: CurrentDeviceAuthorization | null;
    try {
      candidate = await this.#runBounded(
        this.#authorizationTimeoutMs,
        'DEVICE_UNAUTHORIZED',
        async (context) =>
          this.#authorizationResolver.getCurrentDeviceAuthorization(copyAddress(address), context),
      );
    } catch (error) {
      if (error instanceof PairwiseMessagingError && error.code === 'CLOSED') {
        throw error;
      }
      throw messagingError('DEVICE_UNAUTHORIZED');
    }
    return requireActiveAuthorization(
      candidate,
      address,
      curve25519PublicKey,
      ed25519PublicKey,
      Date.now(),
    );
  }

  async #blacklist(device: Device): Promise<void> {
    try {
      await device.setLocalTrust(LocalTrust.BlackListed);
    } catch {
      // Authorization remains denied even if the engine cannot persist the
      // additional local marker. Never expose the upstream error.
    }
  }

  async #signEnvelope(envelope: PairwiseEnvelopeSigningFields): Promise<string> {
    let signatures: Awaited<ReturnType<OlmMachine['sign']>>;
    try {
      signatures = await this.#machine.sign(envelopeSigningMessage(envelope));
    } catch (error) {
      mapEngineFailure(error, 'ENCRYPTION_FAILED');
    }

    let signatureJson: string;
    try {
      signatureJson = signatures.asJSON();
    } finally {
      signatures.free();
    }
    const parsed = parseJsonRecord(signatureJson, 'ENCRYPTION_FAILED');
    const signer = getRecord(parsed[this.#localInternal.userId]);
    const value = signer?.[`ed25519:${this.#localInternal.deviceId}`];
    if (typeof value !== 'string') {
      throw messagingError('ENCRYPTION_FAILED');
    }
    let signatureBytes: Uint8Array;
    try {
      signatureBytes = decodeUnpaddedBase64(value, 64);
    } catch {
      throw messagingError('ENCRYPTION_FAILED');
    }
    if (signatureBytes.byteLength !== 64) {
      throw messagingError('ENCRYPTION_FAILED');
    }
    const signedEnvelope: PairwiseCiphertextEnvelope = {
      ...envelope,
      signature: {
        algorithm: 'ed25519',
        value,
      },
    };
    if (!validDetachedSignature(signedEnvelope, this.#localBinding.ed25519PublicKey)) {
      throw messagingError('ENCRYPTION_FAILED');
    }
    return value;
  }

  async #routeUpload(request: EngineRequest): Promise<void> {
    const response = await this.#exchangeDirectory('keys-upload', request.body);
    const parsed = parseJsonRecord(response, 'DIRECTORY_PROTOCOL_ERROR');
    const counts = getRecord(parsed.one_time_key_counts);
    if (counts === undefined) {
      throw messagingError('DIRECTORY_PROTOCOL_ERROR');
    }
    const sanitizedCounts: Record<string, number> = {};
    for (const [algorithm, count] of Object.entries(counts)) {
      if (
        !/^[a-z0-9_.-]{1,128}$/u.test(algorithm) ||
        !Number.isSafeInteger(count) ||
        (count as number) < 0
      ) {
        throw messagingError('DIRECTORY_PROTOCOL_ERROR');
      }
      sanitizedCounts[algorithm] = count as number;
    }
    await this.#markRequestSent(request, JSON.stringify({ one_time_key_counts: sanitizedCounts }));
  }

  async #routeQuery(request: EngineRequest, expected: InternalAddress): Promise<void> {
    const response = await this.#exchangeDirectory('keys-query', request.body);
    const parsed = parseJsonRecord(response, 'DIRECTORY_PROTOCOL_ERROR');
    requireEmptyFailures(parsed);
    const deviceKeys = getRecord(parsed.device_keys);
    if (deviceKeys === undefined) {
      throw messagingError('DIRECTORY_PROTOCOL_ERROR');
    }
    const userDevices = getRecord(deviceKeys[expected.userId]);
    const exactDevice = getRecord(userDevices?.[expected.deviceId]);
    if (
      exactDevice !== undefined &&
      (exactDevice.user_id !== expected.userId || exactDevice.device_id !== expected.deviceId)
    ) {
      throw messagingError('DIRECTORY_PROTOCOL_ERROR');
    }
    const sanitizedUserDevices =
      exactDevice === undefined ? {} : { [expected.deviceId]: exactDevice };
    const sanitized = {
      device_keys: {
        [expected.userId]: sanitizedUserDevices,
      },
      failures: {},
    };
    await this.#markRequestSent(request, JSON.stringify(sanitized));
  }

  async #routeClaim(request: EngineRequest): Promise<void> {
    try {
      const requested = this.#claimTargets(request.body);
      const before = new Map<string, CurrentDeviceAuthorization>();
      for (const internal of requested) {
        const authorized = await this.#authorizeKnownDevice(internal);
        try {
          before.set(internalAddressKey(internal.userId, internal.deviceId), authorized.assertion);
        } finally {
          authorized.device.free();
        }
      }

      const response = await this.#exchangeDirectory('keys-claim', request.body);
      const parsed = parseJsonRecord(response, 'DIRECTORY_PROTOCOL_ERROR');
      requireEmptyFailures(parsed);
      const oneTimeKeys = getRecord(parsed.one_time_keys);
      if (oneTimeKeys === undefined) {
        throw messagingError('DIRECTORY_PROTOCOL_ERROR');
      }

      const sanitized: Record<string, Record<string, Record<string, unknown>>> = {};
      for (const internal of requested) {
        const userKeys = getRecord(oneTimeKeys[internal.userId]);
        const deviceKeys = getRecord(userKeys?.[internal.deviceId]);
        const sanitizedUser = sanitized[internal.userId] ?? {};
        sanitizedUser[internal.deviceId] = deviceKeys ?? {};
        sanitized[internal.userId] = sanitizedUser;
      }
      await this.#markRequestSent(
        request,
        JSON.stringify({ one_time_keys: sanitized, failures: {} }),
      );

      for (const internal of requested) {
        const after = await this.#authorizeKnownDevice(internal);
        try {
          const prior = before.get(internalAddressKey(internal.userId, internal.deviceId));
          if (prior === undefined || !sameAuthorization(prior, after.assertion)) {
            throw messagingError('AUTHORIZATION_CHANGED');
          }
        } finally {
          after.device.free();
        }
      }
    } finally {
      request.free();
    }
  }

  #claimTargets(body: string): InternalAddress[] {
    const parsed = parseJsonRecord(body, 'DIRECTORY_PROTOCOL_ERROR');
    const requested = getRecord(parsed.one_time_keys);
    if (requested === undefined) {
      throw messagingError('DIRECTORY_PROTOCOL_ERROR');
    }
    const result: InternalAddress[] = [];
    for (const [userId, rawDevices] of Object.entries(requested)) {
      const devices = getRecord(rawDevices);
      if (devices === undefined) {
        throw messagingError('DIRECTORY_PROTOCOL_ERROR');
      }
      for (const [deviceId, algorithm] of Object.entries(devices)) {
        if (algorithm !== 'signed_curve25519') {
          throw messagingError('UNSUPPORTED_ENGINE_REQUEST');
        }
        const known = this.#knownInternalAddresses.get(internalAddressKey(userId, deviceId));
        if (known === undefined || equalAddress(known.external, this.localDevice)) {
          throw messagingError('DEVICE_UNAUTHORIZED');
        }
        result.push(known);
      }
    }
    if (result.length === 0) {
      throw messagingError('SESSION_UNAVAILABLE');
    }
    return result;
  }

  async #exchangeDirectory(operation: KeyDirectoryOperation, body: string): Promise<string> {
    const bodyBytes = encodeUtf8(body);
    if (bodyBytes.byteLength > MAX_DIRECTORY_BODY_BYTES) {
      throw messagingError('DIRECTORY_PROTOCOL_ERROR');
    }
    let response: unknown;
    try {
      response = await this.#runBounded(
        this.#directoryTimeoutMs,
        'DIRECTORY_UNAVAILABLE',
        async (context) =>
          this.#keyDirectory.exchange({
            version: 1,
            operation,
            opaqueBody: bodyBytes,
            ...context,
          }),
      );
    } catch (error) {
      if (error instanceof PairwiseMessagingError && error.code === 'CLOSED') {
        throw error;
      }
      throw messagingError('DIRECTORY_UNAVAILABLE');
    }
    if (
      typeof response !== 'object' ||
      response === null ||
      (response as { readonly version?: unknown }).version !== 1 ||
      !((response as { readonly opaqueBody?: unknown }).opaqueBody instanceof Uint8Array)
    ) {
      throw messagingError('DIRECTORY_PROTOCOL_ERROR');
    }
    const responseBytes = (response as { readonly opaqueBody: Uint8Array }).opaqueBody;
    if (responseBytes.byteLength === 0 || responseBytes.byteLength > DIRECTORY_RESPONSE_MAX_BYTES) {
      throw messagingError('DIRECTORY_PROTOCOL_ERROR');
    }
    try {
      return directoryDecoder.decode(responseBytes);
    } catch {
      throw messagingError('DIRECTORY_PROTOCOL_ERROR');
    }
  }

  async #markRequestSent(request: EngineRequest, response: string): Promise<void> {
    try {
      await this.#machine.markRequestAsSent(request.id, request.type, response);
    } catch (error) {
      mapEngineFailure(error, 'ENGINE_UNAVAILABLE');
    }
  }

  async #runBounded<T>(
    timeoutMs: number,
    timeoutCode: 'DEVICE_UNAUTHORIZED' | 'DIRECTORY_UNAVAILABLE',
    operation: (context: BoundedRequestContext) => Promise<T>,
  ): Promise<T> {
    const lifecycleSignal = this.#lifecycle.signal;
    if (lifecycleSignal.aborted) {
      throw lifecycleSignal.reason instanceof PairwiseMessagingError
        ? lifecycleSignal.reason
        : messagingError('CLOSED');
    }

    const controller = new AbortController();
    const forwardLifecycleAbort = (): void => {
      controller.abort(
        lifecycleSignal.reason instanceof PairwiseMessagingError
          ? lifecycleSignal.reason
          : messagingError('CLOSED'),
      );
    };
    lifecycleSignal.addEventListener('abort', forwardLifecycleAbort, { once: true });

    const deadlineEpochMs = Date.now() + timeoutMs;
    const timeout = setTimeout(() => {
      controller.abort(messagingError(timeoutCode));
    }, timeoutMs);
    let rejectForAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      rejectForAbort = () => {
        reject(
          controller.signal.reason instanceof PairwiseMessagingError
            ? controller.signal.reason
            : messagingError(timeoutCode),
        );
      };
      if (controller.signal.aborted) {
        rejectForAbort();
      } else {
        controller.signal.addEventListener('abort', rejectForAbort, { once: true });
      }
    });

    try {
      return await Promise.race([
        Promise.resolve().then(async () =>
          operation({
            signal: controller.signal,
            deadlineEpochMs,
          }),
        ),
        aborted,
      ]);
    } finally {
      clearTimeout(timeout);
      lifecycleSignal.removeEventListener('abort', forwardLifecycleAbort);
      if (rejectForAbort !== undefined) {
        controller.signal.removeEventListener('abort', rejectForAbort);
      }
      if (!controller.signal.aborted) {
        controller.abort(messagingError('CLOSED'));
      }
    }
  }

  async #resolveInternalAddress(address: SocialDeviceAddress): Promise<InternalAddress> {
    const externalKey = externalAddressKey(address);
    const existing = this.#knownExternalAddresses.get(externalKey);
    if (existing !== undefined) {
      return existing;
    }
    const internal = await deriveInternalAddress(address);
    this.#registerInternalAddress(internal);
    return internal;
  }

  #registerInternalAddress(internal: InternalAddress): void {
    const internalKey = internalAddressKey(internal.userId, internal.deviceId);
    const externalKey = externalAddressKey(internal.external);
    const internalCollision = this.#knownInternalAddresses.get(internalKey);
    const externalCollision = this.#knownExternalAddresses.get(externalKey);
    if (
      (internalCollision !== undefined &&
        !equalAddress(internalCollision.external, internal.external)) ||
      (externalCollision !== undefined &&
        (externalCollision.userId !== internal.userId ||
          externalCollision.deviceId !== internal.deviceId))
    ) {
      throw messagingError('INVALID_INPUT');
    }
    this.#knownInternalAddresses.set(internalKey, internal);
    this.#knownExternalAddresses.set(externalKey, internal);
  }

  #rememberProcessedMessage(messageId: string): void {
    if (this.#processedMessageIds.size >= this.#replayWindowSize) {
      const oldest = this.#processedMessageIds.values().next().value;
      if (typeof oldest === 'string') {
        this.#processedMessageIds.delete(oldest);
      }
    }
    this.#processedMessageIds.add(messageId);
  }

  #enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#state !== 'open') {
      return Promise.reject(messagingError('CLOSED'));
    }
    const result = this.#serialTail.then(operation, operation);
    this.#serialTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  #enqueueRaw(operation: () => Promise<void>): Promise<void> {
    const result = this.#serialTail.then(operation, operation);
    this.#serialTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export async function createPairwiseDevice(
  options: CreatePairwiseDeviceOptions,
): Promise<PairwiseMessagingDevice> {
  return PairwiseMessagingDeviceImplementation.create(options);
}
