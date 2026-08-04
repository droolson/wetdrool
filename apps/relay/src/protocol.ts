import { ed25519 } from '@noble/curves/ed25519.js';
import {
  decodeMultibaseBase64Url,
  digestSchema,
  digestSha256Multibase,
  encodeMultibaseBase64Url,
  identityIdSchema,
  nonceSchema,
  objectIdSchema,
  publicKeyFromSigningKeyId,
  signatureSchema,
  signingKeyIdSchema,
  timestampSchema,
  utf8,
} from '@wetdrool/protocol';
import bs58 from 'bs58';
import { canonicalize } from 'json-canonicalize';
import { z } from 'zod';

import { RELAY_POLICY, RELAY_PROTOCOL, RELAY_PROTOCOL_VERSION } from './policy.js';

const identifierSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u);
const mediaTypeSchema = z.string().regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u);
const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/u);
const relayCriticalSchema = z
  .array(z.enum(['relay.audience.v1', 'relay.e2ee.v1', 'relay.expiry.v1']))
  .max(3)
  .superRefine((value, context) => {
    if (new Set(value).size !== value.length) {
      context.addIssue({
        code: 'custom',
        message: 'Critical relay features must be unique.',
      });
    }
  });
const extensionNameSchema = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9.-]{0,62}$/u;
const relayExtensionsSchema = z
  .record(z.string().regex(extensionNameSchema), z.unknown())
  .refine((value) => Object.keys(value).length <= 4, 'At most four relay extensions are allowed.');

export const relayEventKindSchema = z.enum([
  'community-update',
  'encrypted-message',
  'live-reaction',
  'livestream-signal',
  'new-post',
  'presence',
  'typing',
]);
export type RelayEventKind = z.infer<typeof relayEventKindSchema>;

export const relayAudienceSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('public') }).strict(),
    z
      .object({
        kind: z.literal('identity'),
        recipients: z.array(identityIdSchema).min(1).max(8),
      })
      .strict(),
    z
      .object({
        kind: z.literal('community'),
        communityId: objectIdSchema,
      })
      .strict(),
  ])
  .superRefine((value, context) => {
    if (value.kind === 'identity' && new Set(value.recipients).size !== value.recipients.length) {
      context.addIssue({
        code: 'custom',
        path: ['recipients'],
        message: 'Direct audience recipients must be unique.',
      });
    }
  });
export type RelayAudience = z.infer<typeof relayAudienceSchema>;

const newPostPayloadSchema = z
  .object({
    objectId: objectIdSchema,
    manifestCid: z.string().regex(/^b[a-z2-7]{20,120}$/u),
    transactionSignature: z
      .string()
      .regex(/^[1-9A-HJ-NP-Za-km-z]{80,96}$/u)
      .refine(isExactSolanaSignature, 'DroolNet transaction signature must decode to 64 bytes.')
      .optional(),
    slot: z
      .string()
      .regex(/^(?:0|[1-9][0-9]{0,19})$/u)
      .refine(isU64Decimal, 'DroolNet slot must be an unsigned 64-bit decimal string.')
      .optional(),
  })
  .strict();

const typingPayloadSchema = z
  .object({
    state: z.enum(['started', 'stopped']),
    contextTag: digestSchema.optional(),
  })
  .strict();

const presencePayloadSchema = z
  .object({
    state: z.enum(['online', 'away', 'offline']),
  })
  .strict();

const liveReactionPayloadSchema = z
  .object({
    targetObjectId: objectIdSchema,
    reaction: z.enum(['care', 'celebrate', 'insightful', 'laugh', 'like', 'support']),
    action: z.enum(['add', 'remove']),
  })
  .strict();

const communityUpdatePayloadSchema = z
  .object({
    communityId: objectIdSchema,
    update: z.enum(['governance', 'membership', 'moderation', 'post']),
    objectId: objectIdSchema.optional(),
  })
  .strict();

const encryptedMessagePayloadSchema = z
  .object({
    messageId: identifierSchema,
    mediaType: z.literal('application/wetdrool-e2ee+json'),
    cipherSuite: z.enum(['x25519-xsalsa20-poly1305', 'x25519-xchacha20-poly1305']),
    senderKeyId: signingKeyIdSchema,
    ciphertext: base64UrlSchema.max(RELAY_POLICY.message.maximumCiphertextCharacters),
  })
  .strict();

const livestreamSignalPayloadSchema = z
  .object({
    sessionId: identifierSchema,
    sequence: z.number().int().nonnegative().safe(),
    signalType: z.enum(['answer', 'end', 'ice-candidate', 'offer', 'renegotiate']),
    mediaType: mediaTypeSchema.default('application/wetdrool-e2ee+json'),
    encryptedMetadata: base64UrlSchema
      .max(RELAY_POLICY.message.maximumMetadataCharacters)
      .optional(),
  })
  .strict()
  .refine(
    (value) => value.signalType === 'end' || value.encryptedMetadata !== undefined,
    'Livestream signaling metadata must be encrypted except for an end marker.',
  );

const commonUnsignedFields = {
  protocol: z.literal(RELAY_PROTOCOL),
  version: z.literal(RELAY_PROTOCOL_VERSION),
  identity: identityIdSchema,
  keyId: signingKeyIdSchema,
  issuedAt: timestampSchema,
  expiresAt: timestampSchema,
  nonce: nonceSchema,
  topic: digestSchema,
  audience: relayAudienceSchema,
  critical: relayCriticalSchema,
  extensions: relayExtensionsSchema,
};

const unsignedRelayEventVariants = [
  z
    .object({ ...commonUnsignedFields, kind: z.literal('new-post'), payload: newPostPayloadSchema })
    .strict(),
  z
    .object({ ...commonUnsignedFields, kind: z.literal('typing'), payload: typingPayloadSchema })
    .strict(),
  z
    .object({
      ...commonUnsignedFields,
      kind: z.literal('presence'),
      payload: presencePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commonUnsignedFields,
      kind: z.literal('live-reaction'),
      payload: liveReactionPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commonUnsignedFields,
      kind: z.literal('community-update'),
      payload: communityUpdatePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commonUnsignedFields,
      kind: z.literal('encrypted-message'),
      payload: encryptedMessagePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...commonUnsignedFields,
      kind: z.literal('livestream-signal'),
      payload: livestreamSignalPayloadSchema,
    })
    .strict(),
] as const;

export const unsignedRelayEventSchema = z
  .discriminatedUnion('kind', unsignedRelayEventVariants)
  .superRefine((value, context) => {
    validateIdentityKeyBinding(value.identity, value.keyId, context);
    validateCriticalFields(value.kind, value.critical, context);
    validateAudiencePayloadAgreement(value, context);
  });
export type UnsignedRelayEvent = z.infer<typeof unsignedRelayEventSchema>;

export const relayProofSchema = z
  .object({
    algorithm: z.literal('Ed25519'),
    keyId: signingKeyIdSchema,
    payloadHash: digestSchema,
    signature: signatureSchema,
  })
  .strict();
export type RelayProof = z.infer<typeof relayProofSchema>;

export const signedRelayEventSchema = z
  .object({
    message: unsignedRelayEventSchema,
    proof: relayProofSchema,
  })
  .strict();
export type SignedRelayEvent = z.infer<typeof signedRelayEventSchema>;

const subscriptionTopicSchema = z
  .object({
    topic: digestSchema,
    kinds: z
      .array(relayEventKindSchema)
      .min(1)
      .max(relayEventKindSchema.options.length)
      .superRefine((value, context) => {
        if (new Set(value).size !== value.length) {
          context.addIssue({
            code: 'custom',
            message: 'Subscribed relay event kinds must be unique.',
          });
        }
      }),
    sinceSequence: z.number().int().nonnegative().safe().optional(),
  })
  .strict();

export const unsignedSubscriptionSchema = z
  .object({
    protocol: z.literal(RELAY_PROTOCOL),
    version: z.literal(RELAY_PROTOCOL_VERSION),
    action: z.literal('subscribe'),
    identity: identityIdSchema,
    keyId: signingKeyIdSchema,
    issuedAt: timestampSchema,
    expiresAt: timestampSchema,
    nonce: nonceSchema,
    subscriptions: z
      .array(subscriptionTopicSchema)
      .min(1)
      .max(RELAY_POLICY.connection.maximumSubscriptions),
    critical: relayCriticalSchema,
    extensions: relayExtensionsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    validateIdentityKeyBinding(value.identity, value.keyId, context);
    if (!value.critical.includes('relay.expiry.v1')) {
      context.addIssue({
        code: 'custom',
        path: ['critical'],
        message: 'Subscriptions must mark relay.expiry.v1 as critical.',
      });
    }
    const topics = new Set(value.subscriptions.map((subscription) => subscription.topic));
    if (topics.size !== value.subscriptions.length) {
      context.addIssue({
        code: 'custom',
        path: ['subscriptions'],
        message: 'Subscription topics must be unique.',
      });
    }
  });
export type UnsignedSubscription = z.infer<typeof unsignedSubscriptionSchema>;

export const signedSubscriptionSchema = z
  .object({
    message: unsignedSubscriptionSchema,
    proof: relayProofSchema,
  })
  .strict();
export type SignedSubscription = z.infer<typeof signedSubscriptionSchema>;

export type RelaySignedMessage = SignedRelayEvent | SignedSubscription;

export interface RelayKeyAuthorization {
  readonly identityId: string;
  readonly keyId: string;
  readonly purpose: RelayEventKind | 'subscribe';
  readonly issuedAt: string;
}

export type RelayKeyAuthorizer = (context: RelayKeyAuthorization) => boolean | Promise<boolean>;

export class RelayProtocolError extends Error {
  override readonly name = 'RelayProtocolError';

  constructor(
    message: string,
    readonly code:
      | 'expired'
      | 'future-timestamp'
      | 'invalid-envelope'
      | 'invalid-signature'
      | 'key-not-authorized'
      | 'lifetime-too-long'
      | 'payload-hash-mismatch'
      | 'stale-timestamp',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface VerifyRelayOptions {
  /**
   * A clock callback is required when verification can await external policy
   * I/O. A fixed Date remains supported for deterministic callers and tests.
   */
  readonly now?: Date | (() => Date);
  readonly authorize?: RelayKeyAuthorizer;
}

export interface VerifiedRelayEvent {
  readonly canonicalBytes: Uint8Array;
  readonly envelope: SignedRelayEvent;
  readonly eventId: string;
}

export interface VerifiedSubscription {
  readonly canonicalBytes: Uint8Array;
  readonly envelope: SignedSubscription;
  readonly subscriptionId: string;
}

export function signRelayEvent(
  input: UnsignedRelayEvent,
  privateKey: Uint8Array,
): SignedRelayEvent {
  const message = unsignedRelayEventSchema.parse(input);
  return signMessage(message, privateKey);
}

export function signSubscription(
  input: UnsignedSubscription,
  privateKey: Uint8Array,
): SignedSubscription {
  const message = unsignedSubscriptionSchema.parse(input);
  return signMessage(message, privateKey);
}

export async function verifyRelayEvent(
  input: unknown,
  options: VerifyRelayOptions = {},
): Promise<VerifiedRelayEvent> {
  let envelope: SignedRelayEvent;
  try {
    envelope = signedRelayEventSchema.parse(input);
  } catch (error) {
    throw new RelayProtocolError('Relay event envelope is invalid.', 'invalid-envelope', {
      cause: error,
    });
  }
  await verifyMessage(envelope, envelope.message.kind, options);
  const canonicalBytes = canonicalBytesOf(envelope);
  return {
    canonicalBytes,
    envelope,
    eventId: digestSha256Multibase(canonicalBytes),
  };
}

export async function verifySubscription(
  input: unknown,
  options: VerifyRelayOptions = {},
): Promise<VerifiedSubscription> {
  let envelope: SignedSubscription;
  try {
    envelope = signedSubscriptionSchema.parse(input);
  } catch (error) {
    throw new RelayProtocolError('Relay subscription envelope is invalid.', 'invalid-envelope', {
      cause: error,
    });
  }
  await verifyMessage(envelope, 'subscribe', options);
  const canonicalBytes = canonicalBytesOf(envelope);
  return {
    canonicalBytes,
    envelope,
    subscriptionId: digestSha256Multibase(canonicalBytes),
  };
}

export function canonicalRelayBytes(value: RelaySignedMessage): Uint8Array {
  const parsed =
    'kind' in value.message
      ? signedRelayEventSchema.parse(value)
      : signedSubscriptionSchema.parse(value);
  return canonicalBytesOf(parsed);
}

export function relayTopicFor(value: string): string {
  if (value.length === 0 || value.length > 1_024) {
    throw new RelayProtocolError(
      'Topic source must contain 1 to 1,024 characters.',
      'invalid-envelope',
    );
  }
  return digestSha256Multibase(utf8(`wetdrool.com/relay/topic/v1\0${value}`));
}

function signMessage<T extends UnsignedRelayEvent | UnsignedSubscription>(
  message: T,
  privateKey: Uint8Array,
): { message: T; proof: RelayProof } {
  if (privateKey.byteLength !== 32) {
    throw new RelayProtocolError('Ed25519 private keys must contain 32 bytes.', 'invalid-envelope');
  }
  const publicKey = publicKeyFromSigningKeyId(message.keyId);
  const actualPublicKey = ed25519.getPublicKey(privateKey);
  if (publicKey.some((byte, index) => byte !== actualPublicKey[index])) {
    throw new RelayProtocolError(
      'Private key does not match the relay key ID.',
      'invalid-envelope',
    );
  }
  const payloadHash = digestSha256Multibase(canonicalBytesOf(message));
  const signature = ed25519.sign(signatureDescriptor(message.keyId, payloadHash), privateKey);
  return {
    message,
    proof: {
      algorithm: 'Ed25519',
      keyId: message.keyId,
      payloadHash,
      signature: encodeMultibaseBase64Url(signature),
    },
  };
}

async function verifyMessage(
  envelope: RelaySignedMessage,
  purpose: RelayEventKind | 'subscribe',
  options: VerifyRelayOptions,
): Promise<void> {
  const { message, proof } = envelope;
  if (proof.keyId !== message.keyId) {
    throw new RelayProtocolError(
      'Proof key ID does not match message key ID.',
      'invalid-signature',
    );
  }
  assertRelayMessageCurrent(message, resolveRelayNow(options.now));
  const payloadHash = digestSha256Multibase(canonicalBytesOf(message));
  if (payloadHash !== proof.payloadHash) {
    throw new RelayProtocolError(
      'Relay message payload hash does not match proof.',
      'payload-hash-mismatch',
    );
  }
  let valid = false;
  try {
    valid = ed25519.verify(
      decodeMultibaseBase64Url(proof.signature, 64),
      signatureDescriptor(message.keyId, payloadHash),
      publicKeyFromSigningKeyId(message.keyId),
    );
  } catch (error) {
    throw new RelayProtocolError('Relay signature could not be decoded.', 'invalid-signature', {
      cause: error,
    });
  }
  if (!valid) {
    throw new RelayProtocolError('Relay signature is invalid.', 'invalid-signature');
  }
  if (options.authorize !== undefined) {
    const authorized = await options.authorize({
      identityId: message.identity,
      keyId: message.keyId,
      purpose,
      issuedAt: message.issuedAt,
    });
    // External authorization must not extend a signed envelope's lifetime.
    assertRelayMessageCurrent(message, resolveRelayNow(options.now));
    if (!authorized) {
      throw new RelayProtocolError('Relay signing key is not authorized.', 'key-not-authorized');
    }
  }
}

/**
 * Rechecks the signed wall-clock bounds after an asynchronous authorization
 * dependency returns. Signature verification at frame-arrival time does not
 * make an envelope live indefinitely while policy I/O is in flight.
 */
export function assertRelayMessageCurrent(
  message: Readonly<{ issuedAt: string; expiresAt: string }>,
  now: Date = new Date(),
): void {
  validateTimes(message.issuedAt, message.expiresAt, now);
}

function resolveRelayNow(now: VerifyRelayOptions['now']): Date {
  return typeof now === 'function' ? now() : (now ?? new Date());
}

function signatureDescriptor(keyId: string, payloadHash: string): Uint8Array {
  return canonicalBytesOf({
    algorithm: 'Ed25519',
    domain: 'wetdrool.com/relay/signed-envelope',
    keyId,
    payloadHash,
    version: RELAY_PROTOCOL_VERSION,
  });
}

function canonicalBytesOf(value: unknown): Uint8Array {
  const encoded = canonicalize(value);
  if (encoded === undefined) {
    throw new RelayProtocolError('Relay value cannot be canonicalized.', 'invalid-envelope');
  }
  return utf8(encoded);
}

function validateTimes(issuedAt: string, expiresAt: string, now: Date): void {
  const issued = Date.parse(issuedAt);
  const expires = Date.parse(expiresAt);
  const current = now.getTime();
  if (issued > current + RELAY_POLICY.clock.maximumFutureSkewMilliseconds) {
    throw new RelayProtocolError(
      'Relay message timestamp is too far in the future.',
      'future-timestamp',
    );
  }
  if (issued < current - RELAY_POLICY.clock.maximumPastAgeMilliseconds) {
    throw new RelayProtocolError('Relay message timestamp is stale.', 'stale-timestamp');
  }
  if (expires <= current || expires <= issued) {
    throw new RelayProtocolError('Relay message has expired.', 'expired');
  }
  if (expires - issued > RELAY_POLICY.clock.maximumLifetimeMilliseconds) {
    throw new RelayProtocolError('Relay message lifetime exceeds policy.', 'lifetime-too-long');
  }
}

function validateIdentityKeyBinding(
  identity: string,
  keyId: string,
  context: z.core.$RefinementCtx,
): void {
  if (!keyId.startsWith(`${identity}#`)) {
    context.addIssue({
      code: 'custom',
      path: ['keyId'],
      message: 'Relay key ID must belong to the declared protocol identity.',
    });
  }
}

function validateCriticalFields(
  kind: RelayEventKind,
  critical: readonly string[],
  context: z.core.$RefinementCtx,
): void {
  for (const required of ['relay.audience.v1', 'relay.expiry.v1']) {
    if (!critical.includes(required)) {
      context.addIssue({
        code: 'custom',
        path: ['critical'],
        message: `${required} must be marked critical.`,
      });
    }
  }
  const isEncrypted = kind === 'encrypted-message' || kind === 'livestream-signal';
  if (isEncrypted !== critical.includes('relay.e2ee.v1')) {
    context.addIssue({
      code: 'custom',
      path: ['critical'],
      message: 'relay.e2ee.v1 must be critical exactly for encrypted relay payloads.',
    });
  }
}

function validateAudiencePayloadAgreement(
  value: UnsignedRelayEvent,
  context: z.core.$RefinementCtx,
): void {
  if (
    (value.kind === 'typing' || value.kind === 'encrypted-message') &&
    value.audience.kind !== 'identity'
  ) {
    context.addIssue({
      code: 'custom',
      path: ['audience'],
      message: `${value.kind} events require an identity audience.`,
    });
  }
  if (
    value.kind === 'community-update' &&
    (value.audience.kind !== 'community' ||
      value.audience.communityId !== value.payload.communityId)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['audience'],
      message: 'Community update audience must match its community.',
    });
  }
  if (value.kind === 'encrypted-message' && value.payload.senderKeyId !== value.keyId) {
    context.addIssue({
      code: 'custom',
      path: ['payload', 'senderKeyId'],
      message: 'Encrypted message sender key must match the signed relay key.',
    });
  }
  const lifetime = Date.parse(value.expiresAt) - Date.parse(value.issuedAt);
  const shortLivedMaximum =
    value.kind === 'typing'
      ? 30_000
      : value.kind === 'presence' || value.kind === 'livestream-signal'
        ? 120_000
        : undefined;
  if (shortLivedMaximum !== undefined && lifetime > shortLivedMaximum) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: `${value.kind} metadata exceeds its minimized lifetime.`,
    });
  }
}

function isExactSolanaSignature(value: string): boolean {
  try {
    return bs58.decode(value).byteLength === 64;
  } catch {
    return false;
  }
}

function isU64Decimal(value: string): boolean {
  try {
    return BigInt(value) <= 18_446_744_073_709_551_615n;
  } catch {
    return false;
  }
}
