import { isAbsolute, parse, resolve } from 'node:path';

export const LOCAL_CAS_MAXIMUM_ALLOWED_BYTES = 1_000_000;
export const LOCAL_CAS_DEFAULT_MAXIMUM_BYTES = 262_144;

type Environment = Readonly<Record<string, string | undefined>>;

export interface LocalCasConfig {
  readonly allowedOrigin: string;
  readonly maximumObjectBytes: number;
  readonly rootDirectory: string;
}

export class LocalCasConfigurationError extends Error {
  override readonly name = 'LocalCasConfigurationError';
}

export function readLocalCasConfig(environment: Environment = process.env): LocalCasConfig | null {
  const mode = environment.WOKESOCIAL_LOCAL_CAS_MODE?.trim();
  if (!mode) {
    return null;
  }
  if (mode !== 'localnet') {
    throw new LocalCasConfigurationError(
      'The browser-writeable CAS supports only explicit localnet mode.',
    );
  }

  const deploymentEnvironment = environment.APP_ENV?.trim().toLowerCase();
  const vercelEnvironment = environment.VERCEL_ENV?.trim();
  if (
    deploymentEnvironment !== 'development' ||
    environment.NODE_ENV === 'production' ||
    vercelEnvironment
  ) {
    throw new LocalCasConfigurationError(
      'The browser-writeable CAS is unavailable in remote deployment environments.',
    );
  }

  const allowedOrigin = parseLocalOrigin(environment.WOKESOCIAL_LOCAL_CAS_ORIGIN);
  const rootDirectory = parseStorageRoot(environment.CONTENT_STORAGE_PATH);
  const maximumObjectBytes = parseMaximumObjectBytes(environment.WOKESOCIAL_LOCAL_CAS_MAX_BYTES);

  return {
    allowedOrigin,
    maximumObjectBytes,
    rootDirectory,
  };
}

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname
    .toLowerCase()
    .replace(/^\[|\]$/gu, '')
    .replace(/\.+$/u, '');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

function parseLocalOrigin(value: string | undefined): string {
  const rawValue = value?.trim();
  if (!rawValue) {
    throw new LocalCasConfigurationError(
      'WOKESOCIAL_LOCAL_CAS_ORIGIN is required in localnet mode.',
    );
  }

  let origin: URL;
  try {
    origin = new URL(rawValue);
  } catch {
    throw new LocalCasConfigurationError(
      'WOKESOCIAL_LOCAL_CAS_ORIGIN must be an absolute URL origin.',
    );
  }

  if (
    origin.protocol !== 'http:' ||
    !isLoopbackHostname(origin.hostname) ||
    origin.username ||
    origin.password ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    origin.origin !== rawValue
  ) {
    throw new LocalCasConfigurationError(
      'WOKESOCIAL_LOCAL_CAS_ORIGIN must be an exact loopback HTTP origin.',
    );
  }

  return origin.origin;
}

function parseStorageRoot(value: string | undefined): string {
  const rawValue = value?.trim();
  if (!rawValue || !isAbsolute(rawValue)) {
    throw new LocalCasConfigurationError(
      'CONTENT_STORAGE_PATH must be an explicit absolute path shared with the local indexer.',
    );
  }

  const rootDirectory = resolve(rawValue);
  if (rootDirectory === parse(rootDirectory).root) {
    throw new LocalCasConfigurationError('CONTENT_STORAGE_PATH must not be a filesystem root.');
  }
  return rootDirectory;
}

function parseMaximumObjectBytes(value: string | undefined): number {
  const rawValue = value?.trim();
  if (!rawValue) {
    return LOCAL_CAS_DEFAULT_MAXIMUM_BYTES;
  }
  if (!/^[1-9][0-9]{0,6}$/u.test(rawValue)) {
    throw new LocalCasConfigurationError(
      'WOKESOCIAL_LOCAL_CAS_MAX_BYTES must be a positive decimal integer.',
    );
  }

  const maximumObjectBytes = Number(rawValue);
  if (maximumObjectBytes > LOCAL_CAS_MAXIMUM_ALLOWED_BYTES) {
    throw new LocalCasConfigurationError(
      `WOKESOCIAL_LOCAL_CAS_MAX_BYTES must not exceed ${LOCAL_CAS_MAXIMUM_ALLOWED_BYTES}.`,
    );
  }
  return maximumObjectBytes;
}
