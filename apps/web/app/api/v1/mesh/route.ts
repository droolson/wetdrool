import { buildMeshProductStatus, methodNotAllowed, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/mesh
 * Honest mesh + relay readiness. Never invents live peers or production mesh.
 */
export function GET(): Response {
  return jsonOk(buildMeshProductStatus());
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for mesh/relay readiness. No mesh join via this API.');
}
