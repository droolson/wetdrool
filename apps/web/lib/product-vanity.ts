/**
 * Vanity / .drool name registry honesty for product API + UI.
 *
 * Registry is not live; claims are not executable; owned names are never invented.
 * Pricing helpers live in points.ts; this module is the registry status boundary.
 */

import {
  getVanityHonestFlags,
  listVanityClaims,
  vanityQuote,
  vanityRegistryNote,
  VANITY_MONTHLY_USD,
  VANITY_NOT_CLAIMS,
  type VanityHonestFlags,
  type VanityQuote,
} from './points';

export interface VanityRegistryStatus {
  readonly version: 1;
  readonly product: 'wetdrool';
  readonly path: '/api/v1/vanity';
  readonly registryLive: false;
  readonly claimExecutable: false;
  /** Settlement rail for paid vanity is not wired. */
  readonly settlementLive: false;
  readonly monthlyUsd: number;
  readonly quote: VanityQuote;
  /** Always empty — never invent owned names. */
  readonly claims: readonly never[];
  readonly claimCount: 0;
  readonly honest: VanityHonestFlags;
  readonly notClaims: readonly string[];
  readonly note: string;
}

/**
 * Full vanity registry status for GET /api/v1/vanity and local UI fallback.
 * Always empty claims; registryLive / claimExecutable / settlementLive always false.
 */
export function buildVanityRegistryStatus(
  pointsPerUsd = 100,
  solUsd: number | null = null,
): VanityRegistryStatus {
  void listVanityClaims(); // document intent: claims come only from empty helper
  return {
    version: 1,
    product: 'wetdrool',
    path: '/api/v1/vanity',
    registryLive: false,
    claimExecutable: false,
    settlementLive: false,
    monthlyUsd: VANITY_MONTHLY_USD,
    quote: vanityQuote(pointsPerUsd, solUsd),
    claims: [],
    claimCount: 0,
    honest: getVanityHonestFlags(),
    notClaims: VANITY_NOT_CLAIMS,
    note: vanityRegistryNote(),
  };
}

export { VANITY_MONTHLY_USD, vanityQuote, getVanityHonestFlags, vanityRegistryNote };
