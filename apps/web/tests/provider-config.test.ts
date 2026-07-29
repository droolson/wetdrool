import { describe, expect, it } from 'vitest';

import {
  describeEndpoint,
  getIndexerBaseUrl,
  getProviderSummaries,
  parseHttpEndpoint,
  parseRelayEndpoint,
  ProviderConfigurationError,
} from '../lib/provider-config';

describe('provider configuration', () => {
  it('accepts an HTTP endpoint and exposes only its origin for display', () => {
    const endpoint = parseHttpEndpoint('https://indexer.example/v1?access_token=hidden#section');

    expect(endpoint.pathname).toBe('/v1');
    expect(describeEndpoint(endpoint)).toBe('https://indexer.example');
  });

  it('rejects embedded credentials and non-HTTP protocols', () => {
    expect(() => parseHttpEndpoint('ftp://example.test')).toThrow(ProviderConfigurationError);
    expect(() => parseHttpEndpoint('https://name:secret@example.test')).toThrow('credentials');
    expect(() => parseHttpEndpoint('https://sociallywoke.com/v1')).toThrow(
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
    expect(() => parseRelayEndpoint('wss://www.sociallywoke.com/v1/relay')).toThrow(
      /legacy redirect-only hostname/,
    );
    expect(() => parseRelayEndpoint('wss://WWW.SOCIALLYWOKE.COM../v1/relay')).toThrow(
      /legacy redirect-only hostname/,
    );
  });

  it('returns no indexer when the setting is intentionally empty', () => {
    expect(getIndexerBaseUrl({ WOKESOCIAL_INDEXER_URL: '  ' })).toBeNull();
  });

  it('describes configured, invalid, and absent provider lists honestly', () => {
    const summaries = getProviderSummaries({
      WOKESOCIAL_CONTENT_GATEWAYS: 'https://one.example/ipfs,not a url,https://two.example',
      WOKESOCIAL_INDEXER_URL: 'https://indexer.example/private/path',
      WOKESOCIAL_RELAY_ENDPOINTS: 'wss://relay-one.example/v1/relay,https://not-a-relay.example',
      WOKENET_RPC_ENDPOINTS: 'javascript:alert(1)',
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
