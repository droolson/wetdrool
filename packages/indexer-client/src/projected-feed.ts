import {
  canonicalizeWokeName,
  cidSchema,
  digestSchema,
  identityIdSchema,
  networkIdSchema,
  objectIdSchema,
  postContentSchema,
  signingKeyIdSchema,
  timestampSchema,
  transactionSignatureSchema,
} from '@wokesocial/protocol';

import {
  hasControlCharacters,
  IndexerPayloadError,
  MAX_INDEXER_PAGE_ITEMS,
  parseIndexedPost,
  parseIndexerMeta,
  type DegradedReason,
  type IndexedPost,
  type IndexerMeta,
} from './contract.js';
import { endpointFor, readIndexerJson } from './transport.js';

export type ProjectedFeedMode = 'chronological' | 'following';
export const OPEN_INDEXER_FEED_RECIPE = 'wokenet-open-indexer-feed-v1';

export type ProjectedFeedReason =
  { kind: 'chronological' } | { followedIdentityId: string; kind: 'following' };

export interface ProjectedFeedEntry {
  post: IndexedPost;
  reason: ProjectedFeedReason;
}

export interface ProjectedFeedResponse {
  canonical: false;
  entries: ProjectedFeedEntry[];
  meta: IndexerMeta;
  mode: ProjectedFeedMode;
  network: string;
  nextCursor: string | null;
  projection: 'wokenet-open-indexer';
  recipe: typeof OPEN_INDEXER_FEED_RECIPE;
  viewer: string | null;
}

export type ProjectedFeedResult =
  | { endpoint: string; kind: 'ready'; value: ProjectedFeedResponse }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

export type ProjectedFeedRequest =
  | { cursor?: string; mode: 'chronological' }
  | { cursor?: string; mode: 'following'; viewer: string };

export interface ChronologicalFeedRequest {
  cursor?: string;
}

export interface FollowingFeedRequest {
  cursor?: string;
  viewer: string;
}

export type IndexerFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface IndexerClientOptions {
  /**
   * Absolute HTTP(S) base URL for a compatible WokeSocial indexer.
   *
   * A pathname is preserved, so `https://indexer.example/operator/` resolves
   * the feed endpoint below `/operator/`.
   */
  baseUrl: string | URL;
  /** Maximum wall-clock time for the complete fetch call. */
  deadlineMs: number;
  /** Runtime-provided fetch implementation (browser, SSR, or React Native). */
  fetch: IndexerFetch;
}

export interface ProjectedFeedClient {
  chronological(request?: ChronologicalFeedRequest): Promise<ProjectedFeedResult>;
  following(request: FollowingFeedRequest): Promise<ProjectedFeedResult>;
}

export type FollowingViewerState =
  | { kind: 'empty'; viewer: '' }
  | { detail: string; kind: 'invalid'; viewer: string }
  | { kind: 'valid'; viewer: string };

export type FeedCursorState =
  | { cursor: null; kind: 'empty' }
  | { detail: string; kind: 'invalid' }
  | { cursor: string; kind: 'valid' };

type UnknownRecord = Record<string, unknown>;
interface ProtocolSchema<T> {
  safeParse(value: unknown): { data: T; success: true } | { success: false };
}

const MAX_FEED_CURSOR_LENGTH = 512;
const FEED_CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/u;

function record(value: unknown, label: string): UnknownRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IndexerPayloadError(`${label} must be an object.`);
  }
  return value as UnknownRecord;
}

function string(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
    throw new IndexerPayloadError(
      `${label} must be a non-empty string no longer than ${maximumLength} characters.`,
    );
  }
  return value;
}

function boundedString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new IndexerPayloadError(
      `${label} must be a string no longer than ${maximumLength} characters.`,
    );
  }
  return value;
}

function utf8String(value: unknown, label: string, maximumBytes: number): string {
  const candidate = string(value, label, maximumBytes);
  if (new TextEncoder().encode(candidate).byteLength > maximumBytes) {
    throw new IndexerPayloadError(`${label} must be no longer than ${maximumBytes} UTF-8 bytes.`);
  }
  return candidate;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw new IndexerPayloadError(`${label} must be a boolean.`);
  return value;
}

function oneOf<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new IndexerPayloadError(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function decimalSafeInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 20 ||
    !/^(0|[1-9]\d*)$/u.test(value)
  ) {
    throw new IndexerPayloadError(`${label} must be a canonical unsigned decimal string.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new IndexerPayloadError(`${label} exceeds the browser-safe integer range.`);
  }
  return parsed;
}

function canonicalNetworkId(value: unknown, label: string): string {
  const parsed = networkIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(
      `${label} must be a canonical WokeNet Solana deployment identifier.`,
    );
  }
  return parsed.data;
}

function canonicalIdentityId(value: unknown, label: string): string {
  const parsed = identityIdSchema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(`${label} must be a canonical WokeSocial identity identifier.`);
  }
  return parsed.data;
}

function canonicalProtocolValue<T>(schema: ProtocolSchema<T>, value: unknown, label: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new IndexerPayloadError(`${label} is not canonical protocol data.`);
  }
  return parsed.data;
}

function identityBelongsToNetwork(identityId: string, network: string): boolean {
  return identityId.startsWith(`wokesocialid:v1:${network}:`);
}

/**
 * A projected author handle is a convenience field, not a `.woke` proof. It is
 * accepted only as an absent field, an explicit null, or one exactly canonical
 * handle serialization; anything else is a payload error rather than a
 * silently repaired value.
 */
function parseAuthorHandle(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new IndexerPayloadError('feed entry.authorHandle is not a string.');
  }
  try {
    if (canonicalizeWokeName(value).handle !== value) {
      throw new IndexerPayloadError('feed entry.authorHandle is not a canonical handle.');
    }
  } catch (error) {
    if (error instanceof IndexerPayloadError) throw error;
    throw new IndexerPayloadError('feed entry.authorHandle is not a canonical handle.');
  }
  return value;
}

function parseProjectedFeedEntry(
  value: unknown,
  mode: ProjectedFeedMode,
  network: string,
): ProjectedFeedEntry {
  const entry = record(value, 'feed entry');
  const projectedPost = record(entry.post, 'feed entry.post');
  const author = record(entry.author, 'feed entry.author');
  const content = canonicalProtocolValue(
    postContentSchema,
    projectedPost.content,
    'feed entry.post.content',
  );
  const visibility = record(content.visibility, 'feed entry.post.content.visibility');
  const authorIdentityId = canonicalIdentityId(author.identityId, 'feed entry.author.identityId');
  const projectedAuthorIdentityId = canonicalIdentityId(
    projectedPost.authorIdentityId,
    'feed entry.post.authorIdentityId',
  );
  if (authorIdentityId !== projectedAuthorIdentityId) {
    throw new IndexerPayloadError('A feed entry post must match its projected author.');
  }
  if (!identityBelongsToNetwork(authorIdentityId, network)) {
    throw new IndexerPayloadError(
      'A feed entry author belongs to a different WokeNet Solana deployment.',
    );
  }
  if (canonicalNetworkId(projectedPost.networkId, 'feed entry.post.networkId') !== network) {
    throw new IndexerPayloadError(
      'A feed entry post belongs to a different WokeNet Solana deployment.',
    );
  }
  if (
    projectedPost.verified !== true ||
    visibility.kind !== 'public' ||
    Object.prototype.hasOwnProperty.call(projectedPost, 'tombstonedAt')
  ) {
    throw new IndexerPayloadError('Projected feeds accept only verified public posts.');
  }
  boolean(author.active, 'feed entry.author.active');
  const objectId = canonicalProtocolValue(
    objectIdSchema,
    projectedPost.objectId,
    'feed entry.post.objectId',
  );
  if (!objectId.startsWith('wokesocialobj:v1:post:')) {
    throw new IndexerPayloadError('A projected feed entry must identify a post object.');
  }
  const signingKeyId = canonicalProtocolValue(
    signingKeyIdSchema,
    projectedPost.signingKeyId,
    'feed entry.post.signingKeyId',
  );
  if (!signingKeyId.startsWith(`${authorIdentityId}#`)) {
    throw new IndexerPayloadError('A projected feed signing key must belong to the post author.');
  }
  const cid = canonicalProtocolValue(cidSchema, projectedPost.cid, 'feed entry.post.cid');
  const payloadHash = canonicalProtocolValue(
    digestSchema,
    projectedPost.payloadHash,
    'feed entry.post.payloadHash',
  );
  const createdAt = canonicalProtocolValue(
    timestampSchema,
    projectedPost.createdAt,
    'feed entry.post.createdAt',
  );
  const transactionSignature = canonicalProtocolValue(
    transactionSignatureSchema,
    projectedPost.transactionSignature,
    'feed entry.post.transactionSignature',
  );

  let displayName = 'Unnamed member';
  if (entry.profile !== undefined) {
    const profile = record(entry.profile, 'feed entry.profile');
    if (
      canonicalIdentityId(profile.identityId, 'feed entry.profile.identityId') !== authorIdentityId
    ) {
      throw new IndexerPayloadError('A feed entry profile must match its projected author.');
    }
    const projectedDisplayName = boundedString(
      record(profile.content, 'feed entry.profile.content').displayName,
      'feed entry.profile.content.displayName',
      160,
    );
    if (projectedDisplayName.length > 0) {
      displayName = utf8String(projectedDisplayName, 'feed entry.profile.content.displayName', 160);
    }
  }

  const body =
    content.body === undefined || content.body === ''
      ? null
      : boundedString(content.body, 'feed entry.post.content.body', 100_000);
  const post = parseIndexedPost({
    author: {
      displayName,
      handle: parseAuthorHandle(entry.authorHandle),
      identityId: authorIdentityId,
    },
    body,
    bodyReference: content.bodyReference ?? null,
    createdAt,
    id: objectId,
    language: content.language ?? null,
    media: content.media,
    verification: {
      anchor: {
        finality: 'finalized',
        slot: decimalSafeInteger(projectedPost.anchoredSlot, 'feed entry.post.anchoredSlot'),
        transaction: transactionSignature,
      },
      contentHash: payloadHash,
      contentHashValid: true,
      manifestUri: `ipfs://${cid}`,
      signatureValid: true,
      state: 'verified',
    },
  });

  const reason = record(entry.reason, 'feed entry.reason');
  const kind = oneOf(reason.kind, 'feed entry.reason.kind', [
    'chronological',
    'following',
  ] as const);
  if (kind !== mode)
    throw new IndexerPayloadError('A feed entry reason must match the declared feed mode.');
  if (kind === 'following') {
    const followedIdentityId = canonicalIdentityId(
      reason.followedIdentityId,
      'feed entry.reason.followedIdentityId',
    );
    if (followedIdentityId !== authorIdentityId) {
      throw new IndexerPayloadError('A following reason must identify the projected author.');
    }
    return { post, reason: { followedIdentityId, kind } };
  }
  return { post, reason: { kind } };
}

export function parseProjectedFeedResponse(
  value: unknown,
  expected?: { mode: ProjectedFeedMode; viewer?: string },
): ProjectedFeedResponse {
  const response = record(value, 'response');
  const mode = oneOf(response.mode, 'response.mode', ['chronological', 'following'] as const);
  const network = canonicalNetworkId(response.network, 'response.network');
  if (
    response.canonical !== false ||
    response.projection !== 'wokenet-open-indexer' ||
    response.recipe !== OPEN_INDEXER_FEED_RECIPE ||
    !Array.isArray(response.entries) ||
    response.entries.length > MAX_INDEXER_PAGE_ITEMS
  ) {
    throw new IndexerPayloadError('The projected feed response metadata is invalid.');
  }
  if (expected !== undefined && mode !== expected.mode) {
    throw new IndexerPayloadError('The projected feed response changed the requested feed mode.');
  }
  const viewer =
    response.viewer === null ? null : canonicalIdentityId(response.viewer, 'response.viewer');
  if (
    (mode === 'chronological' && viewer !== null) ||
    (mode === 'following' && viewer === null) ||
    (viewer !== null && !identityBelongsToNetwork(viewer, network)) ||
    (expected?.viewer !== undefined && viewer !== expected.viewer)
  ) {
    throw new IndexerPayloadError('The projected feed response viewer scope is invalid.');
  }
  if (response.nextCursor !== null && typeof response.nextCursor !== 'string') {
    throw new IndexerPayloadError('response.nextCursor must be an opaque cursor or null.');
  }
  const nextCursorState = validateFeedCursor(response.nextCursor ?? undefined);
  if (nextCursorState.kind === 'invalid') {
    throw new IndexerPayloadError('response.nextCursor is not a valid opaque feed cursor.');
  }
  const entries = response.entries.map((entry) => parseProjectedFeedEntry(entry, mode, network));
  if (new Set(entries.map(({ post }) => post.id)).size !== entries.length) {
    throw new IndexerPayloadError('A projected feed page cannot repeat a post identifier.');
  }
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1]?.post;
    const current = entries[index]?.post;
    if (
      previous === undefined ||
      current === undefined ||
      previous.createdAt < current.createdAt ||
      (previous.createdAt === current.createdAt && previous.id <= current.id)
    ) {
      throw new IndexerPayloadError(
        'A projected feed page must use descending finalized time and object-ID order.',
      );
    }
  }
  if (entries.length === 0 && nextCursorState.kind === 'valid') {
    throw new IndexerPayloadError('An empty projected feed page cannot advertise another cursor.');
  }
  const meta = parseIndexerMeta(response.meta);
  if (entries.length > 0 && meta.checkpointSlot === null) {
    throw new IndexerPayloadError('A nonempty projected feed page requires a checkpoint.');
  }
  return {
    canonical: false,
    entries,
    meta,
    mode,
    network,
    nextCursor: nextCursorState.kind === 'valid' ? nextCursorState.cursor : null,
    projection: 'wokenet-open-indexer',
    recipe: OPEN_INDEXER_FEED_RECIPE,
    viewer,
  };
}

export function validateFeedCursor(value: string | readonly string[] | undefined): FeedCursorState {
  if (value === undefined || value === '') return { cursor: null, kind: 'empty' };
  if (
    typeof value !== 'string' ||
    value.length > MAX_FEED_CURSOR_LENGTH ||
    !FEED_CURSOR_PATTERN.test(value)
  ) {
    return {
      detail: 'The feed cursor is malformed, ambiguous, or exceeds its byte budget.',
      kind: 'invalid',
    };
  }
  return { cursor: value, kind: 'valid' };
}

export function validateFollowingViewer(
  value: string | readonly string[] | undefined,
): FollowingViewerState {
  if (value === undefined) return { kind: 'empty', viewer: '' };
  if (typeof value !== 'string') {
    return {
      detail: 'Submit exactly one public WokeSocial identity identifier.',
      kind: 'invalid',
      viewer: '',
    };
  }
  const viewer = value.trim();
  if (viewer.length === 0) return { kind: 'empty', viewer: '' };
  const parsed = identityIdSchema.safeParse(viewer);
  if (!parsed.success) {
    return {
      detail:
        'Use a canonical WokeSocial identity ID. Handles and passkey account IDs are not interchangeable with protocol identities.',
      kind: 'invalid',
      viewer: viewer.length <= 300 && !hasControlCharacters(viewer) ? viewer : '',
    };
  }
  return { kind: 'valid', viewer: parsed.data };
}

function degraded(
  reason: DegradedReason,
  detail: string,
): Extract<ProjectedFeedResult, { kind: 'degraded' }> {
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

export async function fetchProjectedFeed(
  options: IndexerClientOptions,
  request: ProjectedFeedRequest,
): Promise<ProjectedFeedResult> {
  const cursorState = validateFeedCursor(request.cursor);
  if (cursorState.kind === 'invalid') return degraded('invalid-response', cursorState.detail);
  let viewer: string | undefined;
  if (request.mode === 'following') {
    const viewerState = validateFollowingViewer(request.viewer);
    if (viewerState.kind !== 'valid') {
      return degraded(
        'invalid-response',
        viewerState.kind === 'invalid'
          ? viewerState.detail
          : 'A canonical public WokeSocial identity ID is required for this graph preview.',
      );
    }
    viewer = viewerState.viewer;
  }
  const client = parseClientOptions(options);
  if (client.kind === 'invalid') {
    return degraded('invalid-configuration', client.detail);
  }
  const query = new URLSearchParams({ limit: '20', mode: request.mode });
  if (viewer !== undefined) query.set('viewer', viewer);
  if (cursorState.kind === 'valid') query.set('before', cursorState.cursor);
  const endpoint = endpointFor(client.base, `v1/feed?${query.toString()}`);
  try {
    const outcome = await beforeDeadline(client.deadlineMs, async (signal) => {
      const response = await client.fetch(endpoint.toString(), {
        headers: { Accept: 'application/json' },
        signal,
      });
      if (!response.ok) {
        return { kind: 'http-error' as const, status: response.status };
      }
      try {
        const value = parseProjectedFeedResponse(await readIndexerJson(response), {
          mode: request.mode,
          ...(viewer === undefined ? {} : { viewer }),
        });
        if (
          cursorState.kind === 'valid' &&
          value.nextCursor !== null &&
          value.nextCursor === cursorState.cursor
        ) {
          throw new IndexerPayloadError('The indexer repeated the requested cursor.');
        }
        return { kind: 'ready' as const, value };
      } catch {
        return { kind: 'invalid-response' as const };
      }
    });
    if (outcome.kind === 'http-error') {
      return degraded(
        outcome.status === 400 ? 'invalid-response' : 'unavailable',
        `The configured indexer returned HTTP ${outcome.status}. No projected feed data was accepted.`,
      );
    }
    if (outcome.kind === 'invalid-response') {
      return degraded(
        'invalid-response',
        'The configured indexer returned data that did not match the typed projected-feed contract.',
      );
    }
    return { endpoint: client.base.origin, kind: 'ready', value: outcome.value };
  } catch {
    return degraded(
      'unavailable',
      'The configured indexer could not be reached before the projected-feed deadline.',
    );
  }
}

export function fetchChronologicalFeed(
  options: IndexerClientOptions,
  request: ChronologicalFeedRequest = {},
): Promise<ProjectedFeedResult> {
  return fetchProjectedFeed(options, { ...request, mode: 'chronological' });
}

export function fetchFollowingFeed(
  options: IndexerClientOptions,
  request: FollowingFeedRequest,
): Promise<ProjectedFeedResult> {
  return fetchProjectedFeed(options, { ...request, mode: 'following' });
}

export function createIndexerClient(options: IndexerClientOptions): ProjectedFeedClient {
  return {
    chronological: (request = {}) => fetchChronologicalFeed(options, request),
    following: (request) => fetchFollowingFeed(options, request),
  };
}
