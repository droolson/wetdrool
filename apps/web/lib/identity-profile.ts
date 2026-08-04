import {
  fetchIdentityProfile,
  type IdentityProfileResult,
} from '@wetdrool/indexer-client/identity-profile';
import type { IndexerFetch } from '@wetdrool/indexer-client/projected-feed';
import { identityIdSchema } from '@wetdrool/protocol';

import {
  getIndexerBaseUrl,
  getDroolNetNetworkId,
  ProviderConfigurationError,
} from './provider-config';

export type {
  IdentityProfileResult,
  IdentityProfileView,
} from '@wetdrool/indexer-client/identity-profile';

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
    network = getDroolNetNetworkId();
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
        'Set WETDROOL_INDEXER_URL to a compatible indexer. No profile state is substituted.',
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
        'The resolved identity belongs to a different DroolNet Solana deployment than this app is configured for.',
      kind: 'degraded',
      reason: 'invalid-response',
    };
  }
  return result;
}
