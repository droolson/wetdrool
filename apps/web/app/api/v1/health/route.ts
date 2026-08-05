import { tryResolveAuthServiceConfig } from '@/lib/auth/auth-service-config';
import { getMarketplaceStoreKind } from '@/lib/marketplace-store';
import { getMarketplaceGateMode } from '@/lib/marketplace-unlock';
import {
  jsonOk,
  listProductApiSurfaceIds,
  methodNotAllowed,
  PRODUCT_API_SURFACES,
  PRODUCT_HONEST_FLAGS,
} from '@/lib/product-api';
import { buildRevenueReadiness } from '@/lib/revenue-readiness';
import { getRoomStoreMeta } from '@/lib/room-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health
 * Lightweight product surface + store/auth flags. No network probes (use /auth/status).
 * Never claims $DROOL mint or live earnings.
 */
export function GET(): Response {
  const revenue = buildRevenueReadiness();
  const marketStore = getMarketplaceStoreKind();
  const marketGate = getMarketplaceGateMode();
  const rooms = getRoomStoreMeta();
  const auth = tryResolveAuthServiceConfig();

  return jsonOk({
    ok: true,
    service: '@wetdrool/web',
    product: 'wetdrool',
    surfaces: listProductApiSurfaceIds(),
    surfaceCatalog: PRODUCT_API_SURFACES.map((s) => ({
      id: s.id,
      path: s.path,
      methods: s.methods,
    })),
    links: {
      authStatus: '/api/v1/auth/status',
      readiness: '/api/v1/status',
      creatorsDirectory: '/api/v1/creators',
      agePolicy: '/api/v1/policy/age',
      token: '/api/v1/token',
      e2ee: '/api/v1/e2ee',
    },
    media: 'synthetic-fixtures',
    mesh: false,
    stores: {
      marketplace: {
        kind: marketStore,
        gate: marketGate,
        durableAcrossRestart: marketStore === 'file-local',
        multiReplicaSafe: false,
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
      /** Full probe is /api/v1/auth/status — health stays local/fast. */
      probePath: '/api/v1/auth/status',
      protocolIdentityEstablished: false as const,
    },
    marketplace: {
      path: '/market',
      unlock: 'x402_solana_rpc_verify',
      ageGate: 'self_attest_18',
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
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for product health.');
}
