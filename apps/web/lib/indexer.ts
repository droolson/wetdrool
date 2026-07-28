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

type UnknownRecord = Record<string, unknown>;

const MAX_POSTS = 50;
const MAX_BODY_LENGTH = 100_000;

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
      displayName: string(author.displayName, 'post.author.displayName', 120),
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
  return response.json() as Promise<unknown>;
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
