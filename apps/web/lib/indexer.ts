import {
  isValidPostId,
  parseFeedResponse,
  parsePostResponse,
  parseSearchResponse,
  validatePublicSearchQuery,
  type DegradedReason,
  type FeedResponse,
  type PostResponse,
  type PublicSearchQueryState,
  type SearchResponse,
} from './indexer-contract';
import { endpointFor, readIndexerJson } from './indexer-transport';
import { describeEndpoint, getIndexerBaseUrl, ProviderConfigurationError } from './provider-config';

export {
  IndexerPayloadError,
  isValidPostId,
  parseFeedResponse,
  parseIndexedPost,
  parsePostResponse,
  parseSearchResponse,
  validatePublicSearchQuery,
} from './indexer-contract';
export type {
  AnchorProof,
  DegradedReason,
  FeedResponse,
  Finality,
  IndexedMedia,
  IndexedPost,
  IndexerMeta,
  PostResponse,
  PostVerification,
  PublicSearchQueryState,
  SearchItem,
  SearchMatch,
  SearchPerson,
  SearchPost,
  SearchResponse,
  VerificationState,
} from './indexer-contract';
export {
  getProjectedFeed,
  parseProjectedFeedResponse,
  validateFeedCursor,
  validateFollowingViewer,
} from './projected-feed';
export type {
  FeedCursorState,
  FollowingViewerState,
  ProjectedFeedEntry,
  ProjectedFeedMode,
  ProjectedFeedReason,
  ProjectedFeedRequest,
  ProjectedFeedResponse,
  ProjectedFeedResult,
} from './projected-feed';

export type FeedResult =
  | { endpoint: string; kind: 'ready'; value: FeedResponse }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

export type PostResult =
  | { endpoint: string; kind: 'ready'; value: PostResponse }
  | { kind: 'not-found' }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

export type SearchResult =
  | { endpoint: string; kind: 'ready'; value: SearchResponse }
  | { detail: string; kind: 'degraded'; reason: DegradedReason };

type DegradedResult = Extract<FeedResult, { kind: 'degraded' }>;

function degraded(reason: DegradedReason, detail: string): DegradedResult {
  return { detail, kind: 'degraded', reason };
}

function providerError(error: unknown): string {
  return error instanceof ProviderConfigurationError
    ? error.message
    : 'The indexer setting could not be read.';
}

export async function getHomeFeed(): Promise<FeedResult> {
  let base: URL | null;
  try {
    base = getIndexerBaseUrl();
  } catch (error) {
    return degraded('invalid-configuration', providerError(error));
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
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) {
      return degraded(
        'unavailable',
        `The configured indexer returned HTTP ${response.status}. No feed data was accepted.`,
      );
    }
    try {
      return {
        endpoint: describeEndpoint(base),
        kind: 'ready',
        value: parseFeedResponse(await readIndexerJson(response)),
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
    return { detail: providerError(error), kind: 'degraded', reason: 'invalid-configuration' };
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
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (response.status === 404) return { kind: 'not-found' };
    if (!response.ok) {
      return {
        detail: `The configured indexer returned HTTP ${response.status}.`,
        kind: 'degraded',
        reason: 'unavailable',
      };
    }
    try {
      return {
        endpoint: describeEndpoint(base),
        kind: 'ready',
        value: parsePostResponse(await readIndexerJson(response)),
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

export async function searchPublic(query: string): Promise<SearchResult> {
  const queryState: PublicSearchQueryState = validatePublicSearchQuery(query);
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
    return degraded('invalid-configuration', providerError(error));
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
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(6_000),
    });
    if (!response.ok) {
      return degraded(
        'unavailable',
        `The configured indexer returned HTTP ${response.status}. No search data was accepted.`,
      );
    }
    try {
      const value = parseSearchResponse(await readIndexerJson(response));
      if (value.query !== normalizedQuery) {
        return degraded(
          'invalid-response',
          'The configured indexer returned data that did not match the typed public-search contract.',
        );
      }
      return { endpoint: describeEndpoint(base), kind: 'ready', value };
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
