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
    },
    media: 'synthetic-fixtures' as const,
    mesh: false as const,
    stores: {
      marketplace: {
        kind: marketStore,
        gate: marketGate,
        durableAcrossRestart: marketStore === 'file-local',
        multiReplicaSafe: false as const,
      },
      rooms: {
        kind: rooms.kind,
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

  return {
    ...revenue,
    stores: {
      marketplace: {
        kind: revenue.checks.marketplaceStore,
        gate: revenue.checks.marketplaceGate,
        durableAcrossRestart: revenue.checks.marketplaceStore === 'file-local',
        multiReplicaSafe: false as const,
        listings: revenue.checks.marketplaceListings,
      },
      rooms: {
        kind: rooms.kind,
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
    },
  };
}
