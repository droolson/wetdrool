import {
  buildProductHealthReport,
  jsonOk,
  methodNotAllowed,
} from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/health
 * Lightweight product surface + store/auth + discovery honesty flags.
 * No network probes (use /auth/status). Never claims $DROOL mint, live earnings,
 * external shorts catalog, or feed personalization when feed-service is unwired.
 */
export function GET(): Response {
  return jsonOk(buildProductHealthReport());
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for product health.');
}
