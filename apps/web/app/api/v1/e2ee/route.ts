import { getE2eeCapabilityReport } from '@/lib/e2ee-status';
import { jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return jsonOk({ ok: true, e2ee: getE2eeCapabilityReport() });
}
