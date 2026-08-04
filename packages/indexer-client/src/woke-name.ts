import {
  canonicalizeWokeName,
  digestSha256Multibase,
  digestSchema,
  identityIdSchema,
  networkIdSchema,
  solanaPublicKeySchema,
  timestampSchema,
  unsigned64Schema,
  utf8,
} from '@wetdrool/protocol';

import {
  IndexerPayloadError,
  parseIndexerMeta,
  type DegradedReason,
  type IndexerMeta,
} from './contract.js';
import type { IndexerClientOptions } from './projected-feed.js';
import { endpointFor, readIndexerJson } from './transport.js';

export interface WokeNameResolution {
  canonical: false;
  projection: 'droolnet-open-indexer';
  network: string;
  namespace: 'woke';
  namespaceVersion: 1;
  name: string;
  handle: string;
  destination: {
    chain: 'solana';
    address: string;
    nativeAddress: false;
    semantics: 'current-identity-root-authority';
  };
  identity: {
    identityId: string;
    identityAddress: string;
    rootAuthority: string;
    rootRotationCount: string;
    active: boolean;
    identitySequence: string;
    updatedSlot: string;
  };
  claim: {
    handleClaimAddress: string;
    handleHash: string;
    identitySequence: string;
    claimedSlot: string;
    claimedAt: string;
  };
  meta: IndexerMeta;
}

export type WokeNameResolutionResult =
  | { endpoint: string; kind: 'ready'; value: WokeNameResolution }
  | { kind: 'not-found' }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

type UnknownRecord = Record<string, unknown>;

export function parseWokeNameResolution(
  value: unknown,
  expected?: { name: string; network: string },
): WokeNameResolution {
  const response = record(value, 'woke name resolution');
  exactKeys(response, 'woke name resolution', [
    'canonical',
    'claim',
    'destination',
    'handle',
    'identity',
    'meta',
    'name',
    'namespace',
    'namespaceVersion',
    'network',
    'projection',
  ]);
  const canonical = canonicalizeWokeName(text(response.name, 'woke name resolution.name'));
  const network = parsed(networkIdSchema, response.network, 'woke name resolution.network');
  if (
    response.canonical !== false ||
    response.projection !== 'droolnet-open-indexer' ||
    response.namespace !== 'woke' ||
    response.namespaceVersion !== 1 ||
    response.handle !== canonical.handle ||
    (expected !== undefined &&
      (network !== expected.network || canonical.name !== canonicalizeWokeName(expected.name).name))
  ) {
    throw new IndexerPayloadError('The .drool resolution scope is invalid.');
  }

  const destination = record(response.destination, 'woke name destination');
  exactKeys(destination, 'woke name destination', [
    'address',
    'chain',
    'nativeAddress',
    'semantics',
  ]);
  const destinationAddress = parsed(
    solanaPublicKeySchema,
    destination.address,
    'woke name destination.address',
  );
  if (
    destination.chain !== 'solana' ||
    destination.nativeAddress !== false ||
    destination.semantics !== 'current-identity-root-authority'
  ) {
    throw new IndexerPayloadError('The .drool destination semantics are invalid.');
  }

  const identity = record(response.identity, 'woke name identity');
  exactKeys(identity, 'woke name identity', [
    'active',
    'identityAddress',
    'identityId',
    'identitySequence',
    'rootAuthority',
    'rootRotationCount',
    'updatedSlot',
  ]);
  const identityAddress = parsed(
    solanaPublicKeySchema,
    identity.identityAddress,
    'woke name identity.identityAddress',
  );
  const identityId = parsed(identityIdSchema, identity.identityId, 'woke name identity.identityId');
  const rootAuthority = parsed(
    solanaPublicKeySchema,
    identity.rootAuthority,
    'woke name identity.rootAuthority',
  );
  const rootRotationCount = unsigned(identity.rootRotationCount, 'root rotation count');
  const identitySequence = unsigned(identity.identitySequence, 'identity sequence');
  const updatedSlot = unsigned(identity.updatedSlot, 'identity updated slot');
  if (
    identity.active !== true ||
    rootAuthority !== destinationAddress ||
    identityId !== `wetdroolid:v1:${network}:${identityAddress}`
  ) {
    throw new IndexerPayloadError('The .drool identity binding is invalid.');
  }

  const claim = record(response.claim, 'woke name claim');
  exactKeys(claim, 'woke name claim', [
    'claimedAt',
    'claimedSlot',
    'handleClaimAddress',
    'handleHash',
    'identitySequence',
  ]);
  const handleClaimAddress = parsed(
    solanaPublicKeySchema,
    claim.handleClaimAddress,
    'woke name claim.handleClaimAddress',
  );
  const handleHash = parsed(digestSchema, claim.handleHash, 'woke name claim.handleHash');
  const claimIdentitySequence = unsigned(claim.identitySequence, 'claim identity sequence');
  const claimedSlot = unsigned(claim.claimedSlot, 'claim slot');
  const claimedAt = parsed(timestampSchema, claim.claimedAt, 'woke name claim.claimedAt');
  const meta = parseIndexerMeta(response.meta);
  if (
    handleHash !== digestSha256Multibase(utf8(canonical.handle)) ||
    BigInt(claimIdentitySequence) > BigInt(identitySequence) ||
    meta.checkpointSlot === null ||
    BigInt(meta.checkpointSlot) < BigInt(claimedSlot) ||
    BigInt(meta.checkpointSlot) < BigInt(updatedSlot)
  ) {
    throw new IndexerPayloadError('The indexer checkpoint does not cover the .drool proof.');
  }

  return {
    canonical: false,
    projection: 'droolnet-open-indexer',
    network,
    namespace: 'woke',
    namespaceVersion: 1,
    name: canonical.name,
    handle: canonical.handle,
    destination: {
      chain: 'solana',
      address: destinationAddress,
      nativeAddress: false,
      semantics: 'current-identity-root-authority',
    },
    identity: {
      identityId,
      identityAddress,
      rootAuthority,
      rootRotationCount,
      active: identity.active,
      identitySequence,
      updatedSlot,
    },
    claim: {
      handleClaimAddress,
      handleHash,
      identitySequence: claimIdentitySequence,
      claimedSlot,
      claimedAt,
    },
    meta,
  };
}

export async function resolveWokeName(
  options: IndexerClientOptions,
  request: { name: string; network: string },
): Promise<WokeNameResolutionResult> {
  let canonical;
  let network;
  let base;
  try {
    canonical = canonicalizeWokeName(request.name);
    network = parsed(networkIdSchema, request.network, 'requested DroolNet identifier');
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
    return degraded('invalid-configuration', 'The .drool resolver configuration is invalid.');
  }

  const endpoint = endpointFor(
    base,
    `v1/woke-names/${encodeURIComponent(canonical.name)}?${new URLSearchParams({ network })}`,
  );
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
        `The .drool resolver returned HTTP ${response.status}.`,
      );
    }
    try {
      return {
        endpoint: base.origin,
        kind: 'ready',
        value: parseWokeNameResolution(await readIndexerJson(response), {
          name: canonical.name,
          network,
        }),
      };
    } catch {
      return degraded('invalid-response', 'The .drool resolver returned an invalid proof.');
    }
  } catch {
    return degraded('unavailable', 'The .drool resolver could not be reached before its deadline.');
  } finally {
    clearTimeout(timeout);
  }
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

function text(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new IndexerPayloadError(`${label} must be a string.`);
  return value;
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
): Extract<WokeNameResolutionResult, { kind: 'degraded' }> {
  return { detail, kind: 'degraded', reason };
}
