import { resolveAgeAccessPolicy } from '@/lib/age-access-policy';
import { jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const regionHint = url.searchParams.get('region');
  const policy = resolveAgeAccessPolicy({ regionHint });
  return jsonOk({ ok: true, policy });
}
