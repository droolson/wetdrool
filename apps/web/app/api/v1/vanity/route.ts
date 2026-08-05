import { getVanityRegistryStatus } from '@/lib/points';
import { jsonOk, methodNotAllowed } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/vanity
 * Honest vanity /.drool status: registryLive false, claimExecutable false,
 * empty claims list — never invents owned names.
 */
export function GET(): Response {
  const status = getVanityRegistryStatus();

  return jsonOk({
    ok: true as const,
    product: status.product,
    path: status.path,
    version: status.version,
    registryLive: status.registryLive,
    claimExecutable: status.claimExecutable,
    claims: status.claims,
    claimCount: status.claimCount,
    quote: status.quote,
    honest: status.honest,
    notClaims: status.notClaims,
    note: status.note,
  });
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for vanity registry status. Claims are not accepted here (claimExecutable: false).',
  );
}
