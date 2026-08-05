import { pageProductStories } from '@/lib/product-stories';
import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/stories
 * Synthetic story fixtures — no inventing view counts or global deletion.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const page = pageProductStories({ limit, offset });

  return jsonOk({
    ok: true,
    count: page.items.length,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    stories: page.items,
    syntheticOnly: page.syntheticOnly,
    viewCountsInvented: page.viewCountsInvented,
    globalDeletionClaimed: page.globalDeletionClaimed,
    note: 'Synthetic story fixtures only. View counts and network-wide deletion are never claimed.',
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for product stories. Publishing is not implemented here.');
}
