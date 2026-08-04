/**
 * Device-local points ledger (Reddit-like gamification).
 * Server/ad-revenue cap is the real authority; this is honest offline UX.
 */

import {
  POINT_ACTIONS,
  canIssuePoints,
  remainingIssuablePoints,
  type AdRevenueCap,
  type PointsBalance,
} from './points';

export const POINTS_LEDGER_KEY = 'wetdrool.points.ledger.v1';
export const POINTS_CAP_KEY = 'wetdrool.points.cap.v1';

export type PointActionId = (typeof POINT_ACTIONS)[number]['id'];

export interface PointsLedgerV1 {
  readonly version: 1;
  readonly available: number;
  readonly pending: number;
  readonly lifetimeEarned: number;
  readonly lastCheckinDay: string | null;
  readonly events: readonly PointsEvent[];
}

export interface PointsEvent {
  readonly id: string;
  readonly actionId: PointActionId | 'spend' | 'tip';
  readonly delta: number;
  readonly at: string;
  readonly note?: string;
}

export function emptyLedger(): PointsLedgerV1 {
  return {
    version: 1,
    available: 0,
    pending: 0,
    lifetimeEarned: 0,
    lastCheckinDay: null,
    events: [],
  };
}

export function defaultCap(period = currentPeriod()): AdRevenueCap {
  // Until ads are live, issuance is hard-capped low so the UI stays honest.
  return {
    period,
    adRevenuePointUnits: 0,
    pointsIssued: 0,
  };
}

export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function utcDay(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function loadLedger(storage: Pick<Storage, 'getItem'> | null): PointsLedgerV1 {
  if (!storage) return emptyLedger();
  try {
    const raw = storage.getItem(POINTS_LEDGER_KEY);
    if (!raw) return emptyLedger();
    const parsed = JSON.parse(raw) as Partial<PointsLedgerV1>;
    if (parsed.version !== 1) return emptyLedger();
    return {
      version: 1,
      available: Math.max(0, Number(parsed.available) || 0),
      pending: Math.max(0, Number(parsed.pending) || 0),
      lifetimeEarned: Math.max(0, Number(parsed.lifetimeEarned) || 0),
      lastCheckinDay: typeof parsed.lastCheckinDay === 'string' ? parsed.lastCheckinDay : null,
      events: Array.isArray(parsed.events) ? parsed.events.slice(0, 100) : [],
    };
  } catch {
    return emptyLedger();
  }
}

export function saveLedger(storage: Pick<Storage, 'setItem'>, ledger: PointsLedgerV1): void {
  storage.setItem(POINTS_LEDGER_KEY, JSON.stringify(ledger));
}

export function loadCap(storage: Pick<Storage, 'getItem'> | null): AdRevenueCap {
  if (!storage) return defaultCap();
  try {
    const raw = storage.getItem(POINTS_CAP_KEY);
    if (!raw) return defaultCap();
    const parsed = JSON.parse(raw) as Partial<AdRevenueCap>;
    return {
      period: typeof parsed.period === 'string' ? parsed.period : currentPeriod(),
      adRevenuePointUnits: Math.max(0, Number(parsed.adRevenuePointUnits) || 0),
      pointsIssued: Math.max(0, Number(parsed.pointsIssued) || 0),
    };
  } catch {
    return defaultCap();
  }
}

export function saveCap(storage: Pick<Storage, 'setItem'>, cap: AdRevenueCap): void {
  storage.setItem(POINTS_CAP_KEY, JSON.stringify(cap));
}

export function balanceOf(ledger: PointsLedgerV1): PointsBalance {
  return {
    available: ledger.available,
    pending: ledger.pending,
    lifetimeEarned: ledger.lifetimeEarned,
  };
}

export function actionBase(actionId: PointActionId): number {
  const row = POINT_ACTIONS.find((a) => a.id === actionId);
  return row?.base ?? 0;
}

export type AwardResult =
  | { readonly ok: true; readonly ledger: PointsLedgerV1; readonly cap: AdRevenueCap; readonly awarded: number }
  | { readonly ok: false; readonly reason: 'cap' | 'already-checkin' | 'unknown'; readonly ledger: PointsLedgerV1; readonly cap: AdRevenueCap };

/**
 * Award points under the ad-revenue cap. When ad revenue is 0, no points issue
 * (reputation-only streak can still record a zero-award check-in event).
 */
export function awardPoints(
  ledger: PointsLedgerV1,
  cap: AdRevenueCap,
  actionId: PointActionId,
  now = new Date(),
): AwardResult {
  if (actionId === 'checkin' && ledger.lastCheckinDay === utcDay(now)) {
    return { ok: false, reason: 'already-checkin', ledger, cap };
  }

  const amount = actionBase(actionId);
  if (!canIssuePoints(cap, amount)) {
    // Freeze issuance when ads have not funded the pool.
    const frozenEvent: PointsEvent = {
      id: `evt_${now.getTime()}_${actionId}`,
      actionId,
      delta: 0,
      at: now.toISOString(),
      note: `Issuance frozen — remaining cap ${remainingIssuablePoints(cap)} (ads fund points).`,
    };
    return {
      ok: false,
      reason: 'cap',
      ledger: {
        ...ledger,
        lastCheckinDay: actionId === 'checkin' ? utcDay(now) : ledger.lastCheckinDay,
        events: [frozenEvent, ...ledger.events].slice(0, 100),
      },
      cap,
    };
  }

  const nextCap: AdRevenueCap = {
    ...cap,
    pointsIssued: cap.pointsIssued + amount,
  };
  const event: PointsEvent = {
    id: `evt_${now.getTime()}_${actionId}`,
    actionId,
    delta: amount,
    at: now.toISOString(),
  };
  const next: PointsLedgerV1 = {
    version: 1,
    available: ledger.available + amount,
    pending: ledger.pending,
    lifetimeEarned: ledger.lifetimeEarned + amount,
    lastCheckinDay: actionId === 'checkin' ? utcDay(now) : ledger.lastCheckinDay,
    events: [event, ...ledger.events].slice(0, 100),
  };
  return { ok: true, ledger: next, cap: nextCap, awarded: amount };
}

/** Dev/demo: fund the ad cap so local gamification can be exercised. */
export function fundAdCap(cap: AdRevenueCap, units: number): AdRevenueCap {
  return {
    ...cap,
    adRevenuePointUnits: Math.max(0, cap.adRevenuePointUnits + Math.floor(units)),
  };
}
