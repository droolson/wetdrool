import { existsSync } from 'node:fs';
import { join } from 'node:path';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const LOCAL_DEV_URL_VARIABLES = [
  'ALLOWED_ORIGINS',
  'AUTH_DATABASE_MIGRATION_URL',
  'AUTH_DATABASE_URL',
  'AUTH_ORIGIN',
  'DATABASE_MIGRATION_URL',
  'DATABASE_URL',
  'FEED_SERVICE_CORS_ORIGINS',
  'IPFS_API_URL',
  'IPFS_GATEWAY_URL',
  'MODERATION_ALLOWED_ORIGINS',
  'MODERATION_DATABASE_MIGRATION_URL',
  'MODERATION_DATABASE_URL',
  'NEXT_PUBLIC_APP_ORIGIN',
  'NEXT_PUBLIC_AUTH_SERVICE_URL',
  'NEXT_PUBLIC_FEED_SERVICE_URL',
  'NEXT_PUBLIC_INDEXER_URL',
  'NEXT_PUBLIC_IPFS_GATEWAY_URL',
  'NEXT_PUBLIC_MEDIA_WORKER_URL',
  'NEXT_PUBLIC_MODERATION_SERVICE_URL',
  'NEXT_PUBLIC_RELAY_URL',
  'NEXT_PUBLIC_SOLANA_RPC_URL',
  'REDIS_URL',
  'RELAY_ALLOWED_ORIGINS',
  'SOLANA_RPC_ENDPOINTS',
  'SOLANA_RPC_URL',
  'SOLANA_RPC_URLS',
  'SOLANA_WS_URL',
  'SOLANA_WS_URLS',
  'WETDROOL_AUTH_URL',
  'WETDROOL_CONTENT_GATEWAYS',
  'WETDROOL_INDEXER_URL',
  'WETDROOL_RELAY_ENDPOINTS',
];

export const LOCAL_DEV_CONTAINER_PROFILES = ['media'];
export const LOCAL_DEV_EXCLUDED_PACKAGES = ['@wetdrool/media-worker'];
export const LOCAL_DEV_ENVIRONMENT_OVERRIDES = {
  MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
  RELAY_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
};

export function removeLocalSetupDatabaseSecrets(environment) {
  for (const name of Object.keys(environment)) {
    if (
      ['PGPASSWORD', 'PGPASSFILE', 'POSTGRES_PASSWORD', 'POSTGRES_PASSWORD_FILE'].includes(name) ||
      /(?:^|_)DATABASE_(?:MIGRATION|RUNTIME)_(?:PASSWORD|URL)$/u.test(name)
    ) {
      Reflect.deleteProperty(environment, name);
    }
  }
}

export function selectLocalEnvironmentFile(repositoryRoot) {
  const localOverride = join(repositoryRoot, '.env');
  return existsSync(localOverride) ? localOverride : join(repositoryRoot, '.env.example');
}

export function assertSafeLocalDevelopmentEnvironment(environment) {
  const appEnvironment = environment.APP_ENV ?? 'development';
  const nodeEnvironment = environment.NODE_ENV ?? 'development';
  if (appEnvironment !== 'development' || nodeEnvironment !== 'development') {
    throw new Error(
      'The root local-development commands require APP_ENV=development and NODE_ENV=development.',
    );
  }
  const solanaCluster = environment.NEXT_PUBLIC_SOLANA_CLUSTER ?? 'localnet';
  if (solanaCluster !== 'localnet') {
    throw new Error(
      'NEXT_PUBLIC_SOLANA_CLUSTER must be localnet for the root local-development stack.',
    );
  }

  const localServices = [
    ['AUTH_HOST', environment.AUTH_HOST ?? '127.0.0.1'],
    ['FEED_SERVICE_HOST', environment.FEED_SERVICE_HOST ?? '127.0.0.1'],
    ['INDEXER_HOST', environment.INDEXER_HOST ?? '127.0.0.1'],
    ['MEDIA_WORKER_CLAMD_HOST', environment.MEDIA_WORKER_CLAMD_HOST ?? '127.0.0.1'],
    ['MODERATION_HOST', environment.MODERATION_HOST ?? '127.0.0.1'],
    ['RELAY_HOST', environment.RELAY_HOST ?? '127.0.0.1'],
  ];
  for (const [name, host] of localServices) {
    if (!LOOPBACK_HOSTS.has(host.toLowerCase())) {
      throw new Error(`${name} must bind to loopback for the root local-development stack.`);
    }
  }

  for (const name of LOCAL_DEV_URL_VARIABLES) {
    const configured = environment[name];
    if (configured === undefined || configured.trim() === '') {
      continue;
    }
    for (const value of configured.split(',').map((item) => item.trim())) {
      let url;
      try {
        url = new URL(value);
      } catch {
        throw new Error(`${name} must contain valid local URLs for the root development stack.`);
      }
      if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
        throw new Error(`${name} must target loopback for the root local-development stack.`);
      }
    }
  }
}

export function localDevTurboArguments() {
  return [
    'exec',
    'turbo',
    'run',
    'dev',
    '--env-mode=loose',
    ...LOCAL_DEV_EXCLUDED_PACKAGES.map((name) => `--filter=!${name}`),
  ];
}
