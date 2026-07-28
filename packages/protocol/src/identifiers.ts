import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 as multiformatsSha256 } from 'multiformats/hashes/sha2';

import type { PortableObjectType } from './constants.js';
import { canonicalizeEnvelope, canonicalizePayload } from './canonical.js';
import { digestSha256Multibase } from './encoding.js';
import type { PortablePayload, SignedEnvelope } from './schemas.js';

export function getObjectId(payload: PortablePayload): string {
  const digest = digestSha256Multibase(canonicalizePayload(payload));
  return `swobj:v1:${payload.type}:${digest}`;
}

export function getTypedObjectId(
  objectType: PortableObjectType,
  canonicalPayloadBytes: Uint8Array,
): string {
  return `swobj:v1:${objectType}:${digestSha256Multibase(canonicalPayloadBytes)}`;
}

export async function getContentCid(bytes: Uint8Array): Promise<string> {
  const digest = await multiformatsSha256.digest(bytes);
  return CID.createV1(raw.code, digest).toString();
}

export async function getEnvelopeCid(envelope: SignedEnvelope): Promise<string> {
  return getContentCid(canonicalizeEnvelope(envelope));
}

export async function verifyContentCid(bytes: Uint8Array, expectedCid: string): Promise<boolean> {
  let parsed: CID;
  try {
    parsed = CID.parse(expectedCid);
  } catch {
    return false;
  }

  if (parsed.version !== 1 || parsed.code !== raw.code) {
    return false;
  }

  return (await getContentCid(bytes)) === parsed.toString();
}
