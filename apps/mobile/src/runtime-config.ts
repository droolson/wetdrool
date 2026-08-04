import { clusterApiUrl, PublicKey } from '@solana/web3.js';
import { networkIdSchema } from '@wetdrool/protocol';

export type MobileSolanaChain = 'solana:devnet' | 'solana:mainnet-beta';

export interface WetDroolDeployment {
  readonly expectedGenesisHash: string;
  readonly id: string;
  readonly programId: string;
}

export interface MobileRuntimeConfig {
  readonly chain: MobileSolanaChain;
  readonly deployment: WetDroolDeployment | null;
  readonly indexerUrl: string | null;
  readonly rpcUrl: string;
}

export type MobileRuntimeConfigResult =
  | { readonly detail: string; readonly kind: 'invalid' }
  | { readonly kind: 'ready'; readonly value: MobileRuntimeConfig };

export interface MobileRuntimeEnvironment {
  readonly EXPO_PUBLIC_SOLANA_CHAIN?: string | undefined;
  readonly EXPO_PUBLIC_SOLANA_RPC_URL?: string | undefined;
  readonly EXPO_PUBLIC_WOKENET_NETWORK_ID?: string | undefined;
  readonly EXPO_PUBLIC_WOKENET_RPC_URL?: string | undefined;
  readonly EXPO_PUBLIC_WETDROOL_DEPLOYMENT_ID?: string | undefined;
  readonly EXPO_PUBLIC_WETDROOL_INDEXER_URL?: string | undefined;
  readonly EXPO_PUBLIC_WETDROOL_PROGRAM_ID?: string | undefined;
}

export interface MobileRuntimeConfigOptions {
  readonly allowInsecureDevelopmentEndpoints?: boolean;
}

const RETIRED_VARIABLES = [
  'EXPO_PUBLIC_WOKENET_NETWORK_ID',
  'EXPO_PUBLIC_WOKENET_RPC_URL',
] as const;

function invalid(detail: string): MobileRuntimeConfigResult {
  return { detail, kind: 'invalid' };
}

function normalizeOptional(value: string | undefined): string | null {
  if (value === undefined || value.trim() === '') return null;
  return value.trim();
}

function parseChain(value: string | undefined): MobileSolanaChain | null {
  const normalized = value?.trim() || 'solana:devnet';
  return normalized === 'solana:devnet' || normalized === 'solana:mainnet-beta' ? normalized : null;
}

function defaultRpcUrl(chain: MobileSolanaChain): string {
  return clusterApiUrl(chain === 'solana:devnet' ? 'devnet' : 'mainnet-beta');
}

function parseEndpoint(
  value: string,
  label: string,
  allowInsecureDevelopmentEndpoints: boolean,
):
  | { readonly kind: 'valid'; readonly value: string }
  | { readonly detail: string; readonly kind: 'invalid' } {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { detail: `${label} must be an absolute URL.`, kind: 'invalid' };
  }
  if (
    (parsed.protocol !== 'https:' &&
      !(allowInsecureDevelopmentEndpoints && parsed.protocol === 'http:')) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    return {
      detail: `${label} must use HTTPS without embedded credentials or a fragment.`,
      kind: 'invalid',
    };
  }
  return { kind: 'valid', value: parsed.toString() };
}

function parseProgramId(value: string): string | null {
  try {
    const publicKey = new PublicKey(value);
    if (publicKey.equals(PublicKey.default)) return null;
    return publicKey.toBase58() === value ? value : null;
  } catch {
    return null;
  }
}

export function parseMobileRuntimeConfig(
  environment: MobileRuntimeEnvironment,
  options: MobileRuntimeConfigOptions = {},
): MobileRuntimeConfigResult {
  for (const retired of RETIRED_VARIABLES) {
    if (normalizeOptional(environment[retired]) !== null) {
      return invalid(
        `${retired} is retired. Use EXPO_PUBLIC_SOLANA_RPC_URL and EXPO_PUBLIC_WETDROOL_DEPLOYMENT_ID.`,
      );
    }
  }

  const chain = parseChain(environment.EXPO_PUBLIC_SOLANA_CHAIN);
  if (chain === null) {
    return invalid('EXPO_PUBLIC_SOLANA_CHAIN must be solana:devnet or solana:mainnet-beta.');
  }

  const allowInsecureDevelopmentEndpoints = options.allowInsecureDevelopmentEndpoints === true;
  const rpc = parseEndpoint(
    normalizeOptional(environment.EXPO_PUBLIC_SOLANA_RPC_URL) ?? defaultRpcUrl(chain),
    'EXPO_PUBLIC_SOLANA_RPC_URL',
    allowInsecureDevelopmentEndpoints,
  );
  if (rpc.kind === 'invalid') return invalid(rpc.detail);

  const rawIndexerUrl = normalizeOptional(environment.EXPO_PUBLIC_WETDROOL_INDEXER_URL);
  let indexerUrl: string | null = null;
  if (rawIndexerUrl !== null) {
    const indexer = parseEndpoint(
      rawIndexerUrl,
      'EXPO_PUBLIC_WETDROOL_INDEXER_URL',
      allowInsecureDevelopmentEndpoints,
    );
    if (indexer.kind === 'invalid') return invalid(indexer.detail);
    indexerUrl = indexer.value;
  }

  const rawProgramId = normalizeOptional(environment.EXPO_PUBLIC_WETDROOL_PROGRAM_ID);
  const rawDeploymentId = normalizeOptional(environment.EXPO_PUBLIC_WETDROOL_DEPLOYMENT_ID);
  if ((rawProgramId === null) !== (rawDeploymentId === null)) {
    return invalid(
      'EXPO_PUBLIC_WETDROOL_PROGRAM_ID and EXPO_PUBLIC_WETDROOL_DEPLOYMENT_ID must be configured together.',
    );
  }

  let deployment: WetDroolDeployment | null = null;
  if (rawProgramId !== null && rawDeploymentId !== null) {
    const programId = parseProgramId(rawProgramId);
    if (programId === null) {
      return invalid('EXPO_PUBLIC_WETDROOL_PROGRAM_ID must be a canonical Solana public key.');
    }
    const parsedDeployment = networkIdSchema.safeParse(rawDeploymentId);
    if (!parsedDeployment.success) {
      return invalid(
        'EXPO_PUBLIC_WETDROOL_DEPLOYMENT_ID must be droolnet:v1:<Solana genesis hash>:<program ID>.',
      );
    }
    const [, , expectedGenesisHash, deploymentProgramId] = parsedDeployment.data.split(':');
    if (
      expectedGenesisHash === undefined ||
      deploymentProgramId === undefined ||
      deploymentProgramId !== programId
    ) {
      return invalid(
        'The WetDrool program ID must match the program encoded in its DroolNet deployment ID.',
      );
    }
    deployment = {
      expectedGenesisHash,
      id: parsedDeployment.data,
      programId,
    };
  }

  if (indexerUrl !== null && deployment === null) {
    return invalid(
      'A mobile indexer URL requires a configured WetDrool Solana deployment so feed responses can be network-bound.',
    );
  }

  return {
    kind: 'ready',
    value: {
      chain,
      deployment,
      indexerUrl,
      rpcUrl: rpc.value,
    },
  };
}

export function runtimeEndpointLabel(endpoint: string): string {
  const parsed = new URL(endpoint);
  return parsed.port === '' ? parsed.hostname : `${parsed.hostname}:${parsed.port}`;
}
