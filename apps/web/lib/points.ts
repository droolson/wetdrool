/**
 * Client-side points economy helpers for WetDrool gamification.
 * Server ledger is source of truth; this models display + spend estimates only.
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

export const VANITY_MONTHLY_USD = 9.99;

export const VANITY_PERKS = [
  'Free username / handle change while subscribed',
  'Verification check after AI review',
  'Full profile + avatar customization',
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
