import { networkIdSchema, solanaPublicKeySchema } from '@wetdrool/protocol';

import { LocalCasConfigurationError, readLocalCasConfig } from './local-cas-config';

type Environment = Readonly<Record<string, string | undefined>>;

export interface LocalnetPublicationRuntime {
  readonly authServiceUrl: string;
  readonly context: {
    readonly endpoint: string;
    readonly genesisHash: string;
    readonly programAddress: string;
  };
  readonly indexerUrl: string;
  readonly networkId: string;
  readonly targetBalanceLamports: number;
}

export type LocalnetPublicationConfig =
  | { readonly kind: 'available'; readonly runtime: LocalnetPublicationRuntime }
  | { readonly detail: string; readonly kind: 'unavailable' };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const TARGET_BALANCE_LAMPORTS = 100_000_000;

/**
 * Parses the deliberately narrow browser-write runtime.
 *
 * The local faucet and filesystem-backed CAS are development proof adapters,
 * not production sponsorship or storage. Any remote endpoint, deployment
 * mismatch, production mode, or absent explicit opt-in keeps publication
 * locked.
 */
export function getLocalnetPublicationConfig(
  environment: Environment = process.env,
): LocalnetPublicationConfig {
  if (
    environment.APP_ENV !== 'development' ||
    environment.NODE_ENV === 'production' ||
    environment.WETDROOL_LOCALNET_WRITES !== '1'
  ) {
    return unavailable('Localnet publication requires an explicit development-only write opt-in.');
  }
  if (environment.NEXT_PUBLIC_SOLANA_CLUSTER !== 'localnet') {
    return unavailable('The publication proof adapter is restricted to Solana localnet.');
  }

  try {
    if (readLocalCasConfig(environment) === null) {
      return unavailable('The verified local content store is not enabled.');
    }
  } catch (error) {
    if (error instanceof LocalCasConfigurationError) {
      return unavailable('The verified local content store configuration is invalid.');
    }
    throw error;
  }

  const rpc = loopbackHttpUrl(environment.NEXT_PUBLIC_SOLANA_RPC_URL);
  const indexer = loopbackHttpUrl(
    environment.WETDROOL_INDEXER_URL ?? environment.NEXT_PUBLIC_INDEXER_URL,
  );
  const auth = loopbackHttpUrl(
    environment.WETDROOL_AUTH_URL ?? environment.NEXT_PUBLIC_AUTH_SERVICE_URL,
  );
  if (rpc === null || indexer === null || auth === null) {
    return unavailable(
      'Localnet publication requires loopback-only RPC, indexer, and authentication endpoints.',
    );
  }

  const networkId = environment.WOKENET_NETWORK_ID?.trim();
  const programAddress = environment.NEXT_PUBLIC_PROGRAM_ID?.trim();
  if (
    networkId === undefined ||
    programAddress === undefined ||
    !networkIdSchema.safeParse(networkId).success ||
    !solanaPublicKeySchema.safeParse(programAddress).success
  ) {
    return unavailable('A canonical DroolNet network ID and Solana program address are required.');
  }
  const deployment = splitNetworkId(networkId);
  if (deployment === null || deployment.programAddress !== programAddress) {
    return unavailable(
      'The configured program address does not match the DroolNet deployment identifier.',
    );
  }

  return {
    kind: 'available',
    runtime: Object.freeze({
      authServiceUrl: auth.origin,
      context: Object.freeze({
        endpoint: rpc.toString(),
        genesisHash: deployment.genesisHash,
        programAddress,
      }),
      indexerUrl: indexer.toString(),
      networkId,
      targetBalanceLamports: TARGET_BALANCE_LAMPORTS,
    }),
  };
}

function unavailable(detail: string): LocalnetPublicationConfig {
  return { detail, kind: 'unavailable' };
}

function loopbackHttpUrl(value: string | undefined): URL | null {
  if (value === undefined || value.trim() === '') return null;
  try {
    const endpoint = new URL(value);
    if (
      endpoint.protocol !== 'http:' ||
      !LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase()) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    ) {
      return null;
    }
    endpoint.pathname = endpoint.pathname.endsWith('/')
      ? endpoint.pathname
      : `${endpoint.pathname}/`;
    return endpoint;
  } catch {
    return null;
  }
}

function splitNetworkId(
  networkId: string,
): { readonly genesisHash: string; readonly programAddress: string } | null {
  const prefix = 'droolnet:v1:';
  if (!networkId.startsWith(prefix)) return null;
  const coordinates = networkId.slice(prefix.length).split(':');
  if (coordinates.length !== 2) return null;
  const [genesisHash, programAddress] = coordinates;
  return genesisHash === undefined || programAddress === undefined
    ? null
    : { genesisHash, programAddress };
}
