import { buildProductEventsResponse } from '@/lib/product-events';
import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/events?limit=&offset=
 * Honest product events surface: synthetic fixtures only (or empty page).
 * Never invents live attendance or a global calendar.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  return jsonOk(buildProductEventsResponse({ limit, offset }));
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for the events calendar. Creating events or RSVPs is not implemented here.',
  );
}
