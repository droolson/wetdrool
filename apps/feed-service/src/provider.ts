import { FEED_POLICY_VERSION } from './policy.js';

export const FEED_PROVIDER_PROTOCOL = 'wokesocial-feed-provider' as const;
export const FEED_PROVIDER_PROTOCOL_VERSION = 1 as const;
export const REFERENCE_FEED_PROVIDER_ID = 'org.wokesocial.reference-feed' as const;

export const feedProviderDescriptor = {
  protocol: FEED_PROVIDER_PROTOCOL,
  protocolVersion: FEED_PROVIDER_PROTOCOL_VERSION,
  providerId: REFERENCE_FEED_PROVIDER_ID,
  canonical: false,
  endpoint: '/v1/rank',
  descriptorEndpoint: '/v1/provider',
  policyEndpoint: '/v1/policy',
  policyVersion: FEED_POLICY_VERSION,
  modes: [
    {
      mode: 'chronological',
      algorithmId: 'chronological-newest-first',
      algorithmVersion: '1.0.0',
    },
    {
      mode: 'following',
      algorithmId: 'following-chronological',
      algorithmVersion: '1.0.0',
    },
    {
      mode: 'community',
      algorithmId: 'community-chronological',
      algorithmVersion: '1.0.0',
    },
    {
      mode: 'trending',
      algorithmId: 'bounded-window-trending',
      algorithmVersion: '1.0.0',
    },
    {
      mode: 'media',
      algorithmId: 'media-chronological',
      algorithmVersion: '1.0.0',
    },
    {
      mode: 'recommended',
      algorithmId: 'explainable-recommendation',
      algorithmVersion: '1.0.0',
    },
    {
      mode: 'third-party',
      algorithmId: 'external-order-reconciliation',
      algorithmVersion: '1.0.0',
    },
  ],
  assurance: {
    verifiesProjectionSignatures: false,
    verifiesContentAuthenticity: false,
    verifiesExternalProviderOrder: false,
    clientMustReapplySafetyControls: true,
    acceptsSensitiveTraitInputs: false,
  },
} as const;

export interface AppliedAlgorithm {
  readonly providerId: string;
  readonly endpoint: string;
  readonly algorithmId: string;
  readonly algorithmVersion: string;
  readonly externalOrderVerified: false;
}

export function algorithmForMode(
  mode: Exclude<(typeof feedProviderDescriptor.modes)[number]['mode'], 'third-party'>,
): AppliedAlgorithm {
  const definition = feedProviderDescriptor.modes.find((entry) => entry.mode === mode);
  if (definition === undefined) {
    throw new RangeError(`No reference feed algorithm is registered for ${mode}.`);
  }
  return {
    providerId: REFERENCE_FEED_PROVIDER_ID,
    endpoint: feedProviderDescriptor.endpoint,
    algorithmId: definition.algorithmId,
    algorithmVersion: definition.algorithmVersion,
    externalOrderVerified: false,
  };
}
