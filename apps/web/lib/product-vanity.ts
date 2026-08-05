/**
 * Vanity / .drool name registry honesty.
 * Registry is not live; claims are not executable.
 */

import { vanityQuote, VANITY_MONTHLY_USD } from './points';

export interface VanityRegistryStatus {
  readonly registryLive: false;
  readonly claimExecutable: false;
  readonly settlementLive: false;
  readonly monthlyUsd: number;
  readonly quote: ReturnType<typeof vanityQuote>;
  readonly claims: readonly never[];
  readonly note: string;
}

export function buildVanityRegistryStatus(): VanityRegistryStatus {
  return {
    registryLive: false,
    claimExecutable: false,
    settlementLive: false,
    monthlyUsd: VANITY_MONTHLY_USD,
    quote: vanityQuote(),
    claims: [],
    note: 'name.drool registry is not live. Pricing is a quote only — claims, ownership, and settlement are not executable. No owned names are invented.',
  };
}
