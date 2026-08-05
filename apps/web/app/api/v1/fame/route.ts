import { pageFameSeed } from '@/lib/hall-of-fame';
import { jsonError, jsonOk, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/fame?limit=&offset=
 * Seed leaderboard only. Browser merges local grind client-side on /fame.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const page = pageFameSeed({ limit, offset });

  return jsonOk({
    ok: true,
    board: page.board,
    count: page.board.length,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    seedOnly: page.seedOnly,
    globalLedger: page.globalLedger,
    note: 'Seed board only — not a global multiplayer ledger. Local browser grinds merge client-side on /fame. No invented earnings.',
  });
}

export function POST(): Response {
  return jsonError(405, 'method_not_allowed', 'Use GET for fame seed board. Points are not submitted here.');
}
