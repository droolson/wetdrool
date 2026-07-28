import { describeEndpoint, getIndexerBaseUrl, ProviderConfigurationError } from './provider-config';

export type VerificationState = 'invalid' | 'pending' | 'verified';
export type Finality = 'confirmed' | 'finalized' | 'processed';
export type DegradedReason =
  'invalid-configuration' | 'invalid-response' | 'unavailable' | 'unconfigured';

export interface AnchorProof {
  finality: Finality;
  slot: number;
  transaction: string;
}

export interface PostVerification {
  anchor: AnchorProof | null;
  contentHash: string;
  contentHashValid: boolean;
  manifestUri: string;
  signatureValid: boolean;
  state: VerificationState;
}

export interface IndexedPost {
  author: {
    displayName: string;
    handle: string | null;
    identityId: string;
  };
  body: string | null;
  bodyReference: {
    bytes: number;
    cid: string;
    digest: string;
    mediaType: string;
  } | null;
  createdAt: string;
  id: string;
  language: string | null;
  verification: PostVerification;
}

export interface IndexerMeta {
  checkpointSlot: number | null;
  indexedAt: string;
  source: string;
}

export interface FeedResponse {
  meta: IndexerMeta;
  posts: IndexedPost[];
}

export interface PostResponse {
  meta: IndexerMeta;
  post: IndexedPost;
}

export type SearchMatch =
  | 'display-name'
  | 'exact-identifier'
  | 'handle'
  | 'manifest-reference'
  | 'post-body'
  | 'profile-bio';

export interface SearchPerson {
  bio: string;
  displayName: string;
  handle: string | null;
  identityId: string;
  kind: 'person';
  matchedBy: SearchMatch;
  updatedAt: string;
}

export interface SearchPost {
  kind: 'post';
  matchedBy: SearchMatch;
  post: IndexedPost & {
    visibility: 'public';
  };
}

export type SearchItem = SearchPerson | SearchPost;

export interface SearchResponse {
  canonical: false;
  meta: IndexerMeta;
  query: string;
  ranking: {
    deterministic: true;
    version: 'public-match-v1';
  };
  results: SearchItem[];
  scope: 'public-finalized-projection';
}

export type FeedResult =
  | {
      endpoint: string;
      kind: 'ready';
      value: FeedResponse;
    }
  | {
      detail: string;
      kind: 'degraded';
      reason: DegradedReason;
    };

export type PostResult =
  | {
      endpoint: string;
      kind: 'ready';
      value: PostResponse;
    }
  | {
      kind: 'not-found';
    }
  | {
      detail: string;
      kind: 'degraded';
      reason: DegradedReason;
    };

export type SearchResult =
  | {
      endpoint: string;
      kind: 'ready';
      value: SearchResponse;
    }
  | {
      detail: string;
      kind: 'degraded';
      reason: DegradedReason;
    };

export type PublicSearchQueryState =
  | {
      kind: 'empty';
      query: '';
    }
  | {
      detail: string;
      kind: 'invalid';
      query: string;
      reason: 'ambiguous' | 'control-characters' | 'too-long' | 'too-short';
    }
  | {
      kind: 'valid';
      query: string;
    };

type UnknownRecord = Record<string, unknown>;

const MAX_POSTS = 50;
const MAX_SEARCH_RESULTS = 50;
const MAX_BODY_LENGTH = 100_000;
const MAX_INDEXER_JSON_BYTES = 6 * 1024 * 1024;
const MIN_PUBLIC_SEARCH_QUERY_LENGTH = 3;
const MAX_PUBLIC_SEARCH_QUERY_LENGTH = 120;
const SEARCH_CONTROL_CHARACTERS = /\p{Cc}/u;

export class IndexerPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IndexerPayloadError';
  }
}

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

function utf8String(value: unknown, label: string, maximumBytes: number): string {
  const candidate = string(value, label, maximumBytes);
  if (new TextEncoder().encode(candidate).byteLength > maximumBytes) {
    throw new IndexerPayloadError(`${label} must be no longer than ${maximumBytes} UTF-8 bytes.`);
  }
  return candidate;
}

function boundedString(value: unknown, label: string, maximumLength: number): string {
  if (typeof value !== 'string' || value.length > maximumLength) {
    throw new IndexerPayloadError(
      `${label} must be a string no longer than ${maximumLength} characters.`,
    );
  }
  return value;
}

function nullableString(value: unknown, label: string, maximumLength: number): string | null {
  if (value === null) {
    return null;
  }
  return string(value, label, maximumLength);
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new IndexerPayloadError(`${label} must be a boolean.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new IndexerPayloadError(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function parseBodyReference(value: unknown): IndexedPost['bodyReference'] {
  if (value === null) {
    return null;
  }
  const reference = record(value, 'post.bodyReference');
  return {
    bytes: nonNegativeInteger(reference.bytes, 'post.bodyReference.bytes'),
    cid: string(reference.cid, 'post.bodyReference.cid', 160),
    digest: string(reference.digest, 'post.bodyReference.digest', 160),
    mediaType: string(reference.mediaType, 'post.bodyReference.mediaType', 160),
  };
}

function validDate(value: unknown, label: string): string {
  const date = string(value, label, 64);
  if (Number.isNaN(Date.parse(date))) {
    throw new IndexerPayloadError(`${label} must be an ISO-compatible date.`);
  }
  return date;
}

function oneOf<T extends string>(value: unknown, label: string, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new IndexerPayloadError(`${label} must be one of: ${allowed.join(', ')}.`);
  }
  return value as T;
}

function parseAnchor(value: unknown): AnchorProof | null {
  if (value === null) {
    return null;
  }
  const anchor = record(value, 'verification.anchor');
  return {
    finality: oneOf(anchor.finality, 'verification.anchor.finality', [
      'processed',
      'confirmed',
      'finalized',
    ] as const),
    slot: nonNegativeInteger(anchor.slot, 'verification.anchor.slot'),
    transaction: string(anchor.transaction, 'verification.anchor.transaction', 160),
  };
}

export function parseIndexedPost(value: unknown): IndexedPost {
  const post = record(value, 'post');
  const author = record(post.author, 'post.author');
  const verification = record(post.verification, 'post.verification');
  const state = oneOf(verification.state, 'verification.state', [
    'verified',
    'pending',
    'invalid',
  ] as const);
  const signatureValid = boolean(verification.signatureValid, 'verification.signatureValid');
  const contentHashValid = boolean(verification.contentHashValid, 'verification.contentHashValid');
  const anchor = parseAnchor(verification.anchor);
  const body = nullableString(post.body, 'post.body', MAX_BODY_LENGTH);
  const bodyReference = parseBodyReference(post.bodyReference);

  if (state === 'verified' && (!signatureValid || !contentHashValid || !anchor)) {
    throw new IndexerPayloadError(
      'A verified post requires valid signature and content hash checks plus an anchor proof.',
    );
  }
  if (body === null && bodyReference === null) {
    throw new IndexerPayloadError('A post requires an inline body or a body reference.');
  }

  return {
    author: {
      displayName: utf8String(author.displayName, 'post.author.displayName', 160),
      handle: nullableString(author.handle, 'post.author.handle', 80),
      identityId: string(author.identityId, 'post.author.identityId', 300),
    },
    body,
    bodyReference,
    createdAt: validDate(post.createdAt, 'post.createdAt'),
    id: string(post.id, 'post.id', 180),
    language: nullableString(post.language, 'post.language', 35),
    verification: {
      anchor,
      contentHash: string(verification.contentHash, 'verification.contentHash', 160),
      contentHashValid,
      manifestUri: string(verification.manifestUri, 'verification.manifestUri', 500),
      signatureValid,
      state,
    },
  };
}

function parseMeta(value: unknown): IndexerMeta {
  const meta = record(value, 'meta');
  return {
    checkpointSlot:
      meta.checkpointSlot === null
        ? null
        : nonNegativeInteger(meta.checkpointSlot, 'meta.checkpointSlot'),
    indexedAt: validDate(meta.indexedAt, 'meta.indexedAt'),
    source: string(meta.source, 'meta.source', 120),
  };
}

export function parseFeedResponse(value: unknown): FeedResponse {
  const response = record(value, 'response');
  if (!Array.isArray(response.posts) || response.posts.length > MAX_POSTS) {
    throw new IndexerPayloadError(
      `response.posts must be an array with at most ${MAX_POSTS} items.`,
    );
  }

  return {
    meta: parseMeta(response.meta),
    posts: response.posts.map(parseIndexedPost),
  };
}

export function parsePostResponse(value: unknown): PostResponse {
  const response = record(value, 'response');
  return {
    meta: parseMeta(response.meta),
    post: parseIndexedPost(response.post),
  };
}

export function parseSearchResponse(value: unknown): SearchResponse {
  const response = record(value, 'response');
  const ranking = record(response.ranking, 'response.ranking');
  if (
    response.canonical !== false ||
    response.scope !== 'public-finalized-projection' ||
    ranking.deterministic !== true ||
    ranking.version !== 'public-match-v1' ||
    !Array.isArray(response.results) ||
    response.results.length > MAX_SEARCH_RESULTS
  ) {
    throw new IndexerPayloadError('The public search response metadata is invalid.');
  }
  const responseQuery = string(response.query, 'response.query', 240);
  const queryState = validatePublicSearchQuery(responseQuery);
  if (queryState.kind !== 'valid' || queryState.query !== responseQuery) {
    throw new IndexerPayloadError('The public search response query is not canonical.');
  }
  return {
    canonical: false,
    meta: parseMeta(response.meta),
    query: responseQuery,
    ranking: {
      deterministic: true,
      version: 'public-match-v1',
    },
    results: response.results.map(parseSearchItem),
    scope: 'public-finalized-projection',
  };
}

function parseSearchItem(value: unknown): SearchItem {
  const item = record(value, 'search result');
  const kind = oneOf(item.kind, 'search result.kind', ['person', 'post', 'community'] as const);
  const matchedBy = oneOf(item.matchedBy, 'search result.matchedBy', [
    'display-name',
    'exact-identifier',
    'handle',
    'manifest-reference',
    'post-body',
    'profile-bio',
  ] as const);

  switch (kind) {
    case 'person':
      if (!['display-name', 'exact-identifier', 'handle', 'profile-bio'].includes(matchedBy)) {
        throw new IndexerPayloadError('A person search result has an invalid match reason.');
      }
      return {
        bio: boundedString(item.bio, 'search result.bio', 10_000),
        displayName: utf8String(item.displayName, 'search result.displayName', 160),
        handle: nullableString(item.handle, 'search result.handle', 30),
        identityId: string(item.identityId, 'search result.identityId', 300),
        kind,
        matchedBy,
        updatedAt: validDate(item.updatedAt, 'search result.updatedAt'),
      };
    case 'post': {
      if (!['exact-identifier', 'post-body'].includes(matchedBy)) {
        throw new IndexerPayloadError('A post search result has an invalid match reason.');
      }
      const publicPost = record(item.post, 'search result.post');
      if (publicPost.visibility !== 'public') {
        throw new IndexerPayloadError(
          'A post search result requires an explicit public visibility claim.',
        );
      }
      const post = parseIndexedPost(publicPost);
      if (
        post.verification.state !== 'verified' ||
        !post.verification.signatureValid ||
        !post.verification.contentHashValid ||
        post.verification.anchor?.finality !== 'finalized'
      ) {
        throw new IndexerPayloadError(
          'A post search result requires valid proofs and a finalized WokeNet anchor.',
        );
      }
      return {
        kind,
        matchedBy,
        post: {
          ...post,
          visibility: 'public',
        },
      };
    }
    case 'community':
      throw new IndexerPayloadError(
        'Community search results require verified metadata and an explicit public visibility proof.',
      );
  }
}

export function isValidPostId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9:_-]{0,179}$/.test(id);
}

function endpointFor(base: URL, pathname: string): URL {
  const normalizedBase = new URL(base);
  if (!normalizedBase.pathname.endsWith('/')) {
    normalizedBase.pathname += '/';
  }
  return new URL(pathname, normalizedBase);
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new IndexerPayloadError('The indexer did not return an application/json response.');
  }

  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    const normalizedLength = declaredLength.trim();
    if (!/^\d+$/u.test(normalizedLength)) {
      await cancelResponseBody(response.body);
      throw new IndexerPayloadError('The indexer returned an invalid Content-Length header.');
    }
    const canonicalLength = normalizedLength.replace(/^0+/u, '') || '0';
    const maximumLength = String(MAX_INDEXER_JSON_BYTES);
    if (
      canonicalLength.length > maximumLength.length ||
      (canonicalLength.length === maximumLength.length && canonicalLength > maximumLength)
    ) {
      await cancelResponseBody(response.body);
      throw new IndexerPayloadError('The indexer response exceeded the JSON byte budget.');
    }
  }

  if (response.body === null) {
    throw new IndexerPayloadError('The indexer returned an empty JSON response.');
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      receivedBytes += chunk.value.byteLength;
      if (receivedBytes > MAX_INDEXER_JSON_BYTES) {
        await cancelResponseReader(reader);
        throw new IndexerPayloadError('The indexer response exceeded the JSON byte budget.');
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(body);
  } catch {
    throw new IndexerPayloadError('The indexer returned invalid UTF-8.');
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new IndexerPayloadError('The indexer returned invalid JSON.');
  }
}

async function cancelResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
  try {
    await body?.cancel();
  } catch {
    // Cancellation is best effort after the response has already been rejected.
  }
}

async function cancelResponseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is best effort after the response has already been rejected.
  }
}

function degraded(
  reason: DegradedReason,
  detail: string,
): Extract<FeedResult, { kind: 'degraded' }> {
  return { detail, kind: 'degraded', reason };
}

export async function getHomeFeed(): Promise<FeedResult> {
  let base: URL | null;
  try {
    base = getIndexerBaseUrl();
  } catch (error) {
    const detail =
      error instanceof ProviderConfigurationError
        ? error.message
        : 'The indexer setting could not be read.';
    return degraded('invalid-configuration', detail);
  }

  if (!base) {
    return degraded(
      'unconfigured',
      'Set WOKESOCIAL_INDEXER_URL to a compatible indexer base URL. No demonstration posts are substituted.',
    );
  }

  const endpoint = endpointFor(base, 'v1/feed/home?limit=20');
  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6_000),
    });

    if (!response.ok) {
      return degraded(
        'unavailable',
        `The configured indexer returned HTTP ${response.status}. No feed data was accepted.`,
      );
    }

    try {
      const payload = await readJson(response);
      return {
        endpoint: describeEndpoint(base),
        kind: 'ready',
        value: parseFeedResponse(payload),
      };
    } catch {
      return degraded(
        'invalid-response',
        'The configured indexer returned data that did not match the typed feed contract.',
      );
    }
  } catch {
    return degraded(
      'unavailable',
      'The configured indexer could not be reached before the request deadline.',
    );
  }
}

export async function getPostById(id: string): Promise<PostResult> {
  if (!isValidPostId(id)) {
    return {
      detail: 'The post identifier is not valid.',
      kind: 'degraded',
      reason: 'invalid-response',
    };
  }

  let base: URL | null;
  try {
    base = getIndexerBaseUrl();
  } catch (error) {
    const detail =
      error instanceof ProviderConfigurationError
        ? error.message
        : 'The indexer setting could not be read.';
    return {
      detail,
      kind: 'degraded',
      reason: 'invalid-configuration',
    };
  }

  if (!base) {
    return {
      detail: 'Set WOKESOCIAL_INDEXER_URL to load and verify a post. No placeholder post is shown.',
      kind: 'degraded',
      reason: 'unconfigured',
    };
  }

  const endpoint = endpointFor(base, `v1/posts/${encodeURIComponent(id)}`);

  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6_000),
    });

    if (response.status === 404) {
      return { kind: 'not-found' };
    }

    if (!response.ok) {
      return {
        detail: `The configured indexer returned HTTP ${response.status}.`,
        kind: 'degraded',
        reason: 'unavailable',
      };
    }

    try {
      const payload = await readJson(response);
      return {
        endpoint: describeEndpoint(base),
        kind: 'ready',
        value: parsePostResponse(payload),
      };
    } catch {
      return {
        detail: 'The configured indexer returned data that did not match the typed post contract.',
        kind: 'degraded',
        reason: 'invalid-response',
      };
    }
  } catch {
    return {
      detail: 'The configured indexer could not be reached before the request deadline.',
      kind: 'degraded',
      reason: 'unavailable',
    };
  }
}

export function validatePublicSearchQuery(
  value: string | readonly string[] | undefined,
): PublicSearchQueryState {
  if (value !== undefined && typeof value !== 'string') {
    return {
      detail: 'Submit exactly one public search query.',
      kind: 'invalid',
      query: '',
      reason: 'ambiguous',
    };
  }
  if (value === undefined) return { kind: 'empty', query: '' };

  const query = value
    .normalize('NFKC')
    .replace(/\p{Z}+/gu, ' ')
    .replace(/^ +| +$/gu, '')
    .replace(/[A-Z]/gu, (character) => character.toLowerCase());
  if (SEARCH_CONTROL_CHARACTERS.test(query)) {
    return {
      detail: 'Control characters are not allowed in a public search query.',
      kind: 'invalid',
      query: '',
      reason: 'control-characters',
    };
  }

  if (query.length === 0) return { kind: 'empty', query: '' };
  const queryLength = [...query].length;
  if (queryLength < MIN_PUBLIC_SEARCH_QUERY_LENGTH) {
    return {
      detail: `Use at least ${MIN_PUBLIC_SEARCH_QUERY_LENGTH} normalized Unicode code points.`,
      kind: 'invalid',
      query,
      reason: 'too-short',
    };
  }
  if (queryLength > MAX_PUBLIC_SEARCH_QUERY_LENGTH) {
    return {
      detail: `Use no more than ${MAX_PUBLIC_SEARCH_QUERY_LENGTH} normalized Unicode code points.`,
      kind: 'invalid',
      query,
      reason: 'too-long',
    };
  }
  return { kind: 'valid', query };
}

export async function searchPublic(query: string): Promise<SearchResult> {
  const queryState = validatePublicSearchQuery(query);
  if (queryState.kind !== 'valid') {
    return {
      detail:
        queryState.kind === 'empty'
          ? 'Enter between 3 and 120 normalized Unicode code points.'
          : queryState.detail,
      kind: 'degraded',
      reason: 'invalid-response',
    };
  }
  const normalizedQuery = queryState.query;

  let base: URL | null;
  try {
    base = getIndexerBaseUrl();
  } catch (error) {
    const detail =
      error instanceof ProviderConfigurationError
        ? error.message
        : 'The indexer setting could not be read.';
    return degraded('invalid-configuration', detail);
  }

  if (!base) {
    return degraded(
      'unconfigured',
      'Set WOKESOCIAL_INDEXER_URL to a compatible indexer. No search results are fabricated.',
    );
  }

  const endpoint = endpointFor(
    base,
    `v1/search/public?q=${encodeURIComponent(normalizedQuery)}&limit=30`,
  );
  try {
    const response = await fetch(endpoint, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) {
      return degraded(
        'unavailable',
        `The configured indexer returned HTTP ${response.status}. No search data was accepted.`,
      );
    }
    try {
      const payload = await readJson(response);
      const value = parseSearchResponse(payload);
      if (value.query !== normalizedQuery) {
        throw new IndexerPayloadError('The indexer echoed a different normalized search query.');
      }
      return {
        endpoint: describeEndpoint(base),
        kind: 'ready',
        value,
      };
    } catch {
      return degraded(
        'invalid-response',
        'The configured indexer returned data that did not match the typed public-search contract.',
      );
    }
  } catch {
    return degraded(
      'unavailable',
      'The configured indexer could not be reached before the search deadline.',
    );
  }
}
