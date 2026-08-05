import { pageFameSeed } from '@/lib/hall-of-fame';
import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/fame?limit=&offset=&q=
 * Seed leaderboard only (seedOnly). Optional q filters handle/display/badges.
 * Browser merges local grind client-side on /fame. Not a global multiplayer ledger.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const q = url.searchParams.get('q');
  const page = pageFameSeed({ limit, offset, q });

  return jsonOk({
    ok: true,
    board: page.board,
    count: page.board.length,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    q: page.q,
    seedOnly: page.seedOnly,
    globalLedger: page.globalLedger,
    note: page.q
      ? `Seed board filter q=${JSON.stringify(page.q)} (handle/display/badges). Not a global multiplayer ledger. No invented earnings.`
      : 'Seed board only — not a global multiplayer ledger. Local browser grinds merge client-side on /fame. No invented earnings.',
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for fame seed board. Points are not submitted here.');
}
