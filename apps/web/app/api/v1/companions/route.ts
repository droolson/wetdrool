import { buildProductCompanionsResponse } from '@/lib/companions';
import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/companions?limit=&offset=&nsfw=
 * Honest product companions catalog: synthetic fixtures only (or empty page).
 * Never invents chat history, sessions, or companion earnings.
 * nsfw=0|false → SFW-only listing; default returns full catalog (client age-gates).
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const nsfwParam = url.searchParams.get('nsfw');
  const sfwOnly = nsfwParam === '0' || nsfwParam === 'false';
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  return jsonOk(
    buildProductCompanionsResponse({
      limit,
      offset,
      nsfwAllowed: !sfwOnly,
    }),
  );
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for the companions catalog. Hiring, chat sessions, and mesh companions are not implemented here.',
  );
}
