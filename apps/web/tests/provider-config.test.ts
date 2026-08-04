import { describe, expect, it } from 'vitest';

import {
  describeEndpoint,
  getIndexerBaseUrl,
  getProviderSummaries,
  getDroolNetNetworkId,
  parseHttpEndpoint,
  parseRelayEndpoint,
  ProviderConfigurationError,
} from '../lib/provider-config';

const NETWORK_ID =
  'droolnet:v1:4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQqT6wAGkwhB:9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';

describe('provider configuration', () => {
  it('accepts an HTTP endpoint and exposes only its origin for display', () => {
    const endpoint = parseHttpEndpoint('https://indexer.example/v1?access_token=hidden#section');

    expect(endpoint.pathname).toBe('/v1');
    expect(describeEndpoint(endpoint)).toBe('https://indexer.example');
  });

  it('rejects embedded credentials and non-HTTP protocols', () => {
    expect(() => parseHttpEndpoint('ftp://example.test')).toThrow(ProviderConfigurationError);
    expect(() => parseHttpEndpoint('https://name:secret@example.test')).toThrow('credentials');
    expect(() => parseHttpEndpoint('https://droolhouse.com/v1')).toThrow(
      /legacy redirect-only hostname/,
    );
    expect(() => parseHttpEndpoint('https://SOCIALLYWOKE.COM../v1')).toThrow(
      /legacy redirect-only hostname/,
    );
  });

  it('accepts only credential-free WebSocket relay endpoints', () => {
    expect(describeEndpoint(parseRelayEndpoint('wss://relay.example/v1/relay'))).toBe(
      'wss://relay.example',
    );
    expect(() => parseRelayEndpoint('https://relay.example/v1/relay')).toThrow(
      ProviderConfigurationError,
    );
    expect(() => parseRelayEndpoint('wss://name:secret@relay.example/v1/relay')).toThrow(
      'credentials',
    );
    expect(() => parseRelayEndpoint('wss://www.droolhouse.com/v1/relay')).toThrow(
      /legacy redirect-only hostname/,
    );
    expect(() => parseRelayEndpoint('wss://WWW.SOCIALLYWOKE.COM../v1/relay')).toThrow(
      /legacy redirect-only hostname/,
    );
  });

  it('returns no indexer when the setting is intentionally empty', () => {
    expect(getIndexerBaseUrl({ WETDROOL_INDEXER_URL: '  ' })).toBeNull();
  });

  it('reads the server-only DroolNet deployment scope with explicit precedence', () => {
    expect(
      getDroolNetNetworkId({
        INDEXER_NETWORK_ID: 'invalid-fallback',
        WOKENET_NETWORK_ID: NETWORK_ID,
      }),
    ).toBe(NETWORK_ID);
    expect(getDroolNetNetworkId({ INDEXER_NETWORK_ID: NETWORK_ID })).toBe(NETWORK_ID);
    expect(getDroolNetNetworkId({ WOKENET_NETWORK_ID: '  ' })).toBeNull();
    expect(() => getDroolNetNetworkId({ WOKENET_NETWORK_ID: 'devnet' })).toThrow(
      ProviderConfigurationError,
    );
  });

  it('describes configured, invalid, and absent provider lists honestly', () => {
    const summaries = getProviderSummaries({
      WETDROOL_CONTENT_GATEWAYS: 'https://one.example/ipfs,not a url,https://two.example',
      WETDROOL_INDEXER_URL: 'https://indexer.example/private/path',
      WETDROOL_RELAY_ENDPOINTS: 'wss://relay-one.example/v1/relay,https://not-a-relay.example',
      SOLANA_RPC_ENDPOINTS: 'javascript:alert(1)',
    });

    expect(summaries.find(({ id }) => id === 'indexer')).toMatchObject({
      configuredCount: 1,
      displayEndpoints: ['https://indexer.example'],
    });
    expect(summaries.find(({ id }) => id === 'gateway')).toMatchObject({
      configuredCount: 2,
    });
    expect(summaries.find(({ id }) => id === 'gateway')?.detail).toContain('1 invalid');
    expect(summaries.find(({ id }) => id === 'rpc')).toMatchObject({
      configuredCount: 0,
    });
    expect(summaries.find(({ id }) => id === 'relay')).toMatchObject({
      configuredCount: 1,
      displayEndpoints: ['wss://relay-one.example'],
    });
    expect(summaries.find(({ id }) => id === 'relay')?.detail).toContain('1 invalid');
  });
});
