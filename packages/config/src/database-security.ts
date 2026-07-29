import { isIP } from 'node:net';

import { isLocalOrUnspecifiedHostname } from './network-security.ts';

export interface PostgresTlsPolicyOptions {
  readonly tlsRequired: boolean;
  readonly variableName?: string;
}

export interface NodeTlsPolicyOptions {
  readonly tlsRequired: boolean;
}

/**
 * Enforces the PostgreSQL URL form that postgres.js maps to Node TLS with both
 * CA-chain and server-hostname verification. Callers explicitly decide whether
 * the deployment tier requires TLS; required tiers receive no hostname bypass.
 */
export function assertPostgresTlsPolicy(
  databaseUrl: string,
  options: PostgresTlsPolicyOptions,
): void {
  const variableName = options.variableName ?? 'Database URL';
  const url = new URL(databaseUrl);
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new Error(`${variableName} must use PostgreSQL.`);
  }
  if (!options.tlsRequired) {
    return;
  }

  const sslModes = url.searchParams.getAll('sslmode');
  if (sslModes.length !== 1 || sslModes[0] !== 'verify-full') {
    throw new Error(
      `${variableName} must set exactly one sslmode=verify-full when database TLS is required so the database CA and hostname are verified.`,
    );
  }
  let decodedHostname: string;
  try {
    decodedHostname = decodeURIComponent(url.hostname);
  } catch {
    throw new Error(`${variableName} must contain a valid DNS hostname.`);
  }
  if (decodedHostname === '') {
    throw new Error(
      `${variableName} must contain an explicit non-local DNS hostname when database TLS is required.`,
    );
  }
  if (decodedHostname.includes(',')) {
    throw new Error(
      `${variableName} must use exactly one DNS hostname when database TLS is required; PostgreSQL multi-host URLs are not allowed.`,
    );
  }
  const hostname = decodedHostname.replace(/^\[(.*)\]$/u, '$1');
  if (isIP(hostname) !== 0) {
    throw new Error(
      `${variableName} must use a DNS hostname when database TLS is required because the PostgreSQL driver cannot verify IP-literal hostnames.`,
    );
  }
  if (isLocalOrUnspecifiedHostname(hostname)) {
    throw new Error(
      `${variableName} must use a non-local DNS hostname when database TLS is required.`,
    );
  }
  if (url.username === '') {
    throw new Error(
      `${variableName} must contain an explicit database role when database TLS is required.`,
    );
  }
  if (url.pathname === '' || url.pathname === '/') {
    throw new Error(
      `${variableName} must contain an explicit database name when database TLS is required.`,
    );
  }
}

export function assertNodeTlsVerificationPolicy(
  nodeTlsRejectUnauthorized: string | undefined,
  options: NodeTlsPolicyOptions,
): void {
  if (options.tlsRequired && nodeTlsRejectUnauthorized === '0') {
    throw new Error(
      'NODE_TLS_REJECT_UNAUTHORIZED must not be 0 in a TLS-required environment because it disables CA and hostname verification process-wide.',
    );
  }
}
