import {
  fetchProjectedFeed,
  type IndexerFetch,
  type ProjectedFeedRequest,
  type ProjectedFeedResult,
} from '@wokesocial/indexer-client/projected-feed';

import { describeEndpoint, getIndexerBaseUrl, ProviderConfigurationError } from './provider-config';

export * from '@wokesocial/indexer-client/projected-feed';

const webFetch: IndexerFetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: 'no-store',
  });

export async function getProjectedFeed(
  request: ProjectedFeedRequest,
): Promise<ProjectedFeedResult> {
  let base: URL | null;
  try {
    base = getIndexerBaseUrl();
  } catch (error) {
    return {
      detail:
        error instanceof ProviderConfigurationError
          ? error.message
          : 'The indexer setting could not be read.',
      kind: 'degraded',
      reason: 'invalid-configuration',
    };
  }
  if (!base) {
    return {
      detail:
        'Set WOKESOCIAL_INDEXER_URL to a compatible indexer base URL. No posts are substituted from another feed.',
      kind: 'degraded',
      reason: 'unconfigured',
    };
  }
  const result = await fetchProjectedFeed(
    { baseUrl: base, deadlineMs: 6_000, fetch: webFetch },
    request,
  );
  return result.kind === 'ready' ? { ...result, endpoint: describeEndpoint(base) } : result;
}
