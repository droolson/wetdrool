/**
 * Resolve and probe the replaceable authentication service for the web app.
 * Fail-closed on legacy hosts and invalid origins. Never invents "online".
 */

const LEGACY_REDIRECT_HOSTS = new Set(['droolhouse.com', 'www.droolhouse.com']);

export type AuthServiceReachability =
  | 'unconfigured'
  | 'invalid_origin'
  | 'unreachable'
  | 'degraded'
  | 'ready';

export interface AuthServiceConfig {
  /** Origin without trailing slash, e.g. http://localhost:4300 */
  readonly origin: string;
  readonly source:
    | 'WETDROOL_AUTH_URL'
    | 'NEXT_PUBLIC_AUTH_SERVICE_URL'
    | 'WOKESOCIAL_AUTH_URL'
    | 'default-localhost';
  readonly loopback: boolean;
}

export interface AuthServiceStatusReport {
  readonly ok: true;
  readonly product: 'wetdrool';
  readonly checkedAt: string;
  readonly configured: boolean;
  readonly origin: string | null;
  readonly source: AuthServiceConfig['source'] | null;
  readonly loopback: boolean;
  readonly reachability: AuthServiceReachability;
  readonly healthz: boolean | null;
  readonly readyz: boolean | null;
  readonly note: string;
  /** Protocol identity is never established by auth-service alone. */
  readonly protocolIdentityEstablished: false;
  readonly webAuthnOrigin: 'wetdrool.com' | 'local-dev' | 'unknown';
}

/**
 * Human label for status UI. Never maps ready → "online" — health probes are
 * not a claim that the product network or protocol identity is live.
 */
export function reachabilityLabel(reachability: AuthServiceReachability): string {
  switch (reachability) {
    case 'ready':
      return 'Passkey service ready';
    case 'degraded':
      return 'Degraded — not ready';
    case 'unreachable':
      return 'Unreachable';
    case 'invalid_origin':
      return 'Invalid origin';
    case 'unconfigured':
      return 'Unconfigured';
  }
}

/** Short operator-facing explanation of probe bits. */
export function reachabilityDetail(report: AuthServiceStatusReport): string {
  switch (report.reachability) {
    case 'ready':
      return 'healthz and readyz both succeeded for the configured origin.';
    case 'degraded':
      return 'Process answered healthz, but readyz failed (store, rate-limit, or readiness gate).';
    case 'unreachable':
      return 'Neither healthz nor readyz returned a successful response.';
    case 'invalid_origin':
      return 'Configured URL failed origin validation (legacy hosts and non-loopback http are rejected).';
    case 'unconfigured':
      return 'No authentication service origin is configured.';
  }
}

/** Whether passkey registration/sign-in should be presented as available. */
export function passkeyCeremoniesAllowed(reachability: AuthServiceReachability): boolean {
  return reachability === 'ready';
}

function normalizeDnsHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, '');
}

function isLoopbackHost(hostname: string): boolean {
  const h = normalizeDnsHostname(hostname);
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * Validate auth service base URL (https or loopback http). Rejects legacy
 * redirect hosts and paths/query/userinfo.
 */
export function parseAuthServiceOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error('invalid_auth_origin');
  }
  const hostname = normalizeDnsHostname(url.hostname);
  const local = isLoopbackHost(hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    LEGACY_REDIRECT_HOSTS.has(hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error('invalid_auth_origin');
  }
  return url.origin;
}

export function resolveAuthServiceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): AuthServiceConfig {
  const candidates: readonly {
    readonly key: AuthServiceConfig['source'];
    readonly value: string | undefined;
  }[] = [
    { key: 'WETDROOL_AUTH_URL', value: env.WETDROOL_AUTH_URL },
    { key: 'NEXT_PUBLIC_AUTH_SERVICE_URL', value: env.NEXT_PUBLIC_AUTH_SERVICE_URL },
    { key: 'WOKESOCIAL_AUTH_URL', value: env.WOKESOCIAL_AUTH_URL },
  ];

  for (const c of candidates) {
    const raw = c.value?.trim();
    if (!raw) continue;
    const origin = parseAuthServiceOrigin(raw);
    return {
      origin,
      source: c.key,
      loopback: isLoopbackHost(new URL(origin).hostname),
    };
  }

  const origin = parseAuthServiceOrigin('http://localhost:4300');
  return {
    origin,
    source: 'default-localhost',
    loopback: true,
  };
}

/** Prefer for Server Components / API routes (never throws). */
export function tryResolveAuthServiceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): { readonly ok: true; readonly config: AuthServiceConfig } | { readonly ok: false; readonly reason: string } {
  try {
    return { ok: true, config: resolveAuthServiceConfig(env) };
  } catch {
    return { ok: false, reason: 'invalid_auth_origin' };
  }
}

async function probeJsonOk(
  origin: string,
  path: '/healthz' | '/readyz',
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${origin}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) return false;
    const body: unknown = await res.json().catch(() => null);
    if (!body || typeof body !== 'object') return res.ok;
    if ('ok' in body && (body as { ok: unknown }).ok === false) return false;
    return true;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function probeAuthServiceStatus(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
  } = {},
): Promise<AuthServiceStatusReport> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 2_500;
  const checkedAt = new Date().toISOString();

  const resolved = tryResolveAuthServiceConfig(env);
  if (!resolved.ok) {
    return {
      ok: true,
      product: 'wetdrool',
      checkedAt,
      configured: false,
      origin: null,
      source: null,
      loopback: false,
      reachability: 'invalid_origin',
      healthz: null,
      readyz: null,
      note: 'Auth service URL is invalid or uses a forbidden host (legacy redirect hosts are never WebAuthn origins).',
      protocolIdentityEstablished: false,
      webAuthnOrigin: 'unknown',
    };
  }

  const { config } = resolved;
  const healthz = await probeJsonOk(config.origin, '/healthz', fetchImpl, timeoutMs);
  const readyz = await probeJsonOk(config.origin, '/readyz', fetchImpl, timeoutMs);

  let reachability: AuthServiceReachability;
  if (healthz === null && readyz === null) {
    reachability = 'unreachable';
  } else if (healthz === true && readyz === true) {
    reachability = 'ready';
  } else if (healthz === true) {
    reachability = 'degraded';
  } else {
    reachability = 'unreachable';
  }

  const note =
    reachability === 'ready'
      ? 'Auth service healthz and readyz succeeded. Passkey ceremonies may proceed when this browser origin matches the relying-party config. This is not a claim that protocol identity or the public network is online.'
      : reachability === 'degraded'
        ? 'Auth service answered healthz but is not ready (store, migrations, or rate-limit). Fail closed: do not treat registration or sign-in as available until readyz is ok. Retry after the service finishes starting.'
        : reachability === 'unreachable'
          ? `Cannot reach ${config.origin}. Start auth-service locally (port 4300) or set WETDROOL_AUTH_URL / NEXT_PUBLIC_AUTH_SERVICE_URL to a valid origin. Status is unreachable — not “offline product,” just an unanswered probe.`
          : 'Auth service status unknown.';

  return {
    ok: true,
    product: 'wetdrool',
    checkedAt,
    configured: config.source !== 'default-localhost',
    origin: config.origin,
    source: config.source,
    loopback: config.loopback,
    reachability,
    healthz,
    readyz,
    note,
    protocolIdentityEstablished: false,
    webAuthnOrigin: config.loopback ? 'local-dev' : 'wetdrool.com',
  };
}
