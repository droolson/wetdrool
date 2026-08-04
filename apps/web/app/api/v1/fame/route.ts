import { FAME_SEED, fameTier } from '@/lib/hall-of-fame';
import { jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const board = FAME_SEED.map((e, i) => ({
    rank: i + 1,
    ...e,
    tier: fameTier(e.lifetimePoints),
  })).sort((a, b) => b.lifetimePoints - a.lifetimePoints)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  return jsonOk({
    ok: true,
    board,
    note: 'Seed board only. Local browser grinds merge client-side on /fame.',
  });
}
