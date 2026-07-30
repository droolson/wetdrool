import {
  fetchIdentityProfile,
  type IdentityProfileResult,
} from '@wokesocial/indexer-client/identity-profile';
import type { IndexerFetch } from '@wokesocial/indexer-client/projected-feed';
import { identityIdSchema } from '@wokesocial/protocol';

import {
  getIndexerBaseUrl,
  getWokeNetNetworkId,
  ProviderConfigurationError,
} from './provider-config';

export type {
  IdentityProfileResult,
  IdentityProfileView,
} from '@wokesocial/indexer-client/identity-profile';

/**
 * A route segment that is not a portable identity identifier is reported as
 * exactly that, instead of being conflated with provider configuration or
 * transport failures.
 */
export type IdentityProfilePageResult = IdentityProfileResult | { kind: 'invalid-identifier' };

const webFetch: IndexerFetch = (input, init) =>
  fetch(input, {
    ...init,
    cache: 'no-store',
  });

export async function getIdentityProfile(identityId: string): Promise<IdentityProfilePageResult> {
  if (!identityIdSchema.safeParse(identityId).success) {
    return { kind: 'invalid-identifier' };
  }

  let base: URL | null;
  let network: string | null;
  try {
    base = getIndexerBaseUrl();
    network = getWokeNetNetworkId();
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
        'Set WOKESOCIAL_INDEXER_URL to a compatible indexer. No profile state is substituted.',
      kind: 'degraded',
      reason: 'unconfigured',
    };
  }

  const result = await fetchIdentityProfile(
    { baseUrl: base.toString(), deadlineMs: 6_000, fetch: webFetch },
    { identityId },
  );
  if (result.kind === 'ready' && network !== null && result.value.network !== network) {
    return {
      detail:
        'The resolved identity belongs to a different WokeNet Solana deployment than this app is configured for.',
      kind: 'degraded',
      reason: 'invalid-response',
    };
  }
  return result;
}
