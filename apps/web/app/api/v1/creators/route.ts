import { listCreatorDirectory } from '@/lib/creator-economy';
import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/creators
 * Directory of fixture / founder creator handles — not a global user index.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const q = url.searchParams.get('q');
  const page = listCreatorDirectory({ limit, offset, q });

  return jsonOk({
    ok: true,
    count: page.items.length,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    q: page.q,
    creators: page.items,
    synthetic: page.synthetic,
    note: 'Synthetic catalog + founder preview only. Fixture filter via q= (handle/display/tags). Not a search of real accounts or earnings.',
  });
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for creator directory. Profiles are not created via this API.',
  );
}
