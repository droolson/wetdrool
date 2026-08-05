/**
 * Shared helpers for apps/web product API routes (/api/v1/*).
 * Fail-closed defaults; never invent mint or earnings claims.
 */

import { tryResolveAuthServiceConfig } from './auth/auth-service-config';
import { getMarketplaceStoreKind } from './marketplace-store';
import { getMarketplaceGateMode } from './marketplace-unlock';
import { buildRevenueReadiness } from './revenue-readiness';
import { getRoomStoreMeta } from './room-store';

/** Stable product API surface ids (paths under /api/v1). Deduped, honest. */
export const PRODUCT_API_SURFACES = [
  { id: 'health', path: '/api/v1/health', methods: ['GET'] as const },
  { id: 'status', path: '/api/v1/status', methods: ['GET'] as const },
  { id: 'auth/status', path: '/api/v1/auth/status', methods: ['GET'] as const },
  { id: 'shorts', path: '/api/v1/shorts', methods: ['GET'] as const },
  { id: 'live', path: '/api/v1/live', methods: ['GET'] as const },
  { id: 'creators', path: '/api/v1/creators', methods: ['GET'] as const },
  { id: 'creators/:handle', path: '/api/v1/creators/:handle', methods: ['GET'] as const },
  { id: 'fame', path: '/api/v1/fame', methods: ['GET'] as const },
  { id: 'token', path: '/api/v1/token', methods: ['GET'] as const },
  { id: 'market', path: '/api/v1/market', methods: ['GET', 'POST'] as const },
  { id: 'market/:id', path: '/api/v1/market/:id', methods: ['GET', 'POST'] as const },
  { id: 'rooms', path: '/api/v1/rooms', methods: ['GET'] as const },
  { id: 'rooms/:roomId/messages', path: '/api/v1/rooms/:roomId/messages', methods: ['GET', 'POST'] as const },
  { id: 'e2ee', path: '/api/v1/e2ee', methods: ['GET'] as const },
  { id: 'policy/age', path: '/api/v1/policy/age', methods: ['GET'] as const },
  { id: 'notifications', path: '/api/v1/notifications', methods: ['GET'] as const },
  { id: 'mesh', path: '/api/v1/mesh', methods: ['GET'] as const },
  { id: 'search', path: '/api/v1/search', methods: ['GET'] as const },
  { id: 'ai/chat', path: '/api/v1/ai/chat', methods: ['POST'] as const },
] as const;

export type ProductApiSurfaceId = (typeof PRODUCT_API_SURFACES)[number]['id'];

/** Explicit honesty flags shared by health/status (no invented mint or earnings). */
export const PRODUCT_HONEST_FLAGS = {
  droolMint: 'does-not-exist' as const,
  droolMintInvented: false as const,
  earningClaimed: false as const,
  pointsAreNotToken: true as const,
  solIsNotDrool: true as const,
  /** $DROOL label is forbidden; SOL/lamports are never product currency names. */
  droolTickerForbidden: true as const,
};

/**
 * Shorts / live / creator catalog source for product discovery APIs.
 * Local ranking uses in-repo fixtures only until licensed media + external catalog ship.
 */
export type DiscoveryCatalogMode = 'local-synthetic' | 'external';

/**
 * Honest feed-service / personalization flags.
 * Product routes do not invent ranking from an unconfigured or unwired feed-service.
 */
export interface FeedPersonalizationHonesty {
  /** True only when NEXT_PUBLIC_FEED_SERVICE_URL is a non-empty absolute URL. */
  readonly configured: boolean;
  /** Origin of the feed URL when configured; never a fabricated host. */
  readonly origin: string | null;
  /**
   * True only when product discovery actually calls feed-service for ranking.
   * Today product shorts/explore use local synthetic ranking → always false.
   */
  readonly personalizationActive: false;
  readonly note: string;
}

export interface DiscoveryProviderHonesty {
  readonly shorts: {
    readonly catalogMode: DiscoveryCatalogMode;
    readonly syntheticFixturesOnly: boolean;
    readonly ranking: 'local-droolrank-lite' | 'feed-service';
    readonly note: string;
  };
  readonly live: {
    readonly catalogMode: DiscoveryCatalogMode;
    readonly syntheticFixturesOnly: boolean;
    readonly note: string;
  };
  readonly creators: {
    readonly catalogMode: DiscoveryCatalogMode;
    readonly syntheticFixturesOnly: boolean;
    readonly note: string;
  };
  readonly feedService: FeedPersonalizationHonesty;
}

function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1';
}

/**
 * Resolve feed-service URL honesty from raw env (no network probe).
 * Empty / missing / invalid → configured: false (honest empty personalization).
 */
export function resolveFeedPersonalizationHonesty(
  env: Readonly<Record<string, string | undefined>> = process.env,
): FeedPersonalizationHonesty {
  const raw = env.NEXT_PUBLIC_FEED_SERVICE_URL?.trim() ?? '';
  if (!raw) {
    return {
      configured: false,
      origin: null,
      personalizationActive: false,
      note: 'Feed-service URL unset — personalization is empty, not faked from local ranking.',
    };
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        configured: false,
        origin: null,
        personalizationActive: false,
        note: 'Feed-service URL protocol invalid — personalization stays unconfigured.',
      };
    }
    return {
      configured: true,
      origin: url.origin,
      personalizationActive: false,
      note: isLoopbackHostname(url.hostname)
        ? 'Feed-service URL is set (loopback) but product discovery does not call it yet — ranking stays local synthetic.'
        : 'Feed-service URL is set but product discovery does not call it yet — ranking stays local synthetic.',
    };
  } catch {
    return {
      configured: false,
      origin: null,
      personalizationActive: false,
      note: 'Feed-service URL malformed — personalization stays unconfigured.',
    };
  }
}

/**
 * Discovery provider honesty for health/status (local flags only, no probes).
 * Catalogs are local-synthetic fixtures; feed personalization is never invented.
 */
export function buildDiscoveryProviderHonesty(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DiscoveryProviderHonesty {
  const feedService = resolveFeedPersonalizationHonesty(env);
  return {
    shorts: {
      catalogMode: 'local-synthetic',
      syntheticFixturesOnly: true,
      ranking: 'local-droolrank-lite',
      note: 'Shorts API ranks in-repo synthetic fixtures only — not an external media catalog.',
    },
    live: {
      catalogMode: 'local-synthetic',
      syntheticFixturesOnly: true,
      note: 'Live rooms API serves synthetic fixtures only — not a live mesh directory.',
    },
    creators: {
      catalogMode: 'local-synthetic',
      syntheticFixturesOnly: true,
      note: 'Creator directory is synthetic catalog placeholders until signed portable profiles ship.',
    },
    feedService,
  };
}

export function listProductApiSurfaceIds(): readonly ProductApiSurfaceId[] {
  return PRODUCT_API_SURFACES.map((s) => s.id);
}

export function jsonOk(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(JSON.stringify(data), { ...init, status: init.status ?? 200, headers });
}

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>,
  init: ResponseInit = {},
): Response {
  return jsonOk(
    {
      ok: false,
      error: { code, message, ...extra },
    },
    { ...init, status },
  );
}

/**
 * Standard 405 with Allow header. Prefer this over ad-hoc jsonError for method guards.
 */
export function methodNotAllowed(
  allow: string | readonly string[],
  message = 'Method not allowed.',
): Response {
  const allowValue = (Array.isArray(allow) ? allow : [allow]).join(', ');
  return jsonError(
    405,
    'method_not_allowed',
    message,
    { allow: allowValue.split(', ').filter(Boolean) },
    { headers: { Allow: allowValue } },
  );
}

export function parseLimit(raw: string | null, fallback = 24, max = 48): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

export function parseOffset(raw: string | null, fallback = 0, max = 10_000): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), max);
}

/** Extract message from product API error JSON (client + tests). */
export function readProductApiErrorMessage(body: unknown, fallback: string): string {
  if (
    body &&
    typeof body === 'object' &&
    'error' in body &&
    body.error &&
    typeof body.error === 'object' &&
    'message' in body.error &&
    typeof (body.error as { message: unknown }).message === 'string'
  ) {
    return (body.error as { message: string }).message;
  }
  return fallback;
}

/**
 * Payload for GET /api/v1/health — local flags only (no auth network probe).
 */
export function buildProductHealthReport(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const revenue = buildRevenueReadiness(env);
  const marketStore = getMarketplaceStoreKind(env);
  const marketGate = getMarketplaceGateMode(env);
  const rooms = getRoomStoreMeta(env);
  const auth = tryResolveAuthServiceConfig(env);
  const discovery = buildDiscoveryProviderHonesty(env);

  return {
    ok: true as const,
    service: '@wetdrool/web' as const,
    product: 'wetdrool' as const,
    surfaces: listProductApiSurfaceIds(),
    surfaceCatalog: PRODUCT_API_SURFACES.map((s) => ({
      id: s.id,
      path: s.path,
      methods: s.methods,
    })),
    links: {
      authStatus: '/api/v1/auth/status' as const,
      readiness: '/api/v1/status' as const,
      creatorsDirectory: '/api/v1/creators' as const,
      agePolicy: '/api/v1/policy/age' as const,
      token: '/api/v1/token' as const,
      e2ee: '/api/v1/e2ee' as const,
      notifications: '/api/v1/notifications' as const,
    },
    media: 'synthetic-fixtures' as const,
    mesh: false as const,
    /** Discovery providers: catalog mode + feed personalization honesty. */
    discovery,
    stores: {
      marketplace: {
        kind: marketStore,
        gate: marketGate,
        /** file-local = single-node JSON durability; memory = process-local only. */
        durableAcrossRestart: marketStore === 'file-local',
        multiReplicaSafe: false as const,
      },
      rooms: {
        kind: rooms.kind,
        /** file-local when WETDROOL_ROOMS_DATA_PATH set; else memory-ephemeral. */
        durableAcrossRestart: rooms.durableAcrossRestart,
        multiReplicaSafe: rooms.multiReplicaSafe,
      },
    },
    auth: {
      configured: auth.ok,
      loopback: auth.ok ? auth.config.loopback : false,
      source: auth.ok ? auth.config.source : null,
      probePath: '/api/v1/auth/status' as const,
      protocolIdentityEstablished: false as const,
    },
    marketplace: {
      path: '/market' as const,
      unlock: 'x402_solana_rpc_verify' as const,
      ageGate: 'self_attest_18' as const,
      rpcConfigured: revenue.checks.rpcConfigured,
    },
    revenueReady: revenue.revenueReady,
    readinessLevel: revenue.level,
    honest: {
      ...PRODUCT_HONEST_FLAGS,
      revenueReady: false as const,
      feedPersonalizationActive: false as const,
      shortsCatalogExternal: false as const,
    },
    droolMint: PRODUCT_HONEST_FLAGS.droolMint,
    earningClaimed: PRODUCT_HONEST_FLAGS.earningClaimed,
  };
}

/**
 * Payload for GET /api/v1/status — readiness + aggregated store/auth flags.
 */
export function buildProductStatusReport(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const revenue = buildRevenueReadiness(env);
  const rooms = getRoomStoreMeta(env);
  const auth = tryResolveAuthServiceConfig(env);
  const discovery = buildDiscoveryProviderHonesty(env);

  return {
    ...revenue,
    discovery,
    stores: {
      marketplace: {
        kind: revenue.checks.marketplaceStore,
        gate: revenue.checks.marketplaceGate,
        /** file-local = single-node JSON durability; memory = process-local only. */
        durableAcrossRestart: revenue.checks.marketplaceStore === 'file-local',
        multiReplicaSafe: false as const,
        listings: revenue.checks.marketplaceListings,
      },
      rooms: {
        kind: rooms.kind,
        /** file-local when WETDROOL_ROOMS_DATA_PATH set; else memory-ephemeral. */
        durableAcrossRestart: rooms.durableAcrossRestart,
        multiReplicaSafe: rooms.multiReplicaSafe,
        maxMessagesPerRoom: rooms.maxMessagesPerRoom,
      },
    },
    auth: {
      configured: auth.ok,
      loopback: auth.ok ? auth.config.loopback : false,
      source: auth.ok ? auth.config.source : null,
      origin: auth.ok ? auth.config.origin : null,
      probePath: '/api/v1/auth/status' as const,
      protocolIdentityEstablished: false as const,
    },
    honest: {
      ...PRODUCT_HONEST_FLAGS,
      revenueReady: revenue.revenueReady,
      founderMediaPath: revenue.checks.founderMediaPath,
      feedPersonalizationActive: false as const,
      shortsCatalogExternal: false as const,
    },
  };
}

/**
 * Honest empty notifications inbox — never invents social-graph or push events.
 * Pagination/filter are accepted and echoed; total stays 0 until auth+relay+preferences wire.
 */
export type NotificationsFilter = 'mentions' | 'communities' | 'system';

export function buildEmptyNotificationsInbox(options?: {
  readonly limit?: number;
  readonly offset?: number;
  readonly filter?: NotificationsFilter | null;
}) {
  const limit = options?.limit ?? 24;
  const offset = options?.offset ?? 0;
  const filter = options?.filter ?? null;
  return {
    ok: true as const,
    items: [] as const,
    count: 0 as const,
    total: 0 as const,
    limit,
    offset,
    hasMore: false as const,
    filter,
    configured: false as const,
    delivery: 'none' as const,
    unread: 0 as const,
    protocolHistoryReconstructable: true as const,
    inventedSignals: false as const,
    pushLive: false as const,
    inAppLive: false as const,
    note: 'Notification inbox is unconfigured: no authenticated session, no relay subscription, and no push channel. Empty is honest — not a silent “all clear” from a live graph. Push and in-app notifications are not live until auth, relay, and preferences wire.',
  };
}
