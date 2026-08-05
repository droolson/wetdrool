import { tryResolveAuthServiceConfig } from '@/lib/auth/auth-service-config';
import { methodNotAllowed, jsonOk, PRODUCT_HONEST_FLAGS } from '@/lib/product-api';
import { buildRevenueReadiness } from '@/lib/revenue-readiness';
import { getRoomStoreMeta } from '@/lib/room-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Honest production/revenue readiness. Never invent earnings or a $DROOL mint.
 * Aggregates marketplace + room store + auth config flags (auth network probe is separate).
 * GET /api/v1/status
 */
export function GET(): Response {
  const revenue = buildRevenueReadiness();
  const rooms = getRoomStoreMeta();
  const auth = tryResolveAuthServiceConfig();

  return jsonOk({
    ...revenue,
    stores: {
      marketplace: {
        kind: revenue.checks.marketplaceStore,
        gate: revenue.checks.marketplaceGate,
        durableAcrossRestart: revenue.checks.marketplaceStore === 'file-local',
        multiReplicaSafe: false,
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
      probePath: '/api/v1/auth/status',
      protocolIdentityEstablished: false as const,
    },
    honest: {
      ...PRODUCT_HONEST_FLAGS,
      revenueReady: revenue.revenueReady,
      founderMediaPath: revenue.checks.founderMediaPath,
    },
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for readiness status.');
}
