import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  EnvironmentValidationError,
  parsePublicEnvironment,
  parseServerEnvironment,
  summarizeEnvironment,
} from '../src/env.ts';

function parseEnvironmentFile(source: string): Record<string, string> {
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const separator = line.indexOf('=');
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
}

describe('environment configuration', () => {
  it('provides safe local defaults', () => {
    const environment = parseServerEnvironment({});

    expect(environment.APP_ENV).toBe('development');
    expect(environment.INDEXER_PORT).toBe(4000);
    expect(environment.NEXT_PUBLIC_AUTH_SERVICE_URL).toBe('http://localhost:4300');
    expect(environment.NEXT_PUBLIC_FEED_SERVICE_URL).toBe('http://localhost:4100');
    expect(environment.NEXT_PUBLIC_MEDIA_WORKER_URL).toBe('http://localhost:4500');
    expect(environment.NEXT_PUBLIC_MODERATION_SERVICE_URL).toBe('http://localhost:4400');
    expect(environment.NEXT_PUBLIC_RELAY_URL).toBe('ws://localhost:4200/v1/relay');
    expect(environment.NEXT_PUBLIC_WOKENET).toBe('localnet');
    expect(environment.WOKENET_COMMITMENT).toBe('finalized');
    expect(environment.SPONSOR_ENABLED).toBe(false);
    expect(summarizeEnvironment(environment)).toMatchObject({
      rpcProviderCount: 1,
      sponsorEnabled: false,
      websocketProviderCount: 1,
    });
  });

  it('only returns public keys from the public parser', () => {
    const environment = parsePublicEnvironment({
      DATABASE_URL: 'postgresql://user:secret@example.test/database',
      NEXT_PUBLIC_APP_ORIGIN: 'https://woke.social',
    });

    expect(environment.NEXT_PUBLIC_APP_ORIGIN).toBe('https://woke.social');
    expect(environment).not.toHaveProperty('DATABASE_URL');
  });

  it('requires production identity and session configuration', () => {
    expect(() =>
      parseServerEnvironment({
        APP_ENV: 'production',
        NEXT_PUBLIC_APP_ORIGIN: 'https://woke.social',
      }),
    ).toThrowError(EnvironmentValidationError);
  });

  it('requires a signer and positive budget when sponsorship is enabled', () => {
    expect(() =>
      parseServerEnvironment({
        SPONSOR_ENABLED: 'true',
      }),
    ).toThrowError(/SPONSOR_SIGNER_URI/);
  });

  it('parses explicit provider lists and enabled sponsorship', () => {
    const environment = parseServerEnvironment({
      ALLOWED_ORIGINS: 'https://woke.social, https://app.woke.social',
      WOKENET_RPC_URLS: 'https://rpc-one.example,https://rpc-two.example',
      WOKENET_WS_URLS: 'wss://rpc-one.example,wss://rpc-two.example',
      SPONSOR_DAILY_LAMPORT_LIMIT: '1000000',
      SPONSOR_ENABLED: '1',
      SPONSOR_SIGNER_URI: 'kms://development/sponsor',
    });

    expect(environment.ALLOWED_ORIGINS).toHaveLength(2);
    expect(environment.WOKENET_RPC_URLS).toHaveLength(2);
    expect(environment.WOKENET_WS_URLS).toHaveLength(2);
    expect(environment.SPONSOR_ENABLED).toBe(true);
  });

  it('rejects malformed booleans, origins, protocols, and public RPC credentials', () => {
    expect(() => parseServerEnvironment({ SPONSOR_ENABLED: 'sometimes' })).toThrow();
    expect(() => parseServerEnvironment({ ALLOWED_ORIGINS: 'https://woke.social/path' })).toThrow(
      /origins without paths/,
    );
    expect(() => parseServerEnvironment({ DATABASE_URL: 'https://database.example' })).toThrow(
      /must use one of/,
    );
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_WOKENET_RPC_URL: 'https://user:password@rpc.example',
      }),
    ).toThrow(/must not include credentials/);
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_AUTH_SERVICE_URL: 'https://user:password@auth.example',
      }),
    ).toThrow(/must not include credentials/);
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_RELAY_URL: 'https://relay.example/v1/relay',
      }),
    ).toThrow(/must use one of/);
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_RELAY_URL: 'wss://user:password@relay.example/v1/relay',
      }),
    ).toThrow(/must not include credentials/);
  });

  it.each([
    ['NEXT_PUBLIC_APP_ORIGIN', 'https://sociallywoke.com'],
    ['NEXT_PUBLIC_AUTH_SERVICE_URL', 'https://www.sociallywoke.com'],
    ['NEXT_PUBLIC_RELAY_URL', 'wss://sociallywoke.com/v1/relay'],
  ])('rejects the redirect-only hostname for %s', (key, value) => {
    expect(() => parsePublicEnvironment({ [key]: value })).toThrow(/legacy redirect-only hostname/);
  });

  it('rejects the redirect-only hostname from server CORS origins', () => {
    expect(() =>
      parseServerEnvironment({
        ALLOWED_ORIGINS: 'https://woke.social,https://sociallywoke.com',
      }),
    ).toThrow(/legacy redirect hosts/);
  });

  it.each([
    ['NEXT_PUBLIC_SOLANA_CLUSTER', 'NEXT_PUBLIC_WOKENET'],
    ['NEXT_PUBLIC_SOLANA_RPC_URL', 'NEXT_PUBLIC_WOKENET_RPC_URL'],
    ['SOLANA_COMMITMENT', 'WOKENET_COMMITMENT'],
    ['SOLANA_RPC_URLS', 'WOKENET_RPC_URLS'],
    ['SOLANA_WS_URLS', 'WOKENET_WS_URLS'],
  ])('rejects retired %s instead of silently ignoring it', (retiredKey, replacementKey) => {
    expect(() => parseServerEnvironment({ [retiredKey]: 'retired-value' })).toThrow(
      new RegExp(`${retiredKey}.*${replacementKey}`, 's'),
    );
  });

  it('accepts a complete production configuration', () => {
    const environment = parseServerEnvironment({
      APP_ENV: 'production',
      NEXT_PUBLIC_APP_ORIGIN: 'https://woke.social',
      NEXT_PUBLIC_PROGRAM_ID: '11111111111111111111111111111111',
      NEXT_PUBLIC_WOKENET: 'public-test',
      SESSION_SECRET: 'a-production-session-secret-with-32-characters',
    });

    expect(environment.APP_ENV).toBe('production');
    expect(environment.NEXT_PUBLIC_WOKENET).toBe('public-test');
  });

  it('keeps the production WokeNet selector disabled pending activation', () => {
    expect(() =>
      parsePublicEnvironment({
        NEXT_PUBLIC_WOKENET: 'production',
      }),
    ).toThrow(/localnet.*public-test/);
  });

  it('rejects local production origins and file-based production sponsor keys', () => {
    const base = {
      APP_ENV: 'production',
      NEXT_PUBLIC_PROGRAM_ID: '11111111111111111111111111111111',
      SESSION_SECRET: 'a-production-session-secret-with-32-characters',
    } as const;

    expect(() =>
      parseServerEnvironment({
        ...base,
        NEXT_PUBLIC_APP_ORIGIN: 'http://localhost:3000',
      }),
    ).toThrow(/non-local HTTPS origin/);

    expect(() =>
      parseServerEnvironment({
        ...base,
        NEXT_PUBLIC_APP_ORIGIN: 'https://woke.social',
        SPONSOR_DAILY_LAMPORT_LIMIT: '1000',
        SPONSOR_ENABLED: 'true',
        SPONSOR_SIGNER_URI: 'file:///tmp/sponsor.json',
      }),
    ).toThrow(/file-based sponsor signers/);
  });

  it('never includes a rejected secret value in its error message', () => {
    const rejectedSecret = 'do-not-print-this';

    expect(() =>
      parseServerEnvironment({
        SESSION_SECRET: rejectedSecret,
      }),
    ).toThrowError(expect.not.stringContaining(rejectedSecret));
  });

  it('validates the checked-in local environment example', () => {
    const source = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    const environment = parseEnvironmentFile(source);

    expect(() => parseServerEnvironment(environment)).not.toThrow();
  });
});
