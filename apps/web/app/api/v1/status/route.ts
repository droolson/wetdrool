import { buildRevenueReadiness } from '@/lib/revenue-readiness';
import { jsonError, jsonOk } from '@/lib/product-api';

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
  return jsonError(405, 'method_not_allowed', 'Use GET for readiness status.');
}
