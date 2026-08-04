import {
  canonicalizeWokeName,
  cidSchema,
  digestSchema,
  identityIdSchema,
  networkIdSchema,
  objectIdSchema,
  profileContentSchema,
  solanaPublicKeySchema,
  timestampSchema,
  unsigned64Schema,
  type ProfileContent,
} from '@wetdrool/protocol';

import {
  IndexerPayloadError,
  parseIndexerMeta,
  type DegradedReason,
  type IndexerMeta,
} from './contract.js';
import type { IndexerClientOptions } from './projected-feed.js';
import { endpointFor, readIndexerJson } from './transport.js';

/**
 * One identity's noncanonical public projection: current identity state, its
 * verified public profile manifest when one exists, and its canonical active
 * handle. Protected profile fields are filtered at indexer ingestion and are
 * never present here. This is an exact-identifier read, not a proof surface —
 * `.drool` proofs come from the strict resolver.
 */
export interface IdentityProfileView {
  canonical: false;
  network: string;
  identity: {
    identityId: string;
    identityAddress: string;
    rootAuthority: string;
    active: boolean;
    identitySequence: string;
    updatedSlot: string;
    deactivatedAt?: string;
  };
  handle: string | null;
  profile: {
    objectId: string;
    cid: string;
    payloadHash: string;
    content: ProfileContent;
    updatedSlot: string;
    updatedAt: string;
  } | null;
  meta: IndexerMeta;
}

export type IdentityProfileResult =
  | { endpoint: string; kind: 'ready'; value: IdentityProfileView }
  | { kind: 'not-found' }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

type UnknownRecord = Record<string, unknown>;

export function parseIdentityProfileResponse(
  value: unknown,
  expected?: { identityId: string },
): IdentityProfileView {
  const response = record(value, 'identity profile');
  exactKeys(response, 'identity profile', [
    'canonical',
    'handle',
    'identity',
    'meta',
    'network',
    'profile',
  ]);
  const network = parsed(networkIdSchema, response.network, 'identity profile.network');
  if (response.canonical !== false) {
    throw new IndexerPayloadError('The identity profile scope is invalid.');
  }

  const identity = record(response.identity, 'identity profile.identity');
  exactKeys(identity, 'identity profile.identity', [
    'active',
    'deactivatedAt',
    'identityAddress',
    'identityId',
    'identitySequence',
    'rootAuthority',
    'updatedSlot',
  ]);
  const identityId = parsed(
    identityIdSchema,
    identity.identityId,
    'identity profile.identity.identityId',
  );
  const identityAddress = parsed(
    solanaPublicKeySchema,
    identity.identityAddress,
    'identity profile.identity.identityAddress',
  );
  const rootAuthority = parsed(
    solanaPublicKeySchema,
    identity.rootAuthority,
    'identity profile.identity.rootAuthority',
  );
  const identitySequence = unsigned(identity.identitySequence, 'identity sequence');
  const updatedSlot = unsigned(identity.updatedSlot, 'identity updated slot');
  if (typeof identity.active !== 'boolean') {
    throw new IndexerPayloadError('identity profile.identity.active must be a boolean.');
  }
  const deactivatedAt =
    identity.deactivatedAt === undefined
      ? undefined
      : parsed(timestampSchema, identity.deactivatedAt, 'identity profile deactivation time');
  if (
    identityId !== `wetdroolid:v1:${network}:${identityAddress}` ||
    (expected !== undefined && identityId !== expected.identityId) ||
    (deactivatedAt !== undefined) === identity.active
  ) {
    throw new IndexerPayloadError('The identity profile binding is invalid.');
  }

  const handle = parseHandle(response.handle);
  if (handle !== null && !identity.active) {
    throw new IndexerPayloadError('A deactivated identity cannot carry an active handle.');
  }

  let profile: IdentityProfileView['profile'] = null;
  if (response.profile !== null) {
    const projected = record(response.profile, 'identity profile.profile');
    exactKeys(projected, 'identity profile.profile', [
      'cid',
      'content',
      'objectId',
      'payloadHash',
      'updatedAt',
      'updatedSlot',
    ]);
    const objectId = parsed(objectIdSchema, projected.objectId, 'identity profile object ID');
    if (!objectId.startsWith('wetdroolobj:v1:profile:')) {
      throw new IndexerPayloadError('The identity profile must reference a profile object.');
    }
    profile = {
      objectId,
      cid: parsed(cidSchema, projected.cid, 'identity profile CID'),
      payloadHash: parsed(digestSchema, projected.payloadHash, 'identity profile payload hash'),
      content: parsed(profileContentSchema, projected.content, 'identity profile content'),
      updatedSlot: unsigned(projected.updatedSlot, 'profile updated slot'),
      updatedAt: parsed(timestampSchema, projected.updatedAt, 'identity profile updated time'),
    };
  }

  const meta = parseIndexerMeta(response.meta);
  if (
    meta.checkpointSlot === null ||
    BigInt(meta.checkpointSlot) < BigInt(updatedSlot) ||
    (profile !== null && BigInt(meta.checkpointSlot) < BigInt(profile.updatedSlot))
  ) {
    throw new IndexerPayloadError('The indexer checkpoint does not cover this identity profile.');
  }

  return {
    canonical: false,
    network,
    identity: {
      identityId,
      identityAddress,
      rootAuthority,
      active: identity.active,
      identitySequence,
      updatedSlot,
      ...(deactivatedAt === undefined ? {} : { deactivatedAt }),
    },
    handle,
    profile,
    meta,
  };
}

export async function fetchIdentityProfile(
  options: IndexerClientOptions,
  request: { identityId: string },
): Promise<IdentityProfileResult> {
  let identityId;
  let base;
  try {
    identityId = parsed(identityIdSchema, request.identityId, 'requested identity');
    base = new URL(options.baseUrl);
    if (
      (base.protocol !== 'http:' && base.protocol !== 'https:') ||
      base.username ||
      base.password ||
      typeof options.fetch !== 'function' ||
      !Number.isSafeInteger(options.deadlineMs) ||
      options.deadlineMs < 1 ||
      options.deadlineMs > 120_000
    ) {
      throw new TypeError('invalid client configuration');
    }
  } catch {
    return degraded('invalid-configuration', 'The identity profile client is misconfigured.');
  }

  const endpoint = endpointFor(base, `v1/identities/${encodeURIComponent(identityId)}/profile`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.deadlineMs);
  try {
    const response = await options.fetch(endpoint.toString(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (response.status === 404) return { kind: 'not-found' };
    if (!response.ok) {
      return degraded(
        response.status === 400 ? 'invalid-response' : 'unavailable',
        `The identity profile provider returned HTTP ${response.status}.`,
      );
    }
    try {
      return {
        endpoint: base.origin,
        kind: 'ready',
        value: parseIdentityProfileResponse(await readIndexerJson(response), { identityId }),
      };
    } catch {
      return degraded('invalid-response', 'The identity profile response was invalid.');
    }
  } catch {
    return degraded(
      'unavailable',
      'The identity profile provider could not be reached before its deadline.',
    );
  } finally {
    clearTimeout(timeout);
  }
}

function parseHandle(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') {
    throw new IndexerPayloadError('identity profile.handle is not a string.');
  }
  try {
    if (canonicalizeWokeName(value).handle !== value) {
      throw new IndexerPayloadError('identity profile.handle is not a canonical handle.');
    }
  } catch (error) {
    if (error instanceof IndexerPayloadError) throw error;
    throw new IndexerPayloadError('identity profile.handle is not a canonical handle.');
  }
  return value;
}

function record(value: unknown, label: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new IndexerPayloadError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, label: string, allowed: readonly string[]): void {
  const supported = new Set(allowed);
  const extra = Object.keys(value).filter((key) => !supported.has(key));
  if (extra.length > 0) {
    throw new IndexerPayloadError(`${label} contains unsupported fields.`);
  }
}

function parsed<T>(
  schema: { safeParse(value: unknown): { data: T; success: true } | { success: false } },
  value: unknown,
  label: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new IndexerPayloadError(`${label} is invalid.`);
  return result.data;
}

function unsigned(value: unknown, label: string): string {
  return parsed(unsigned64Schema, value, label);
}

function degraded(
  reason: DegradedReason,
  detail: string,
): Extract<IdentityProfileResult, { kind: 'degraded' }> {
  return { detail, kind: 'degraded', reason };
}
