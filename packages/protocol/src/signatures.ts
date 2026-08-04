import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  assertIntrinsicObjectAuthorization,
  authorizationRequirementFor,
  type ObjectAuthorizationRequirement,
} from './authorization.js';
import {
  canonicalizeEnvelope,
  canonicalizePayload,
  canonicalizeProofDescriptor,
  decodeCanonicalEnvelope,
  type ProofDescriptor,
} from './canonical.js';
import { SIGNATURE_DOMAIN } from './constants.js';
import {
  decodeMultibaseBase64Url,
  digestSha256Multibase,
  encodeMultibaseBase64Url,
} from './encoding.js';
import { getContentCid, getObjectId } from './identifiers.js';
import {
  currentPortablePayloadSchema,
  signedEnvelopeSchema,
  type CurrentSignedEnvelope,
  type PortablePayload,
  type SignedEnvelope,
} from './schemas.js';
import { ProtocolValidationError } from './validation.js';

export interface VerifiedEnvelope {
  readonly envelope: SignedEnvelope;
  readonly canonicalBytes: Uint8Array;
  readonly objectId: string;
  readonly cid: string;
  readonly publicKey: Uint8Array;
}

export interface AuthorizationContext {
  readonly author: string;
  readonly keyId: string;
  readonly objectType: string;
  readonly createdAt: string;
  readonly objectId: string;
  readonly payload: PortablePayload;
  readonly requirement: ObjectAuthorizationRequirement;
}

export type AuthorizationVerifier = (context: AuthorizationContext) => boolean | Promise<boolean>;

export interface PayloadSigningRequest {
  readonly algorithm: 'Ed25519';
  readonly keyId: string;
  /**
   * Exact canonical proof-descriptor bytes. Implementations must sign these
   * bytes without prefixing, hashing, or replacing them.
   */
  readonly message: Uint8Array;
  readonly purpose: 'wetdrool-portable-object-v1';
}

export type PayloadSigner = (request: PayloadSigningRequest) => Uint8Array | Promise<Uint8Array>;

function descriptorFor(payload: PortablePayload, payloadHash: string): ProofDescriptor {
  return {
    domain: SIGNATURE_DOMAIN,
    version: 1,
    algorithm: 'Ed25519',
    keyId: payload.signingKey,
    network: payload.network,
    objectType: payload.type,
    payloadHash,
  };
}

export function publicKeyFromSigningKeyId(keyId: string): Uint8Array {
  const separator = keyId.lastIndexOf('/');
  if (separator < 0 || separator === keyId.length - 1) {
    throw new ProtocolValidationError('Signing key ID has no public key.');
  }

  let publicKey: Uint8Array;
  try {
    publicKey = bs58.decode(keyId.slice(separator + 1));
  } catch {
    throw new ProtocolValidationError('Signing key ID contains invalid base58.');
  }

  if (publicKey.byteLength !== 32) {
    throw new ProtocolValidationError('Ed25519 public keys must contain 32 bytes.');
  }

  return publicKey;
}

export function signingKeyIdFor(
  author: string,
  publicKey: Uint8Array,
  kind: 'root' | 'delegation' = 'delegation',
): string {
  if (publicKey.byteLength !== 32) {
    throw new ProtocolValidationError('Ed25519 public keys must contain 32 bytes.');
  }
  return `${author}#${kind}/${bs58.encode(publicKey)}`;
}

export function signPayload(input: PortablePayload, privateKey: Uint8Array): CurrentSignedEnvelope {
  if (privateKey.byteLength !== 32) {
    throw new ProtocolValidationError('Ed25519 private keys must contain 32 bytes.');
  }

  const payload = currentPortablePayloadSchema.parse(input);
  assertIntrinsicObjectAuthorization(payload);
  const expectedPublicKey = publicKeyFromSigningKeyId(payload.signingKey);
  const actualPublicKey = ed25519.getPublicKey(privateKey);
  if (!ed25519.utils.isValidPublicKey(expectedPublicKey)) {
    throw new ProtocolValidationError('Signing key is not a valid Ed25519 key.');
  }
  if (expectedPublicKey.some((byte, index) => byte !== actualPublicKey[index])) {
    throw new ProtocolValidationError('Private key does not match payload.signingKey.');
  }

  const payloadHash = digestSha256Multibase(canonicalizePayload(payload));
  const descriptor = descriptorFor(payload, payloadHash);
  const signature = ed25519.sign(canonicalizeProofDescriptor(descriptor), privateKey);

  return {
    payload,
    proof: {
      algorithm: 'Ed25519',
      keyId: payload.signingKey,
      payloadHash,
      signature: encodeMultibaseBase64Url(signature),
    },
  };
}

/**
 * Signs a portable object through an operation-scoped external signer.
 *
 * This is the passkey, hardware-wallet, and delegated-signer seam: callers
 * receive only the exact public descriptor bytes and never need to export key
 * material into the protocol package. The returned detached signature is
 * verified against `payload.signingKey` before an envelope is constructed.
 */
export async function signPayloadWithSigner(
  input: PortablePayload,
  signer: PayloadSigner,
): Promise<CurrentSignedEnvelope> {
  if (typeof signer !== 'function') {
    throw new ProtocolValidationError('A payload signer is required.');
  }

  const payload = currentPortablePayloadSchema.parse(input);
  assertIntrinsicObjectAuthorization(payload);
  const publicKey = publicKeyFromSigningKeyId(payload.signingKey);
  if (!ed25519.utils.isValidPublicKey(publicKey)) {
    throw new ProtocolValidationError('Signing key is not a valid Ed25519 key.');
  }

  const payloadHash = digestSha256Multibase(canonicalizePayload(payload));
  const descriptor = descriptorFor(payload, payloadHash);
  const exactMessage = canonicalizeProofDescriptor(descriptor);
  let returnedSignature: Uint8Array;
  try {
    returnedSignature = await signer(
      Object.freeze({
        algorithm: 'Ed25519',
        keyId: payload.signingKey,
        message: Uint8Array.from(exactMessage),
        purpose: 'wetdrool-portable-object-v1',
      }),
    );
  } catch (error) {
    throw new ProtocolValidationError('The payload signer rejected the signing request.', {
      cause: error,
    });
  }

  if (!(returnedSignature instanceof Uint8Array) || returnedSignature.byteLength !== 64) {
    throw new ProtocolValidationError('The payload signer returned an invalid Ed25519 signature.');
  }
  const signature = Uint8Array.from(returnedSignature);
  if (!ed25519.verify(signature, exactMessage, publicKey)) {
    signature.fill(0);
    throw new ProtocolValidationError(
      'The payload signer returned a signature for different bytes or a different key.',
    );
  }

  try {
    return {
      payload,
      proof: {
        algorithm: 'Ed25519',
        keyId: payload.signingKey,
        payloadHash,
        signature: encodeMultibaseBase64Url(signature),
      },
    };
  } finally {
    signature.fill(0);
  }
}

export async function verifyEnvelope(
  input: SignedEnvelope | Uint8Array,
  authorize?: AuthorizationVerifier,
): Promise<VerifiedEnvelope> {
  const envelope =
    input instanceof Uint8Array
      ? decodeCanonicalEnvelope(input)
      : signedEnvelopeSchema.parse(input);
  assertIntrinsicObjectAuthorization(envelope.payload);

  if (envelope.proof.keyId !== envelope.payload.signingKey) {
    throw new ProtocolValidationError('Proof key ID does not match payload signing key.');
  }

  const payloadHash = digestSha256Multibase(canonicalizePayload(envelope.payload));
  if (payloadHash !== envelope.proof.payloadHash) {
    throw new ProtocolValidationError('Payload hash does not match proof.');
  }

  const publicKey = publicKeyFromSigningKeyId(envelope.proof.keyId);
  const signature = decodeMultibaseBase64Url(envelope.proof.signature, 64);
  const valid = ed25519.verify(
    signature,
    canonicalizeProofDescriptor(descriptorFor(envelope.payload, payloadHash)),
    publicKey,
  );
  if (!valid) {
    throw new ProtocolValidationError('Invalid Ed25519 signature.');
  }

  if (
    authorize !== undefined &&
    !(await authorize({
      author: envelope.payload.author,
      keyId: envelope.proof.keyId,
      objectType: envelope.payload.type,
      createdAt: envelope.payload.createdAt,
      objectId: getObjectId(envelope.payload),
      payload: envelope.payload,
      requirement: authorizationRequirementFor(envelope.payload),
    }))
  ) {
    throw new ProtocolValidationError('Signing key was not authorized for this object.');
  }

  const canonicalBytes = canonicalizeEnvelope(envelope);
  return {
    envelope,
    canonicalBytes,
    objectId: getObjectId(envelope.payload),
    cid: await getContentCid(canonicalBytes),
    publicKey,
  };
}
