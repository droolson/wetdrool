import {
  networkIdSchema,
  solanaPublicKeySchema,
  timestampSchema,
  transactionSignatureSchema,
  unsigned64Schema,
} from '@wokesocial/protocol';

import {
  IndexerPayloadError,
  parseIndexerMeta,
  parseVerifiedCommunity,
  type DegradedReason,
  type DirectVerifiedCommunity,
  type IndexerMeta,
  type PublicVerifiedCommunity,
} from './contract.js';
import type { IndexerClientOptions, IndexerFetch } from './projected-feed.js';
import { endpointFor, readIndexerJson } from './transport.js';

export const COMMUNITY_DIRECTORY_RECIPE = 'community-directory-v1';
export const MAX_COMMUNITY_PAGE_ITEMS = 50;

export interface CommunityDirectoryResponse {
  canonical: false;
  communities: PublicVerifiedCommunity[];
  meta: IndexerMeta;
  network: string;
  nextCursor: string | null;
  projection: 'wokenet-open-indexer';
  recipe: typeof COMMUNITY_DIRECTORY_RECIPE;
}

export interface CommunityDetailResponse {
  canonical: false;
  community: DirectVerifiedCommunity;
  meta: IndexerMeta;
  network: string;
  projection: 'wokenet-open-indexer';
}

export type CommunityMembershipAction = 'ban' | 'join' | 'leave' | 'remove';
export type CommunityMembershipState = 'active' | 'banned' | 'left' | 'removed';

export interface CommunityMembershipStatus {
  activeSinceMembershipSequence: string;
  action: CommunityMembershipAction;
  communityAddress: string;
  communityMembershipSequence: string;
  memberActionSequence: string;
  membershipAddress: string;
  membershipPolicySequence: string;
  roles: [] | ['member'];
  state: CommunityMembershipState;
  stateSequence: string;
  updatedAt: string;
  updatedSlot: string;
}

export interface CommunityMembershipProof {
  finality: 'finalized';
  kind: 'wokesocial-program-event';
  logIndex: number;
  slot: string;
  transactionIndex: number | null;
  transactionSignature: string;
}

export interface CommunityMembershipStatusResponse {
  canonical: false;
  membership: CommunityMembershipStatus;
  meta: IndexerMeta;
  network: string;
  projection: 'wokenet-open-indexer';
  proof: CommunityMembershipProof;
}

export type CommunityDirectoryResult =
  | { endpoint: string; kind: 'ready'; value: CommunityDirectoryResponse }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

export type CommunityDetailResult =
  | { endpoint: string; kind: 'ready'; value: CommunityDetailResponse }
  | { kind: 'not-found' }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

export type CommunityMembershipStatusResult =
  | { endpoint: string; kind: 'ready'; value: CommunityMembershipStatusResponse }
  | { kind: 'not-found' }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

export interface CommunityDirectoryRequest {
  cursor?: string;
  limit?: number;
  network: string;
}

export interface CommunityDetailRequest {
  address: string;
  network: string;
}

export interface CommunityMembershipStatusRequest {
  address: string;
  network: string;
}

export interface CommunityClient {
  detail(request: CommunityDetailRequest): Promise<CommunityDetailResult>;
  directory(request: CommunityDirectoryRequest): Promise<CommunityDirectoryResult>;
  membershipStatus(
    request: CommunityMembershipStatusRequest,
  ): Promise<CommunityMembershipStatusResult>;
}

export type CommunityCursorState =
  | { cursor: null; kind: 'empty' }
  | { detail: string; kind: 'invalid' }
  | { cursor: string; kind: 'valid' };

export type CommunityAddressState =
  | { address: ''; kind: 'empty' }
  | { address: string; detail: string; kind: 'invalid' }
  | { address: string; kind: 'valid' };

type UnknownRecord = Record<string, unknown>;

const MAX_COMMUNITY_CURSOR_LENGTH = 512;
const COMMUNITY_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IndexerPayloadError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, label: string, allowedKeys: readonly string[]): void {
  const allowed = new Set(allowedKeys);
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw new IndexerPayloadError(
      `${label} contains unsupported fields: ${unexpected.sort().join(', ')}.`,
    );
  }
}

function canonicalNetwork(value: unknown, label: string): string {
  const parsed = networkIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(
      `${label} must be a canonical WokeNet Solana deployment identifier.`,
    );
  }
  return parsed.data;
}

function canonicalPublicKey(value: unknown, label: string): string {
  const parsed = solanaPublicKeySchema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(`${label} must be a canonical 32-byte Solana public key.`);
  }
  return parsed.data;
}

function canonicalUnsigned64(value: unknown, label: string): string {
  const parsed = unsigned64Schema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(`${label} must be a canonical unsigned 64-bit integer string.`);
  }
  return parsed.data;
}

function canonicalTimestamp(value: unknown, label: string): string {
  const parsed = timestampSchema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(`${label} must be a canonical timestamp.`);
  }
  return parsed.data;
}

function canonicalTransactionSignature(value: unknown, label: string): string {
  const parsed = transactionSignatureSchema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(`${label} must be a canonical Solana transaction signature.`);
  }
  return parsed.data;
}

function nonNegativeSafeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new IndexerPayloadError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function membershipAction(value: unknown): CommunityMembershipAction {
  if (value === 'join' || value === 'leave' || value === 'remove' || value === 'ban') {
    return value;
  }
  throw new IndexerPayloadError('community membership status.action is invalid.');
}

function membershipState(value: unknown): CommunityMembershipState {
  if (value === 'active' || value === 'left' || value === 'removed' || value === 'banned') {
    return value;
  }
  throw new IndexerPayloadError('community membership status.state is invalid.');
}

function parseMembershipRoles(value: unknown): [] | ['member'] {
  if (!Array.isArray(value)) {
    throw new IndexerPayloadError('community membership status.roles must be an array.');
  }
  if (value.length === 0) return [];
  if (value.length === 1 && value[0] === 'member') return ['member'];
  throw new IndexerPayloadError(
    'community membership status.roles must be [] or the exact member role.',
  );
}

function checkpointCoversCommunity(
  meta: IndexerMeta,
  community: DirectVerifiedCommunity | PublicVerifiedCommunity,
): void {
  if (meta.checkpointSlot === null || BigInt(meta.checkpointSlot) < BigInt(community.updatedSlot)) {
    throw new IndexerPayloadError(
      'A verified community requires an indexer checkpoint covering its latest anchor.',
    );
  }
}

export function parseCommunityDirectoryResponse(
  value: unknown,
  expected?: { network: string },
): CommunityDirectoryResponse {
  const response = record(value, 'community directory response');
  exactKeys(response, 'community directory response', [
    'canonical',
    'communities',
    'meta',
    'network',
    'nextCursor',
    'projection',
    'recipe',
  ]);
  const network = canonicalNetwork(response.network, 'community directory response.network');
  if (
    response.canonical !== false ||
    response.projection !== 'wokenet-open-indexer' ||
    response.recipe !== COMMUNITY_DIRECTORY_RECIPE ||
    (expected !== undefined && expected.network !== network) ||
    !Array.isArray(response.communities) ||
    response.communities.length > MAX_COMMUNITY_PAGE_ITEMS
  ) {
    throw new IndexerPayloadError('The verified community directory metadata is invalid.');
  }
  if (response.nextCursor !== null && typeof response.nextCursor !== 'string') {
    throw new IndexerPayloadError(
      'community directory response.nextCursor must be an opaque cursor or null.',
    );
  }
  const cursorState = validateCommunityCursor(response.nextCursor ?? undefined);
  if (response.nextCursor !== null && cursorState.kind !== 'valid') {
    throw new IndexerPayloadError(
      'community directory response.nextCursor must be an opaque cursor or null.',
    );
  }
  const communities = response.communities.map((community) => {
    const parsed = parseVerifiedCommunity(community, 'public') as PublicVerifiedCommunity;
    if (parsed.networkId !== network) {
      throw new IndexerPayloadError(
        'A directory community belongs to a different WokeNet Solana deployment.',
      );
    }
    return parsed;
  });
  if (
    new Set(communities.map(({ communityAddress }) => communityAddress)).size !== communities.length
  ) {
    throw new IndexerPayloadError('A community directory page cannot repeat an address.');
  }
  for (let index = 1; index < communities.length; index += 1) {
    const previous = communities[index - 1];
    const current = communities[index];
    if (
      previous === undefined ||
      current === undefined ||
      BigInt(previous.createdSlot) < BigInt(current.createdSlot) ||
      (previous.createdSlot === current.createdSlot &&
        previous.communityAddress <= current.communityAddress)
    ) {
      throw new IndexerPayloadError(
        'A community directory page must use descending creation-slot and address order.',
      );
    }
  }
  if (communities.length === 0 && cursorState.kind === 'valid') {
    throw new IndexerPayloadError('An empty community directory page cannot advertise a cursor.');
  }
  const meta = parseIndexerMeta(response.meta);
  for (const community of communities) checkpointCoversCommunity(meta, community);
  return {
    canonical: false,
    communities,
    meta,
    network,
    nextCursor: cursorState.kind === 'valid' ? cursorState.cursor : null,
    projection: 'wokenet-open-indexer',
    recipe: COMMUNITY_DIRECTORY_RECIPE,
  };
}

export function parseCommunityDetailResponse(
  value: unknown,
  expected?: { address: string; network: string },
): CommunityDetailResponse {
  const response = record(value, 'community detail response');
  exactKeys(response, 'community detail response', [
    'canonical',
    'community',
    'meta',
    'network',
    'projection',
  ]);
  const network = canonicalNetwork(response.network, 'community detail response.network');
  if (
    response.canonical !== false ||
    response.projection !== 'wokenet-open-indexer' ||
    (expected !== undefined && expected.network !== network)
  ) {
    throw new IndexerPayloadError('The verified community detail metadata is invalid.');
  }
  const community = parseVerifiedCommunity(response.community, 'direct') as DirectVerifiedCommunity;
  if (
    community.networkId !== network ||
    (expected !== undefined && expected.address !== community.communityAddress)
  ) {
    throw new IndexerPayloadError('The community detail response changed its requested scope.');
  }
  const meta = parseIndexerMeta(response.meta);
  checkpointCoversCommunity(meta, community);
  return {
    canonical: false,
    community,
    meta,
    network,
    projection: 'wokenet-open-indexer',
  };
}

export function parseCommunityMembershipStatusResponse(
  value: unknown,
  expected?: { address: string; network: string },
): CommunityMembershipStatusResponse {
  const response = record(value, 'community membership status response');
  exactKeys(response, 'community membership status response', [
    'canonical',
    'membership',
    'meta',
    'network',
    'projection',
    'proof',
  ]);
  const network = canonicalNetwork(
    response.network,
    'community membership status response.network',
  );
  if (
    response.canonical !== false ||
    response.projection !== 'wokenet-open-indexer' ||
    (expected !== undefined && network !== expected.network)
  ) {
    throw new IndexerPayloadError('The community membership status metadata is invalid.');
  }
  const membership = record(response.membership, 'community membership status');
  exactKeys(membership, 'community membership status', [
    'activeSinceMembershipSequence',
    'action',
    'communityAddress',
    'communityMembershipSequence',
    'memberActionSequence',
    'membershipAddress',
    'membershipPolicySequence',
    'roles',
    'state',
    'stateSequence',
    'updatedAt',
    'updatedSlot',
  ]);
  const communityAddress = canonicalPublicKey(
    membership.communityAddress,
    'community membership status.communityAddress',
  );
  const membershipAddress = canonicalPublicKey(
    membership.membershipAddress,
    'community membership status.membershipAddress',
  );
  if (expected !== undefined && membershipAddress !== expected.address) {
    throw new IndexerPayloadError('The membership status response changed its requested address.');
  }
  const action = membershipAction(membership.action);
  const state = membershipState(membership.state);
  const stateSequence = canonicalUnsigned64(
    membership.stateSequence,
    'community membership status.stateSequence',
  );
  const memberActionSequence = canonicalUnsigned64(
    membership.memberActionSequence,
    'community membership status.memberActionSequence',
  );
  const membershipPolicySequence = canonicalUnsigned64(
    membership.membershipPolicySequence,
    'community membership status.membershipPolicySequence',
  );
  const communityMembershipSequence = canonicalUnsigned64(
    membership.communityMembershipSequence,
    'community membership status.communityMembershipSequence',
  );
  const activeSinceMembershipSequence = canonicalUnsigned64(
    membership.activeSinceMembershipSequence,
    'community membership status.activeSinceMembershipSequence',
  );
  const updatedSlot = canonicalUnsigned64(
    membership.updatedSlot,
    'community membership status.updatedSlot',
  );
  if (
    BigInt(stateSequence) === 0n ||
    BigInt(memberActionSequence) === 0n ||
    BigInt(membershipPolicySequence) === 0n ||
    BigInt(communityMembershipSequence) === 0n
  ) {
    throw new IndexerPayloadError('Community membership proof sequences must be positive.');
  }
  const expectedState = {
    ban: 'banned',
    join: 'active',
    leave: 'left',
    remove: 'removed',
  }[action];
  const roles = parseMembershipRoles(membership.roles);
  if (
    state !== expectedState ||
    (state === 'active' &&
      (roles.length !== 1 ||
        BigInt(activeSinceMembershipSequence) !== BigInt(communityMembershipSequence))) ||
    (state !== 'active' && (roles.length !== 0 || BigInt(activeSinceMembershipSequence) !== 0n))
  ) {
    throw new IndexerPayloadError('Community membership action, state, roles, and proof disagree.');
  }
  const proof = record(response.proof, 'community membership proof');
  exactKeys(proof, 'community membership proof', [
    'finality',
    'kind',
    'logIndex',
    'slot',
    'transactionIndex',
    'transactionSignature',
  ]);
  const proofSlot = canonicalUnsigned64(proof.slot, 'community membership proof.slot');
  const transactionSignature = canonicalTransactionSignature(
    proof.transactionSignature,
    'community membership proof.transactionSignature',
  );
  const logIndex = nonNegativeSafeInteger(proof.logIndex, 'community membership proof.logIndex');
  const transactionIndex =
    proof.transactionIndex === null
      ? null
      : nonNegativeSafeInteger(
          proof.transactionIndex,
          'community membership proof.transactionIndex',
        );
  if (
    proof.kind !== 'wokesocial-program-event' ||
    proof.finality !== 'finalized' ||
    proofSlot !== updatedSlot
  ) {
    throw new IndexerPayloadError('The community membership finalized proof is invalid.');
  }
  const meta = parseIndexerMeta(response.meta);
  if (meta.checkpointSlot === null || BigInt(meta.checkpointSlot) < BigInt(updatedSlot)) {
    throw new IndexerPayloadError(
      'The indexer checkpoint does not cover the community membership transition.',
    );
  }
  return {
    canonical: false,
    membership: {
      activeSinceMembershipSequence,
      action,
      communityAddress,
      communityMembershipSequence,
      memberActionSequence,
      membershipAddress,
      membershipPolicySequence,
      roles,
      state,
      stateSequence,
      updatedAt: canonicalTimestamp(membership.updatedAt, 'community membership status.updatedAt'),
      updatedSlot,
    },
    meta,
    network,
    projection: 'wokenet-open-indexer',
    proof: {
      finality: 'finalized',
      kind: 'wokesocial-program-event',
      logIndex,
      slot: proofSlot,
      transactionIndex,
      transactionSignature,
    },
  };
}

export function validateCommunityCursor(
  value: string | readonly string[] | undefined,
): CommunityCursorState {
  if (value === undefined || value === '') return { cursor: null, kind: 'empty' };
  if (
    typeof value !== 'string' ||
    value.length > MAX_COMMUNITY_CURSOR_LENGTH ||
    !COMMUNITY_CURSOR_PATTERN.test(value)
  ) {
    return {
      detail: 'The community page reference is malformed, ambiguous, or exceeds its byte budget.',
      kind: 'invalid',
    };
  }
  return { cursor: value, kind: 'valid' };
}

export function validateCommunityAddress(
  value: string | readonly string[] | undefined,
): CommunityAddressState {
  if (value === undefined || value === '') return { address: '', kind: 'empty' };
  if (typeof value !== 'string') {
    return {
      address: '',
      detail: 'Submit exactly one Solana community address.',
      kind: 'invalid',
    };
  }
  const parsed = solanaPublicKeySchema.safeParse(value);
  if (!parsed.success) {
    return {
      address: value.length <= 96 && !/\p{Cc}/u.test(value) ? value : '',
      detail: 'Use a canonical 32-byte base58 Solana community address.',
      kind: 'invalid',
    };
  }
  return { address: parsed.data, kind: 'valid' };
}

function validateCommunityNetwork(value: string): string | null {
  const parsed = networkIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function validateCommunityLimit(value: number | undefined): number | null {
  const limit = value ?? 20;
  return Number.isSafeInteger(limit) && limit >= 1 && limit <= MAX_COMMUNITY_PAGE_ITEMS
    ? limit
    : null;
}

function degraded(
  reason: DegradedReason,
  detail: string,
): Extract<CommunityDirectoryResult, { kind: 'degraded' }> {
  return { detail, kind: 'degraded', reason };
}

function parseClientOptions(
  options: IndexerClientOptions,
):
  | { base: URL; deadlineMs: number; fetch: IndexerFetch; kind: 'valid' }
  | { detail: string; kind: 'invalid' } {
  if (typeof options.fetch !== 'function') {
    return { detail: 'The indexer fetch implementation is not callable.', kind: 'invalid' };
  }
  if (
    !Number.isSafeInteger(options.deadlineMs) ||
    options.deadlineMs <= 0 ||
    options.deadlineMs > 120_000
  ) {
    return {
      detail: 'The indexer deadline must be a positive integer no greater than 120000 ms.',
      kind: 'invalid',
    };
  }
  let base: URL;
  try {
    base = new URL(options.baseUrl);
  } catch {
    return { detail: 'The indexer base URL is not an absolute URL.', kind: 'invalid' };
  }
  if (
    (base.protocol !== 'http:' && base.protocol !== 'https:') ||
    base.username !== '' ||
    base.password !== ''
  ) {
    return {
      detail: 'The indexer base URL must use HTTP(S) and cannot embed credentials.',
      kind: 'invalid',
    };
  }
  base.hash = '';
  return { base, deadlineMs: options.deadlineMs, fetch: options.fetch, kind: 'valid' };
}

async function beforeDeadline<T>(
  deadlineMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error('The indexer request deadline elapsed.'));
    }, deadlineMs);
  });
  try {
    return await Promise.race([operation(controller.signal), timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

export async function fetchCommunityDirectory(
  options: IndexerClientOptions,
  request: CommunityDirectoryRequest,
): Promise<CommunityDirectoryResult> {
  const network = validateCommunityNetwork(request.network);
  const cursorState = validateCommunityCursor(request.cursor);
  const limit = validateCommunityLimit(request.limit);
  if (network === null) {
    return degraded(
      'invalid-response',
      'A canonical WokeNet Solana deployment identifier is required for community discovery.',
    );
  }
  if (cursorState.kind === 'invalid') return degraded('invalid-response', cursorState.detail);
  if (limit === null) {
    return degraded('invalid-response', 'The community page size must be an integer from 1 to 50.');
  }
  const client = parseClientOptions(options);
  if (client.kind === 'invalid') {
    return degraded('invalid-configuration', client.detail);
  }
  const query = new URLSearchParams({ network, limit: String(limit) });
  if (cursorState.kind === 'valid') query.set('before', cursorState.cursor);
  const endpoint = endpointFor(client.base, `v1/communities?${query.toString()}`);
  try {
    const outcome = await beforeDeadline(client.deadlineMs, async (signal) => {
      const response = await client.fetch(endpoint.toString(), {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) return { kind: 'http-error' as const, status: response.status };
      try {
        const value = parseCommunityDirectoryResponse(await readIndexerJson(response), { network });
        if (
          cursorState.kind === 'valid' &&
          value.nextCursor !== null &&
          value.nextCursor === cursorState.cursor
        ) {
          throw new IndexerPayloadError('The indexer repeated the requested community cursor.');
        }
        return { kind: 'ready' as const, value };
      } catch {
        return { kind: 'invalid-response' as const };
      }
    });
    if (outcome.kind === 'http-error') {
      return degraded(
        outcome.status === 400 ? 'invalid-response' : 'unavailable',
        `The configured indexer returned HTTP ${outcome.status}. No community directory data was accepted.`,
      );
    }
    if (outcome.kind === 'invalid-response') {
      return degraded(
        'invalid-response',
        'The configured indexer returned data that did not match the verified community-directory contract.',
      );
    }
    return { endpoint: client.base.origin, kind: 'ready', value: outcome.value };
  } catch {
    return degraded(
      'unavailable',
      'The configured indexer could not be reached before the community-directory deadline.',
    );
  }
}

export async function fetchCommunityDetail(
  options: IndexerClientOptions,
  request: CommunityDetailRequest,
): Promise<CommunityDetailResult> {
  const network = validateCommunityNetwork(request.network);
  const addressState = validateCommunityAddress(request.address);
  if (network === null) {
    return degraded(
      'invalid-response',
      'A canonical WokeNet Solana deployment identifier is required to read a community.',
    );
  }
  if (addressState.kind !== 'valid') {
    return degraded(
      'invalid-response',
      addressState.kind === 'invalid'
        ? addressState.detail
        : 'A canonical Solana community address is required.',
    );
  }
  const client = parseClientOptions(options);
  if (client.kind === 'invalid') {
    return degraded('invalid-configuration', client.detail);
  }
  const query = new URLSearchParams({ network });
  const endpoint = endpointFor(
    client.base,
    `v1/communities/${encodeURIComponent(addressState.address)}?${query.toString()}`,
  );
  try {
    const outcome = await beforeDeadline(client.deadlineMs, async (signal) => {
      const response = await client.fetch(endpoint.toString(), {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (response.status === 404) return { kind: 'not-found' as const };
      if (!response.ok) return { kind: 'http-error' as const, status: response.status };
      try {
        return {
          kind: 'ready' as const,
          value: parseCommunityDetailResponse(await readIndexerJson(response), {
            address: addressState.address,
            network,
          }),
        };
      } catch {
        return { kind: 'invalid-response' as const };
      }
    });
    if (outcome.kind === 'not-found') return { kind: 'not-found' };
    if (outcome.kind === 'http-error') {
      return degraded(
        outcome.status === 400 ? 'invalid-response' : 'unavailable',
        `The configured indexer returned HTTP ${outcome.status}. No community detail was accepted.`,
      );
    }
    if (outcome.kind === 'invalid-response') {
      return degraded(
        'invalid-response',
        'The configured indexer returned data that did not match the verified community-detail contract.',
      );
    }
    return { endpoint: client.base.origin, kind: 'ready', value: outcome.value };
  } catch {
    return degraded(
      'unavailable',
      'The configured indexer could not be reached before the community-detail deadline.',
    );
  }
}

export async function fetchCommunityMembershipStatus(
  options: IndexerClientOptions,
  request: CommunityMembershipStatusRequest,
): Promise<CommunityMembershipStatusResult> {
  const network = validateCommunityNetwork(request.network);
  const addressState = validateCommunityAddress(request.address);
  if (network === null) {
    return degraded(
      'invalid-response',
      'A canonical WokeNet Solana deployment identifier is required to read membership status.',
    );
  }
  if (addressState.kind !== 'valid') {
    return degraded(
      'invalid-response',
      addressState.kind === 'invalid'
        ? addressState.detail
        : 'A canonical Solana membership address is required.',
    );
  }
  const client = parseClientOptions(options);
  if (client.kind === 'invalid') {
    return degraded('invalid-configuration', client.detail);
  }
  const query = new URLSearchParams({ network });
  const endpoint = endpointFor(
    client.base,
    `v1/community-memberships/${encodeURIComponent(addressState.address)}?${query.toString()}`,
  );
  try {
    const outcome = await beforeDeadline(client.deadlineMs, async (signal) => {
      const response = await client.fetch(endpoint.toString(), {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (response.status === 404) return { kind: 'not-found' as const };
      if (!response.ok) return { kind: 'http-error' as const, status: response.status };
      try {
        return {
          kind: 'ready' as const,
          value: parseCommunityMembershipStatusResponse(await readIndexerJson(response), {
            address: addressState.address,
            network,
          }),
        };
      } catch {
        return { kind: 'invalid-response' as const };
      }
    });
    if (outcome.kind === 'not-found') return { kind: 'not-found' };
    if (outcome.kind === 'http-error') {
      return degraded(
        outcome.status === 400 ? 'invalid-response' : 'unavailable',
        `The configured indexer returned HTTP ${outcome.status}. No membership status was accepted.`,
      );
    }
    if (outcome.kind === 'invalid-response') {
      return degraded(
        'invalid-response',
        'The configured indexer returned data that did not match the privacy-safe membership-status contract.',
      );
    }
    return { endpoint: client.base.origin, kind: 'ready', value: outcome.value };
  } catch {
    return degraded(
      'unavailable',
      'The configured indexer could not be reached before the membership-status deadline.',
    );
  }
}

export function createCommunityClient(options: IndexerClientOptions): CommunityClient {
  return {
    detail: (request) => fetchCommunityDetail(options, request),
    directory: (request) => fetchCommunityDirectory(options, request),
    membershipStatus: (request) => fetchCommunityMembershipStatus(options, request),
  };
}
