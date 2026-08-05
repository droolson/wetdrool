import { buildMeshProductStatus, jsonOk, methodNotAllowed } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/mesh
 * Honest mesh/relay readiness — configuration only; never invents live peers.
 */
export function GET(): Response {
  return jsonOk(buildMeshProductStatus());
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for mesh/relay product status. Mutations and peer discovery are not implemented here.',
  );
}
