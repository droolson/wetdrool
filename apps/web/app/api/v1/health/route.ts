import { jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  return jsonOk({
    ok: true,
    service: '@wetdrool/web',
    product: 'wetdrool',
    surfaces: ['hub', 'shorts', 'live', 'creators', 'fame', 'token', 'social'],
    media: 'synthetic-fixtures',
    droolMint: 'see /api/v1/token',
    mesh: false,
  });
}
