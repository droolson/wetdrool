import { probeAuthServiceStatus } from '@/lib/auth/auth-service-config';
import { jsonOk, methodNotAllowed } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/auth/status
 * Honest server-side probe of the configured authentication service.
 * Does not create sessions or expose secrets.
 */
export async function GET(): Promise<Response> {
  const report = await probeAuthServiceStatus();
  return jsonOk(report);
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for auth service status.');
}
