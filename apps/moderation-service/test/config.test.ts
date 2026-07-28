import { describe, expect, it } from 'vitest';

import { parseModerationConfig } from '../src/config.js';

const dataKeys = JSON.stringify({
  activeKeyId: 'v1',
  keys: { v1: Buffer.alloc(32, 7).toString('base64url') },
});

describe('moderation configuration', () => {
  it('accepts the canonical woke.social origin and a paired PostgreSQL/key-ring configuration', () => {
    const config = parseModerationConfig({
      NODE_ENV: 'production',
      MODERATION_ALLOWED_ORIGINS: 'https://woke.social',
      MODERATION_DATABASE_URL: 'postgresql://moderation:secret@db.example/moderation',
      MODERATION_DATA_KEYS: dataKeys,
    });
    expect(config.allowedOrigins).toEqual(['https://woke.social']);
    expect(config.databaseUrl).toContain('postgresql://');
    expect(config.keyRing?.activeKeyId).toBe('v1');
  });

  it.each([
    'https://sociallywoke.com',
    'https://www.sociallywoke.com',
    'https://SOCIALLYWOKE.COM.',
  ])('rejects redirect-only legacy origin %s', (origin) => {
    expect(() =>
      parseModerationConfig({
        NODE_ENV: 'production',
        MODERATION_ALLOWED_ORIGINS: origin,
      }),
    ).toThrow(/legacy redirect hostname/u);
  });

  it('forbids production unverified authorization and insecure remote origins', () => {
    expect(() =>
      parseModerationConfig({
        NODE_ENV: 'production',
        MODERATION_DANGEROUSLY_ALLOW_UNVERIFIED_LOCAL_MODE: '1',
      }),
    ).toThrow(/forbidden in production/u);
    expect(() =>
      parseModerationConfig({
        NODE_ENV: 'production',
        MODERATION_ALLOWED_ORIGINS: 'http://moderation.example',
      }),
    ).toThrow(/must use HTTPS/u);
  });

  it('requires PostgreSQL and the application data-key ring together', () => {
    expect(() =>
      parseModerationConfig({
        MODERATION_DATABASE_URL: 'postgresql://localhost/moderation',
      }),
    ).toThrow(/configured together/u);
    expect(() => parseModerationConfig({ MODERATION_DATA_KEYS: dataKeys })).toThrow(
      /configured together/u,
    );
  });

  it('normalizes origins before rejecting semantic duplicates', () => {
    expect(() =>
      parseModerationConfig({
        MODERATION_ALLOWED_ORIGINS: 'https://woke.social,https://WOKE.SOCIAL:443/',
      }),
    ).toThrow(/must be unique/u);
  });

  it('leaves production persistence unconfigured for the locked store instead of enabling memory', () => {
    const config = parseModerationConfig({ NODE_ENV: 'production' });
    expect(config.databaseUrl).toBeUndefined();
    expect(config.keyRing).toBeUndefined();
    expect(config.dangerouslyAllowUnverifiedLocalMode).toBe(false);
  });
});
