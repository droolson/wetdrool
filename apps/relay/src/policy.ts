export const RELAY_PROTOCOL = 'wokesocial-relay' as const;
export const RELAY_PROTOCOL_VERSION = 1 as const;
export const RELAY_PATH = '/v1/relay' as const;
export const RELAY_KEY_AUTHORIZATION_MODES = ['locked', 'unverified-local', 'verified'] as const;
export type RelayKeyAuthorizationMode = (typeof RELAY_KEY_AUTHORIZATION_MODES)[number];

export const RELAY_POLICY = {
  clock: {
    maximumFutureSkewMilliseconds: 30_000,
    maximumPastAgeMilliseconds: 5 * 60_000,
    maximumLifetimeMilliseconds: 10 * 60_000,
  },
  connection: {
    heartbeatIntervalMilliseconds: 15_000,
    idleTimeoutMilliseconds: 45_000,
    maximumBufferedBytes: 512 * 1_024,
    maximumConnectionsPerIp: 24,
    maximumSubscriptions: 32,
  },
  message: {
    maximumBytes: 64 * 1_024,
    maximumCiphertextCharacters: 48 * 1_024,
    maximumMetadataCharacters: 4 * 1_024,
  },
  rateLimit: {
    identityMessagesPerMinute: 120,
    ipMessagesPerMinute: 240,
  },
  retention: {
    maximumEvents: 2_000,
    maximumEventsPerTopic: 100,
    maximumMilliseconds: 2 * 60_000,
    maximumReplayNonces: 20_000,
  },
} as const;

export const publicRelayPolicy = {
  advisory: true,
  canonical: false,
  policyVersion: 'relay-policy-v1',
  ...RELAY_POLICY,
} as const;
