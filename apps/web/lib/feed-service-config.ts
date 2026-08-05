/**
 * Feed-service URL resolution + optional healthz probe (config honesty only).
 *
 * Does **not** call feed-service for ranking or invent for-you personalization.
 * Product discovery keeps local DroolRank-lite until a ranked provider is wired
 * fail-closed with explicit labels.
 */

export type FeedServiceWiring =
  | 'unconfigured'
  | 'invalid'
  | 'configured-unwired'
  | 'reachable'
  | 'unreachable'
  | 'degraded';

export interface FeedServiceConfig {
  /** True when NEXT_PUBLIC_FEED_SERVICE_URL is a non-empty absolute http(s) URL. */
  readonly configured: boolean;
  /** Origin only (scheme + host + port) — never path/query secrets. */
  readonly origin: string | null;
  readonly loopback: boolean;
  readonly source: 'NEXT_PUBLIC_FEED_SERVICE_URL' | null;
  readonly wiring: Extract<FeedServiceWiring, 'unconfigured' | 'invalid' | 'configured-unwired'>;
  readonly note: string;
}

/**
 * Server-side probe report. personalizationActive is always false until product
 * discovery actually consumes feed-service ranking (not implemented).
 */
export interface FeedServiceProbeReport {
  readonly ok: true;
  readonly checkedAt: string;
  readonly configured: boolean;
  readonly origin: string | null;
  readonly loopback: boolean;
  readonly source: FeedServiceConfig['source'];
  readonly wiring: FeedServiceWiring;
  /** Result of GET {origin}/healthz when probed; null when skipped or unconfigured. */
  readonly healthz: boolean | null;
  /** Always false — ranking stays local; never invent for-you. */
  readonly personalizationActive: false;
  readonly rankingSource: 'local-droolrank-lite';
  readonly note: string;
}

function normalizeDnsHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/u, '');
}

export function isFeedServiceLoopbackHostname(hostname: string): boolean {
  const h = normalizeDnsHostname(hostname);
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * Pure resolve of NEXT_PUBLIC_FEED_SERVICE_URL (no network).
 * Missing / empty / invalid → unconfigured or invalid (both fail closed).
 */
export function resolveFeedServiceConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FeedServiceConfig {
  const raw = env.NEXT_PUBLIC_FEED_SERVICE_URL?.trim() ?? '';
  if (!raw) {
    return {
      configured: false,
      origin: null,
      loopback: false,
      source: null,
      wiring: 'unconfigured',
      note: 'Feed-service URL unset — personalization is empty, not faked from local ranking.',
    };
  }

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        configured: false,
        origin: null,
        loopback: false,
        source: null,
        wiring: 'invalid',
        note: 'Feed-service URL protocol invalid — personalization stays unconfigured.',
      };
    }

    const loopback = isFeedServiceLoopbackHostname(url.hostname);
    // Origin only — strip path, query, userinfo so UI never shows path secrets.
    const origin = url.origin;

    return {
      configured: true,
      origin,
      loopback,
      source: 'NEXT_PUBLIC_FEED_SERVICE_URL',
      wiring: 'configured-unwired',
      note: loopback
        ? 'Feed-service URL is set (loopback). Product discovery does not use it for ranking yet — local DroolRank-lite only.'
        : 'Feed-service URL is set. Non-loopback hosts are not probed unless explicitly allowed; ranking stays local synthetic.',
    };
  } catch {
    return {
      configured: false,
      origin: null,
      loopback: false,
      source: null,
      wiring: 'invalid',
      note: 'Feed-service URL malformed — personalization stays unconfigured.',
    };
  }
}

/**
 * Whether a network healthz probe is allowed.
 * Loopback always; non-loopback only with explicit option or env gate.
 */
export function shouldProbeFeedService(
  config: FeedServiceConfig,
  options: {
    readonly explicit?: boolean;
    readonly env?: Readonly<Record<string, string | undefined>>;
  } = {},
): boolean {
  if (!config.configured || !config.origin) return false;
  if (config.loopback) return true;
  if (options.explicit === true) return true;
  const env = options.env ?? process.env;
  const flag = env.WETDROOL_FEED_SERVICE_PROBE?.trim().toLowerCase() ?? '';
  return flag === '1' || flag === 'true' || flag === 'yes';
}

async function probeHealthz(
  origin: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<boolean | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${origin}/healthz`, {
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

/**
 * Optional healthz probe only. Never ranks, never fans out content.
 * Non-loopback without explicit allow → configured-unwired (no network).
 */
export async function probeFeedServiceConfig(
  options: {
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly fetchImpl?: typeof fetch;
    readonly timeoutMs?: number;
    /** Force probe even for non-loopback (server operators / tests). */
    readonly explicit?: boolean;
  } = {},
): Promise<FeedServiceProbeReport> {
  const env = options.env ?? process.env;
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 1_500;
  const checkedAt = new Date().toISOString();
  const config = resolveFeedServiceConfig(env);

  if (!config.configured || !config.origin) {
    return {
      ok: true,
      checkedAt,
      configured: false,
      origin: null,
      loopback: false,
      source: null,
      wiring: config.wiring === 'invalid' ? 'invalid' : 'unconfigured',
      healthz: null,
      personalizationActive: false,
      rankingSource: 'local-droolrank-lite',
      note: config.note,
    };
  }

  if (!shouldProbeFeedService(config, { explicit: options.explicit, env })) {
    return {
      ok: true,
      checkedAt,
      configured: true,
      origin: config.origin,
      loopback: config.loopback,
      source: config.source,
      wiring: 'configured-unwired',
      healthz: null,
      personalizationActive: false,
      rankingSource: 'local-droolrank-lite',
      note:
        'Feed-service origin is configured but not probed (non-loopback without explicit allow). Ranking stays local DroolRank-lite; personalizationActive remains false.',
    };
  }

  const healthz = await probeHealthz(config.origin, fetchImpl, timeoutMs);
  let wiring: FeedServiceWiring;
  if (healthz === true) {
    wiring = 'reachable';
  } else if (healthz === false) {
    wiring = 'degraded';
  } else {
    wiring = 'unreachable';
  }

  const note =
    wiring === 'reachable'
      ? `Feed-service healthz ok at ${config.origin}. Ranking is still local DroolRank-lite — personalization is not active.`
      : wiring === 'degraded'
        ? `Feed-service at ${config.origin} answered healthz with failure. Ranking stays local; personalizationActive false.`
        : `Feed-service at ${config.origin} did not answer healthz. Ranking stays local DroolRank-lite; personalizationActive false.`;

  return {
    ok: true,
    checkedAt,
    configured: true,
    origin: config.origin,
    loopback: config.loopback,
    source: config.source,
    wiring,
    healthz,
    personalizationActive: false,
    rankingSource: 'local-droolrank-lite',
    note,
  };
}
