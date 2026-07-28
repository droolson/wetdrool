export type ProviderKind = 'gateway' | 'indexer' | 'relay' | 'rpc';

export interface ProviderSummary {
  configuredCount: number;
  detail: string;
  displayEndpoints: string[];
  id: ProviderKind;
  label: string;
}

type Environment = Readonly<Record<string, string | undefined>>;

const LEGACY_REDIRECT_HOSTS = new Set(['sociallywoke.com', 'www.sociallywoke.com']);
const ENDPOINT_KEYS: Readonly<
  Record<ProviderKind, { key: string; label: string; plural: boolean }>
> = {
  indexer: {
    key: 'WOKESOCIAL_INDEXER_URL',
    label: 'Indexer',
    plural: false,
  },
  rpc: {
    key: 'WOKENET_RPC_ENDPOINTS',
    label: 'WokeNet RPC',
    plural: true,
  },
  gateway: {
    key: 'WOKESOCIAL_CONTENT_GATEWAYS',
    label: 'Content gateways',
    plural: true,
  },
  relay: {
    key: 'WOKESOCIAL_RELAY_ENDPOINTS',
    label: 'Real-time relays',
    plural: true,
  },
};

export class ProviderConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderConfigurationError';
  }
}

export function parseHttpEndpoint(rawValue: string): URL {
  return parseEndpoint(rawValue, ['http:', 'https:'], 'HTTP and HTTPS');
}

export function parseRelayEndpoint(rawValue: string): URL {
  return parseEndpoint(rawValue, ['ws:', 'wss:'], 'WebSocket (WS and WSS)');
}

function parseEndpoint(
  rawValue: string,
  allowedProtocols: readonly string[],
  protocolDescription: string,
): URL {
  const value = rawValue.trim();
  if (!value) {
    throw new ProviderConfigurationError('The endpoint is empty.');
  }

  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    throw new ProviderConfigurationError('The endpoint is not a valid URL.');
  }

  if (!allowedProtocols.includes(endpoint.protocol)) {
    throw new ProviderConfigurationError(
      `Only ${protocolDescription} provider endpoints are supported.`,
    );
  }

  if (endpoint.username || endpoint.password) {
    throw new ProviderConfigurationError('Provider credentials must not be embedded in a URL.');
  }
  if (LEGACY_REDIRECT_HOSTS.has(endpoint.hostname.toLowerCase())) {
    throw new ProviderConfigurationError(
      'The legacy redirect-only hostname cannot be a provider endpoint.',
    );
  }

  endpoint.hash = '';
  return endpoint;
}

export function getIndexerBaseUrl(environment: Environment = process.env): URL | null {
  const rawValue = environment.WOKESOCIAL_INDEXER_URL?.trim();
  return rawValue ? parseHttpEndpoint(rawValue) : null;
}

export function describeEndpoint(endpoint: URL): string {
  const defaultPort =
    ((endpoint.protocol === 'https:' || endpoint.protocol === 'wss:') && endpoint.port === '443') ||
    ((endpoint.protocol === 'http:' || endpoint.protocol === 'ws:') && endpoint.port === '80');
  const port = endpoint.port && !defaultPort ? `:${endpoint.port}` : '';
  return `${endpoint.protocol}//${endpoint.hostname}${port}`;
}

function parseList(
  rawValue: string | undefined,
  parse: (value: string) => URL = parseHttpEndpoint,
): {
  invalidCount: number;
  urls: URL[];
} {
  if (!rawValue?.trim()) {
    return { invalidCount: 0, urls: [] };
  }

  let invalidCount = 0;
  const urls: URL[] = [];

  for (const item of rawValue.split(',')) {
    if (!item.trim()) {
      continue;
    }

    try {
      urls.push(parse(item));
    } catch {
      invalidCount += 1;
    }
  }

  return { invalidCount, urls };
}

export function getProviderSummaries(environment: Environment = process.env): ProviderSummary[] {
  return (Object.keys(ENDPOINT_KEYS) as ProviderKind[]).map((id) => {
    const definition = ENDPOINT_KEYS[id];
    const rawValue = environment[definition.key];
    const parse = id === 'relay' ? parseRelayEndpoint : parseHttpEndpoint;
    const parsed = definition.plural
      ? parseList(rawValue, parse)
      : parseList(rawValue?.trim() ? rawValue : undefined, parse);
    const displayEndpoints = parsed.urls.map(describeEndpoint);

    let detail = 'No endpoint has been configured.';
    if (parsed.urls.length > 0 && parsed.invalidCount === 0) {
      detail =
        parsed.urls.length === 1
          ? 'One endpoint is configured. Health is checked only when the service is used.'
          : `${parsed.urls.length} endpoints are configured for ordered fallback. Runtime health is not implied.`;
    } else if (parsed.urls.length > 0) {
      detail = `${parsed.urls.length} valid and ${parsed.invalidCount} invalid endpoint ${
        parsed.invalidCount === 1 ? 'entry' : 'entries'
      } found.`;
    } else if (parsed.invalidCount > 0) {
      detail = 'Configuration is present, but no endpoint URL is valid.';
    }

    return {
      configuredCount: parsed.urls.length,
      detail,
      displayEndpoints,
      id,
      label: definition.label,
    };
  });
}
