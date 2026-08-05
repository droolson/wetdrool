import { jsonOk } from '@/lib/product-api';
import { buildRevenueReadiness } from '@/lib/revenue-readiness';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const revenue = buildRevenueReadiness();
  return jsonOk({
    ok: true,
    service: '@wetdrool/web',
    product: 'wetdrool',
    surfaces: [
      'hub',
      'shorts',
      'live',
      'creators',
      'fame',
      'token',
      'social',
      'market',
      'rooms',
      'cumdump',
      'status',
    ],
    media: 'mixed-synthetic-plus-founder',
    droolMint: 'does-not-exist',
    mesh: false,
    marketplace: {
      path: '/market',
      unlock: 'x402_solana_rpc_verify',
      ageGate: 'self_attest_18',
      rpcConfigured: revenue.checks.rpcConfigured,
    },
    revenueReady: revenue.revenueReady,
    earningClaimed: false,
    readiness: '/api/v1/status',
  });
}
