import { canonicalize } from 'json-canonicalize';

import { assertIntrinsicObjectAuthorization } from './authorization.js';
import { utf8 } from './encoding.js';
import {
  portablePayloadSchema,
  signedEnvelopeSchema,
  type PortablePayload,
  type SignedEnvelope,
} from './schemas.js';
import { assertCanonicalInput, ProtocolValidationError } from './validation.js';

function canonicalJson(value: unknown): string {
  assertCanonicalInput(value);
  const serialized = canonicalize(value);
  if (serialized === undefined) {
    throw new ProtocolValidationError('Value cannot be canonicalized.');
  }
  return serialized;
}

export function canonicalizePayload(payload: PortablePayload): Uint8Array {
  const validated = portablePayloadSchema.parse(payload);
  assertSigningKeyBelongsToAuthor(validated);
  assertIntrinsicObjectAuthorization(validated);
  return utf8(canonicalJson(validated));
}

export function canonicalizeEnvelope(envelope: SignedEnvelope): Uint8Array {
  const validated = signedEnvelopeSchema.parse(envelope);
  assertSigningKeyBelongsToAuthor(validated.payload);
  assertIntrinsicObjectAuthorization(validated.payload);
  return utf8(canonicalJson(validated));
}

export function canonicalizeProofDescriptor(descriptor: ProofDescriptor): Uint8Array {
  return utf8(canonicalJson(descriptor));
}

export function decodeCanonicalEnvelope(bytes: Uint8Array): SignedEnvelope {
  let decoded: unknown;
  try {
    decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ProtocolValidationError('Envelope bytes must contain valid UTF-8 JSON.');
  }

  const envelope = signedEnvelopeSchema.parse(decoded);
  assertSigningKeyBelongsToAuthor(envelope.payload);
  assertIntrinsicObjectAuthorization(envelope.payload);
  const canonical = canonicalizeEnvelope(envelope);

  if (
    canonical.byteLength !== bytes.byteLength ||
    canonical.some((byte, index) => byte !== bytes[index])
  ) {
    throw new ProtocolValidationError('Envelope bytes are not the canonical representation.');
  }

  return envelope;
}

export function assertSigningKeyBelongsToAuthor(payload: PortablePayload): void {
  if (!payload.signingKey.startsWith(`${payload.author}#`)) {
    throw new ProtocolValidationError('The signing key must belong to the payload author.');
  }
}

export interface ProofDescriptor {
  readonly domain: 'woke.social/protocol/signed-object';
  readonly version: 1;
  readonly algorithm: 'Ed25519';
  readonly keyId: string;
  readonly network: string;
  readonly objectType: string;
  readonly payloadHash: string;
}
