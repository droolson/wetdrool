import {
  AGE_ACCESS_POLICY_VERSION,
  normalizeRegionHint,
  resolveAgeAccessPolicy,
} from '@/lib/age-access-policy';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/policy/age?region=XX
 * Machine-readable 18+ access policy. Never claims compliance completion.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const rawRegion = url.searchParams.get('region');
  if (rawRegion !== null && rawRegion.trim() !== '' && normalizeRegionHint(rawRegion) === null) {
    return jsonError(
      400,
      'invalid_region',
      'region must be ISO-ish (e.g. CH, US, XX) up to 8 chars.',
    );
  }
  const regionHint = normalizeRegionHint(rawRegion);
  const policy = resolveAgeAccessPolicy({ regionHint });

  return jsonOk({
    ok: true,
    policyVersion: AGE_ACCESS_POLICY_VERSION,
    policy,
    flags: {
      collectGovernmentId: policy.collectGovernmentId,
      walletIsAgeProof: policy.walletIsAgeProof,
      minimumAge: policy.minimumAge,
      defaultProof: policy.defaultProof,
      outcome: policy.outcome,
    },
    note: 'Self-attest is the default. This is not legal advice and not a completed compliance matrix.',
  });
}

export function POST(): Response {
  return jsonError(405, 'method_not_allowed', 'Use GET for age access policy.');
}
