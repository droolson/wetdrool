import { parse } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  LOCAL_CAS_DEFAULT_MAXIMUM_BYTES,
  LocalCasConfigurationError,
  readLocalCasConfig,
} from '../lib/local-cas-config';

const STORAGE_ROOT = '/tmp/wokesocial-local-cas';
const DEVELOPMENT_ENVIRONMENT = {
  APP_ENV: 'development',
  NODE_ENV: 'test',
} as const;

describe('local CAS configuration', () => {
  it('is disabled unless localnet mode is explicit', () => {
    expect(readLocalCasConfig({})).toBeNull();
    expect(() =>
      readLocalCasConfig({
        ...DEVELOPMENT_ENVIRONMENT,
        CONTENT_STORAGE_PATH: STORAGE_ROOT,
        WOKESOCIAL_LOCAL_CAS_MODE: 'production',
        WOKESOCIAL_LOCAL_CAS_ORIGIN: 'http://localhost:3000',
      }),
    ).toThrow(LocalCasConfigurationError);
  });

  it('accepts only an exact loopback HTTP origin and absolute shared path', () => {
    expect(
      readLocalCasConfig({
        ...DEVELOPMENT_ENVIRONMENT,
        CONTENT_STORAGE_PATH: STORAGE_ROOT,
        WOKESOCIAL_LOCAL_CAS_MODE: 'localnet',
        WOKESOCIAL_LOCAL_CAS_ORIGIN: 'http://localhost:3000',
      }),
    ).toEqual({
      allowedOrigin: 'http://localhost:3000',
      maximumObjectBytes: LOCAL_CAS_DEFAULT_MAXIMUM_BYTES,
      rootDirectory: STORAGE_ROOT,
    });

    expect(
      readLocalCasConfig({
        ...DEVELOPMENT_ENVIRONMENT,
        CONTENT_STORAGE_PATH: STORAGE_ROOT,
        WOKESOCIAL_LOCAL_CAS_MAX_BYTES: '4096',
        WOKESOCIAL_LOCAL_CAS_MODE: 'localnet',
        WOKESOCIAL_LOCAL_CAS_ORIGIN: 'http://[::1]:3000',
      }),
    ).toMatchObject({
      allowedOrigin: 'http://[::1]:3000',
      maximumObjectBytes: 4096,
    });
  });

  it.each([
    'https://localhost:3000',
    'http://localhost:3000/path',
    'http://localhost:3000/',
    'http://127.0.0.2:3000',
    'http://remote.example:3000',
  ])('rejects a non-exact or non-loopback origin: %s', (origin) => {
    expect(() =>
      readLocalCasConfig({
        ...DEVELOPMENT_ENVIRONMENT,
        CONTENT_STORAGE_PATH: STORAGE_ROOT,
        WOKESOCIAL_LOCAL_CAS_MODE: 'localnet',
        WOKESOCIAL_LOCAL_CAS_ORIGIN: origin,
      }),
    ).toThrow(/exact loopback HTTP origin/u);
  });

  it('rejects relative and filesystem-root storage paths', () => {
    for (const rootDirectory of ['.local/content', parse(STORAGE_ROOT).root]) {
      expect(() =>
        readLocalCasConfig({
          ...DEVELOPMENT_ENVIRONMENT,
          CONTENT_STORAGE_PATH: rootDirectory,
          WOKESOCIAL_LOCAL_CAS_MODE: 'localnet',
          WOKESOCIAL_LOCAL_CAS_ORIGIN: 'http://localhost:3000',
        }),
      ).toThrow(LocalCasConfigurationError);
    }
  });

  it('fails closed for remote deployment markers and unsafe size limits', () => {
    for (const environment of [
      { APP_ENV: 'production' },
      { APP_ENV: 'staging' },
      { NODE_ENV: 'production' },
      { VERCEL_ENV: 'preview' },
      { WOKESOCIAL_LOCAL_CAS_MAX_BYTES: '1000001' },
      { WOKESOCIAL_LOCAL_CAS_MAX_BYTES: '1e3' },
    ]) {
      expect(() =>
        readLocalCasConfig({
          ...DEVELOPMENT_ENVIRONMENT,
          CONTENT_STORAGE_PATH: STORAGE_ROOT,
          WOKESOCIAL_LOCAL_CAS_MODE: 'localnet',
          WOKESOCIAL_LOCAL_CAS_ORIGIN: 'http://localhost:3000',
          ...environment,
        }),
      ).toThrow(LocalCasConfigurationError);
    }
  });
});
