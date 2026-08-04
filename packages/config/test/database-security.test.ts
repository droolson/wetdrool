import { describe, expect, it } from 'vitest';

import {
  assertNodeTlsVerificationPolicy,
  assertPostgresTlsPolicy,
} from '../src/database-security.ts';

describe('production PostgreSQL TLS policy', () => {
  it.each([
    'postgresql://application:secret@db.wetdrool.com/wetdrool?sslmode=verify-full',
    'postgres://application:secret@db.wetdrool.com:5432/wetdrool?application_name=wetdrool&sslmode=verify-full',
  ])('accepts a remote production URL with one exact verify-full mode: %s', (databaseUrl) => {
    expect(() =>
      assertPostgresTlsPolicy(databaseUrl, {
        tlsRequired: true,
        variableName: 'DATABASE_URL',
      }),
    ).not.toThrow();
  });

  it.each([
    'postgresql://application:secret@db.wetdrool.com/wetdrool',
    'postgresql://application:secret@db.wetdrool.com/wetdrool?sslmode=disable',
    'postgresql://application:secret@db.wetdrool.com/wetdrool?sslmode=prefer',
    'postgresql://application:secret@db.wetdrool.com/wetdrool?sslmode=require',
    'postgresql://application:secret@db.wetdrool.com/wetdrool?sslmode=verify-ca',
    'postgresql://application:secret@db.wetdrool.com/wetdrool?sslmode=VERIFY-FULL',
    'postgresql://application:secret@db.wetdrool.com/wetdrool?sslmode=verify-full&sslmode=require',
    'postgresql://application:secret@db.wetdrool.com/wetdrool?sslmode=verify-full&sslmode=verify-full',
    'postgresql://application:secret@127.0.0.1:5432/wetdrool',
    'postgresql://application:secret@localhost/wetdrool',
    'postgresql://application:secret@[::1]/wetdrool',
  ])('rejects a TLS-required URL without one unambiguous verify-full mode: %s', (databaseUrl) => {
    expect(() =>
      assertPostgresTlsPolicy(databaseUrl, {
        tlsRequired: true,
        variableName: 'DATABASE_URL',
      }),
    ).toThrow(/exactly one sslmode=verify-full/u);
  });

  it.each([
    'postgresql://application:secret@127.0.0.1:5432/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@[::1]/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@[::ffff:7f00:1]/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@10.42.0.10/wetdrool?sslmode=verify-full',
  ])('rejects unverifiable IP-literal hostnames in TLS-required mode: %s', (databaseUrl) => {
    expect(() =>
      assertPostgresTlsPolicy(databaseUrl, {
        tlsRequired: true,
        variableName: 'DATABASE_URL',
      }),
    ).toThrow(/must use a DNS hostname/u);
  });

  it.each([
    'postgresql://application:secret@127.0.0.1,db.wetdrool.com/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@db.wetdrool.com,127.0.0.1/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@127.0.0.1%2Cdb.wetdrool.com/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@db.wetdrool.com%2C127.0.0.1/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@db.wetdrool.com%3A5432%2C127.0.0.1%3A5432/wetdrool?sslmode=verify-full',
  ])('rejects PostgreSQL multi-host failover URLs in TLS-required mode: %s', (databaseUrl) => {
    expect(() =>
      assertPostgresTlsPolicy(databaseUrl, {
        tlsRequired: true,
        variableName: 'DATABASE_URL',
      }),
    ).toThrow(/exactly one DNS hostname/u);
  });

  it.each([
    'postgresql://application:secret@localhost/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@database.localhost/wetdrool?sslmode=verify-full',
    'postgresql://application:secret@LOCALHOST./wetdrool?sslmode=verify-full',
  ])('rejects local DNS hostnames in TLS-required mode: %s', (databaseUrl) => {
    expect(() =>
      assertPostgresTlsPolicy(databaseUrl, {
        tlsRequired: true,
        variableName: 'DATABASE_URL',
      }),
    ).toThrow(/must use a non-local DNS hostname/u);
  });

  it.each(['postgresql:///wetdrool?sslmode=verify-full', 'postgresql://?sslmode=verify-full'])(
    'rejects an empty host that could fall back to ambient PGHOST: %s',
    (databaseUrl) => {
      expect(() =>
        assertPostgresTlsPolicy(databaseUrl, {
          tlsRequired: true,
          variableName: 'DATABASE_URL',
        }),
      ).toThrow(/explicit non-local DNS hostname/u);
    },
  );

  it.each([
    'postgresql://db.wetdrool.com/wetdrool?sslmode=verify-full',
    'postgresql://application@db.wetdrool.com?sslmode=verify-full',
    'postgresql://application@db.wetdrool.com/?sslmode=verify-full',
  ])(
    'rejects an incomplete URL that could inherit an ambient role or database: %s',
    (databaseUrl) => {
      expect(() =>
        assertPostgresTlsPolicy(databaseUrl, {
          tlsRequired: true,
          variableName: 'DATABASE_URL',
        }),
      ).toThrow(/explicit database (?:role|name)/u);
    },
  );

  it.each([
    'postgresql://wetdrool:local-development-only@127.0.0.1:5432/wetdrool',
    'postgresql://wetdrool:local-development-only@localhost/wetdrool',
    'postgresql://wetdrool:local-development-only@[::1]/wetdrool',
  ])('keeps an explicit development or test loopback URL valid: %s', (databaseUrl) => {
    expect(() =>
      assertPostgresTlsPolicy(databaseUrl, {
        tlsRequired: false,
        variableName: 'DATABASE_URL',
      }),
    ).not.toThrow();
  });

  it('does not disclose database credentials when rejecting transport policy', () => {
    const credential = 'do-not-print-this-database-secret';

    expect(() =>
      assertPostgresTlsPolicy(`postgresql://application:${credential}@db.example/app`, {
        tlsRequired: true,
        variableName: 'DATABASE_URL',
      }),
    ).toThrowError(expect.not.stringContaining(credential));
  });

  it('rejects the process-wide Node TLS bypass only when TLS is required', () => {
    expect(() =>
      assertNodeTlsVerificationPolicy('0', {
        tlsRequired: true,
      }),
    ).toThrow(/NODE_TLS_REJECT_UNAUTHORIZED must not be 0/u);
    expect(() =>
      assertNodeTlsVerificationPolicy('0', {
        tlsRequired: false,
      }),
    ).not.toThrow();
  });
});
