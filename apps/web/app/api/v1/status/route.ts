import {
  buildProductStatusReport,
  jsonOk,
  methodNotAllowed,
} from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Honest production/revenue readiness. Never invent earnings or a $DROOL mint.
 * Aggregates marketplace + room store + auth config flags (auth network probe is separate).
 * GET /api/v1/status
 */
export function GET(): Response {
  return jsonOk(buildProductStatusReport());
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for readiness status.');
}
