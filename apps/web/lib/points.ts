/**
 * Client-side points economy helpers for WetDrool gamification.
 * Server ledger is source of truth; this models display + spend estimates only.
 *
 * Vanity /.drool name surface is honesty-first: no live registry, no claim
 * execution, never invent owned names.
 */

export interface PointsBalance {
  readonly available: number;
  readonly pending: number;
  readonly lifetimeEarned: number;
}

export interface AdRevenueCap {
  /** Accounting window label, e.g. 2026-07 */
  readonly period: string;
  /** Ad revenue converted into point units for the period */
  readonly adRevenuePointUnits: number;
  /** Points already issued in the period */
  readonly pointsIssued: number;
}

export interface VanityQuote {
  readonly monthlyUsd: number;
  readonly solEstimate: number | null;
  readonly usdc: number;
  readonly pointsPrice: number;
  readonly perks: readonly string[];
}

/**
 * Machine-readable honesty flags for the vanity /.drool surface and /api/v1/vanity.
 * registryLive and claimExecutable stay false until a verified handle registry + claim path ship.
 */
export interface VanityHonestFlags {
  /** On-chain / hosted vanity registry is not live in this deployment. */
  readonly registryLive: false;
  /** Checkout / claim execution is not wired. */
  readonly claimExecutable: false;
  /** Product never invents owned .drool names for display or API. */
  readonly inventsOwnedNames: false;
  /** Anonymous candidates from passkey roots are not paid vanity claims. */
  readonly anonymousCandidateIsNotClaim: true;
  /** Points payment does not establish a registry claim. */
  readonly pointsDoNotClaim: true;
}

/** A claimed vanity name row — only returned when a real registry exists (never today). */
export interface VanityClaimRecord {
  readonly handle: string;
  readonly ownerIdentityId?: string;
  readonly claimedAt?: string;
  readonly source: 'registry';
}

export interface VanityRegistryStatus {
  readonly version: 1;
  readonly product: 'wetdrool';
  readonly path: '/api/v1/vanity';
  readonly registryLive: false;
  readonly claimExecutable: false;
  /** Always empty until a verified registry projects claims. */
  readonly claims: readonly VanityClaimRecord[];
  readonly claimCount: 0;
  readonly quote: VanityQuote;
  readonly honest: VanityHonestFlags;
  readonly notClaims: readonly string[];
  readonly note: string;
}

export const VANITY_MONTHLY_USD = 9.99;

export const VANITY_PERKS = [
  'Free username / handle change while subscribed',
  'Verification check after AI review',
  'Full profile + avatar customization',
] as const;

export const VANITY_NOT_CLAIMS = [
  'No live vanity registry in this deployment',
  'No owned .drool names are invented for display or API',
  'Anonymous passkey .drool candidates are not paid vanity claims',
  'Sign-in does not claim a vanity name',
  'Points are not a claim settlement proof',
  'Monthly quote is pricing intent only — claimExecutable stays false',
] as const;

export function remainingIssuablePoints(cap: AdRevenueCap): number {
  return Math.max(0, Math.floor(cap.adRevenuePointUnits - cap.pointsIssued));
}

export function canIssuePoints(cap: AdRevenueCap, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  return amount <= remainingIssuablePoints(cap);
}

export function vanityQuote(pointsPerUsd = 100, solUsd: number | null = null): VanityQuote {
  return {
    monthlyUsd: VANITY_MONTHLY_USD,
    solEstimate: solUsd === null || solUsd <= 0 ? null : VANITY_MONTHLY_USD / solUsd,
    usdc: VANITY_MONTHLY_USD,
    pointsPrice: Math.ceil(VANITY_MONTHLY_USD * pointsPerUsd),
    perks: VANITY_PERKS,
  };
}

/**
 * Fixed honesty flags for vanity /.drool. Never reports a live registry or executable claim.
 */
export function getVanityHonestFlags(): VanityHonestFlags {
  return {
    registryLive: false,
    claimExecutable: false,
    inventsOwnedNames: false,
    anonymousCandidateIsNotClaim: true,
    pointsDoNotClaim: true,
  };
}

/** Empty claims list — never invent owned names. */
export function listVanityClaims(): readonly VanityClaimRecord[] {
  return [];
}

/** Short note for API/UI when registry is offline. */
export function vanityRegistryNote(): string {
  return (
    'Vanity registry not live: no claim execution, no owned .drool names invented. ' +
    'Pricing and perks are product intent only. Anonymous passkey candidates are not paid vanity claims. ' +
    'registryLive: false · claimExecutable: false.'
  );
}

/**
 * Full vanity registry status payload for GET /api/v1/vanity (and local UI fallback).
 * Always empty claims; registryLive and claimExecutable always false.
 */
export function getVanityRegistryStatus(
  pointsPerUsd = 100,
  solUsd: number | null = null,
): VanityRegistryStatus {
  const claims = listVanityClaims();
  return {
    version: 1,
    product: 'wetdrool',
    path: '/api/v1/vanity',
    registryLive: false,
    claimExecutable: false,
    claims,
    claimCount: 0,
    quote: vanityQuote(pointsPerUsd, solUsd),
    honest: getVanityHonestFlags(),
    notClaims: VANITY_NOT_CLAIMS,
    note: vanityRegistryNote(),
  };
}

/** Engagement actions that earn points (relative; server applies quality gates). */
export const POINT_ACTIONS = [
  { id: 'checkin', label: 'Daily check-in', base: 5 },
  { id: 'post', label: 'Quality post', base: 8 },
  { id: 'reply', label: 'Meaningful reply', base: 3 },
  { id: 'photo', label: 'Photo share', base: 5 },
  { id: 'video', label: 'Video publish', base: 20 },
  { id: 'live_host_min', label: 'Livestream host (per min)', base: 2 },
  { id: 'watch_complete', label: 'Finish a short', base: 1 },
] as const;
