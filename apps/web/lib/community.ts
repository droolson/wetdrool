import {
  fetchCommunityDetail,
  fetchCommunityDirectory,
  validateCommunityAddress,
  validateCommunityCursor,
  type CommunityAddressState,
  type CommunityCursorState,
  type CommunityDetailResult,
  type CommunityDirectoryResult,
} from '@wetdrool/indexer-client/community';
import type { IndexerFetch } from '@wetdrool/indexer-client/projected-feed';

import {
  describeEndpoint,
  getIndexerBaseUrl,
  getDroolNetNetworkId,
  ProviderConfigurationError,
} from './provider-config';

export * from '@wetdrool/indexer-client/community';
export type {
  CommunitySearchMatch,
  DirectVerifiedCommunity,
  PublicVerifiedCommunity,
  VerifiedCommunity,
} from '@wetdrool/indexer-client/contract';

const webFetch: IndexerFetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: 'no-store',
  });

type CommunityConfiguration =
  | { base: URL; kind: 'ready'; network: string }
  | {
      detail: string;
      kind: 'degraded';
      reason: 'invalid-configuration' | 'unconfigured';
    };

function providerError(error: unknown): string {
  return error instanceof ProviderConfigurationError
    ? error.message
    : 'The DroolNet community provider settings could not be read.';
}

function getCommunityConfiguration(): CommunityConfiguration {
  let base: URL | null;
  let network: string | null;
  try {
    base = getIndexerBaseUrl();
    network = getDroolNetNetworkId();
  } catch (error) {
    return {
      detail: providerError(error),
      kind: 'degraded',
      reason: 'invalid-configuration',
    };
  }
  if (!base) {
    return {
      detail:
        'Set WETDROOL_INDEXER_URL to a compatible indexer. No community records are substituted.',
      kind: 'degraded',
      reason: 'unconfigured',
    };
  }
  if (!network) {
    return {
      detail:
        'Set the server-only WOKENET_NETWORK_ID to the canonical Solana deployment this directory should query.',
      kind: 'degraded',
      reason: 'unconfigured',
    };
  }
  return { base, kind: 'ready', network };
}

export async function getCommunityDirectory(request: {
  cursor?: string;
}): Promise<CommunityDirectoryResult> {
  const cursorState: CommunityCursorState = validateCommunityCursor(request.cursor);
  if (cursorState.kind === 'invalid') {
    return { detail: cursorState.detail, kind: 'degraded', reason: 'invalid-response' };
  }
  const configuration = getCommunityConfiguration();
  if (configuration.kind === 'degraded') return configuration;
  const result = await fetchCommunityDirectory(
    { baseUrl: configuration.base, deadlineMs: 6_000, fetch: webFetch },
    {
      ...(cursorState.kind === 'valid' ? { cursor: cursorState.cursor } : {}),
      limit: 20,
      network: configuration.network,
    },
  );
  return result.kind === 'ready'
    ? { ...result, endpoint: describeEndpoint(configuration.base) }
    : result;
}

export async function getCommunityDetail(address: string): Promise<CommunityDetailResult> {
  const addressState: CommunityAddressState = validateCommunityAddress(address);
  if (addressState.kind !== 'valid') {
    return {
      detail:
        addressState.kind === 'invalid'
          ? addressState.detail
          : 'A canonical Solana community address is required.',
      kind: 'degraded',
      reason: 'invalid-response',
    };
  }
  const configuration = getCommunityConfiguration();
  if (configuration.kind === 'degraded') return configuration;
  const result = await fetchCommunityDetail(
    { baseUrl: configuration.base, deadlineMs: 6_000, fetch: webFetch },
    { address: addressState.address, network: configuration.network },
  );
  return result.kind === 'ready'
    ? { ...result, endpoint: describeEndpoint(configuration.base) }
    : result;
}
