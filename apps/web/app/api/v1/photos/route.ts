import { buildProductPhotosResponse } from '@/lib/product-photos';
import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/photos?limit=&offset=
 * Honest product photos gallery: synthetic abstract fixtures only (or empty page).
 * Never invents licensed performer media or real stills.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  return jsonOk(buildProductPhotosResponse({ limit, offset }));
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for the photos gallery. Uploads and licensed media writes are not implemented here.',
  );
}
