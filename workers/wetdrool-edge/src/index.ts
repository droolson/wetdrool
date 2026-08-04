/**
 * wetdrool-edge — Cloudflare Worker in front of the Vercel origin.
 *
 * Topology:
 *   wetdrool.com (Cloudflare proxy) → this Worker → Vercel (ORIGIN_URL)
 *
 * Does not store user content, age evidence, or message plaintext.
 * Mesh/any-sync peer traffic is future work; this edge only fronts HTTP.
 */

export interface Env {
  /** Full https origin on Vercel, e.g. https://wallet-alpha-dun.vercel.app */
  readonly ORIGIN_URL: string;
  /** Optional comma-separated hosts allowed to hit this worker (default: wetdrool.com,www). */
  readonly ALLOWED_HOSTS?: string;
}

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

const DEFAULT_HOSTS = ['wetdrool.com', 'www.wetdrool.com'] as const;

function allowedHosts(env: Env): readonly string[] {
  const raw = env.ALLOWED_HOSTS?.trim();
  if (!raw) return DEFAULT_HOSTS;
  return raw
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h.length > 0);
}

function resolveOrigin(env: Env): URL {
  const raw = env.ORIGIN_URL?.trim();
  if (!raw) {
    throw new Error('ORIGIN_URL is not configured');
  }
  const url = new URL(raw);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('ORIGIN_URL must be http(s)');
  }
  return url;
}

function hopByHop(): Set<string> {
  return new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'host',
    'cf-connecting-ip',
    'cf-ipcountry',
    'cf-ray',
    'cf-visitor',
    'cdn-loop',
  ]);
}

function filterRequestHeaders(source: Headers, originHost: string): Headers {
  const out = new Headers();
  const drop = hopByHop();
  for (const [key, value] of source.entries()) {
    if (drop.has(key.toLowerCase())) continue;
    out.append(key, value);
  }
  out.set('Host', originHost);
  out.set('X-Forwarded-Proto', 'https');
  out.set('X-Wetdrool-Edge', 'cloudflare-worker');
  return out;
}

function withSecurityHeaders(upstream: Headers): Headers {
  const out = new Headers(upstream);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    out.set(key, value);
  }
  out.set('X-Wetdrool-Edge', '1');
  return out;
}

function healthResponse(env: Env, request: Request): Response {
  let originConfigured = false;
  try {
    resolveOrigin(env);
    originConfigured = true;
  } catch {
    originConfigured = false;
  }
  const body = JSON.stringify(
    {
      service: 'wetdrool-edge',
      status: originConfigured ? 'ok' : 'misconfigured',
      host: new URL(request.url).host,
      originConfigured,
      mesh: 'not_on_edge',
      note: 'HTTP edge only. Anytype/any-sync mesh is client + packages/mesh, not this worker.',
    },
    null,
    2,
  );
  return new Response(body, {
    status: originConfigured ? 200 : 503,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...SECURITY_HEADERS,
      'X-Wetdrool-Edge': '1',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const incoming = new URL(request.url);
    const host = incoming.hostname.toLowerCase();

    if (incoming.pathname === '/.well-known/wetdrool-edge.json') {
      return healthResponse(env, request);
    }

    const hosts = allowedHosts(env);
    // workers.dev and localhost always allowed for staging
    const isDevHost =
      host.endsWith('.workers.dev') || host === 'localhost' || host === '127.0.0.1';
    if (!isDevHost && !hosts.includes(host)) {
      return new Response('Host not allowed on wetdrool-edge', {
        status: 421,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS },
      });
    }

    let origin: URL;
    try {
      origin = resolveOrigin(env);
    } catch {
      return new Response(
        'ORIGIN_URL misconfigured. Set wrangler var/secret to the Vercel production URL.',
        { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
      );
    }

    const target = new URL(incoming.pathname + incoming.search, origin);
    const headers = filterRequestHeaders(request.headers, origin.host);

    const init: RequestInit = {
      method: request.method,
      headers,
      redirect: 'manual',
    };

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      init.body = request.body;
      Object.assign(init, { duplex: 'half' });
    }

    const upstream = await fetch(target.toString(), init);
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: withSecurityHeaders(upstream.headers),
    });
  },
};
