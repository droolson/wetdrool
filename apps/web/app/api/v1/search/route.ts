import { searchSyntheticCatalog } from '@/lib/product-search';
import { jsonOk, methodNotAllowed, parseLimit } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/search?q=&limit=
 * Synthetic fixture catalog search only — not a global user/post index.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const page = searchSyntheticCatalog(url.searchParams.get('q'), { limit });

  return jsonOk({
    ok: true,
    q: page.q,
    count: page.results.length,
    total: page.total,
    limit,
    results: page.results,
    configured: page.configured,
    globalIndex: page.globalIndex,
    syntheticOnly: page.syntheticOnly,
    note: page.q
      ? 'Synthetic catalog hits only (shorts/creators/live/fame fixtures). Not a search of real accounts or protocol objects.'
      : 'Provide q= to search synthetic fixtures. Empty query returns no invented results. Global index is not configured.',
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for product synthetic search.');
}
