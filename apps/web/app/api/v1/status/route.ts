import { buildRevenueReadiness } from '@/lib/revenue-readiness';
import { jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Honest production/revenue readiness. Never invent earnings.
 * GET /api/v1/status
 */
export function GET(): Response {
  return jsonOk(buildRevenueReadiness());
}

export function POST(): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code: 'method_not_allowed', message: 'Use GET for readiness status.' },
    }),
    { status: 405, headers: { 'content-type': 'application/json; charset=utf-8' } },
  );
}
