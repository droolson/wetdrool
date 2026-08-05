import { buildProductStoriesResponse } from '@/lib/product-stories';
import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/stories?limit=&offset=
 * Honest product stories surface: synthetic rings only (or empty page).
 * Never invents view counts, watchers, or network-wide deletion.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  return jsonOk(buildProductStoriesResponse({ limit, offset }));
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for product stories. Publishing stories is not implemented here.',
  );
}
