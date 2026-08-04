/**
 * Client-side NSFW/SFW mode for WetDrool.
 * Age gate must pass before NSFW can be enabled.
 *
 * Proof method is self-attestation (18+) by default — see age-access-policy.ts.
 * No government ID is collected or stored by this module.
 */

import {
  AGE_ASSURANCE_HINT_REGIONS,
  SELF_ATTEST_PREFERRED_REGIONS,
  ageAccessPolicySnapshot,
  normalizeRegionHint,
  type AgeAccessDecision,
} from './age-access-policy';

export type ContentMode = 'sfw' | 'nsfw';

export const NSFW_MODE_STORAGE_KEY = 'wetdrool.contentMode';
export const AGE_GATE_STORAGE_KEY = 'wetdrool.ageGate.confirmed18';
export const AGE_GATE_VERSION = 1;
/** Optional region hint key (never required; never inferred from content). */
export const REGION_HINT_STORAGE_KEY = 'wetdrool.ageGate.regionHint';

export interface AgeGateState {
  readonly confirmed: boolean;
  readonly version: number;
  readonly confirmedAt?: string;
}

export function readAgeGate(storage: Pick<Storage, 'getItem'> | null): AgeGateState {
  if (storage === null) {
    return { confirmed: false, version: AGE_GATE_VERSION };
  }
  try {
    const raw = storage.getItem(AGE_GATE_STORAGE_KEY);
    if (raw === null || raw === '') {
      return { confirmed: false, version: AGE_GATE_VERSION };
    }
    const parsed = JSON.parse(raw) as Partial<AgeGateState>;
    if (parsed.confirmed === true && parsed.version === AGE_GATE_VERSION) {
      return {
        confirmed: true,
        version: AGE_GATE_VERSION,
        confirmedAt: typeof parsed.confirmedAt === 'string' ? parsed.confirmedAt : undefined,
      };
    }
  } catch {
    /* fail closed */
  }
  return { confirmed: false, version: AGE_GATE_VERSION };
}

export function writeAgeGate(storage: Pick<Storage, 'setItem'>, confirmed: boolean): void {
  const state: AgeGateState = {
    confirmed,
    version: AGE_GATE_VERSION,
    confirmedAt: confirmed ? new Date().toISOString() : undefined,
  };
  storage.setItem(AGE_GATE_STORAGE_KEY, JSON.stringify(state));
}

export function readContentMode(storage: Pick<Storage, 'getItem'> | null): ContentMode {
  if (storage === null) return 'sfw';
  const age = readAgeGate(storage);
  if (!age.confirmed) return 'sfw';
  const raw = storage.getItem(NSFW_MODE_STORAGE_KEY);
  return raw === 'nsfw' ? 'nsfw' : 'sfw';
}

export function writeContentMode(
  storage: Pick<Storage, 'setItem' | 'getItem'>,
  mode: ContentMode,
): { readonly ok: true } | { readonly ok: false; readonly reason: 'age-gate' } {
  if (mode === 'nsfw' && !readAgeGate(storage).confirmed) {
    return { ok: false, reason: 'age-gate' };
  }
  storage.setItem(NSFW_MODE_STORAGE_KEY, mode);
  return { ok: true };
}

/**
 * Read optional region hint from storage.
 * Returns a normalized ISO-ish code or null (invalid / missing / blocked storage).
 */
export function readRegionHint(storage: Pick<Storage, 'getItem'> | null): string | null {
  if (storage === null) return null;
  try {
    return normalizeRegionHint(storage.getItem(REGION_HINT_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Persist optional region hint. Invalid codes clear storage (fail closed to unknown).
 * Never required for self-attest; never inferred from content or wallet.
 */
export function writeRegionHint(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  region: string | null,
): { readonly ok: true; readonly regionHint: string | null } {
  const normalized = normalizeRegionHint(region);
  if (normalized === null) {
    storage.removeItem(REGION_HINT_STORAGE_KEY);
    return { ok: true, regionHint: null };
  }
  storage.setItem(REGION_HINT_STORAGE_KEY, normalized);
  return { ok: true, regionHint: normalized };
}

/** Whether product config prefers self-attest for this normalized region. */
export function isSelfAttestPreferredRegion(regionHint: string | null): boolean {
  if (regionHint === null) return true;
  return SELF_ATTEST_PREFERRED_REGIONS.has(regionHint);
}

/** Whether product config may later offer third-party age assurance for this region. */
export function isAgeAssuranceHintRegion(regionHint: string | null): boolean {
  if (regionHint === null) return false;
  return AGE_ASSURANCE_HINT_REGIONS.has(regionHint);
}

/** Policy for the current browser (self-attest default; no gov ID). */
export function readAgeAccessPolicy(
  storage: Pick<Storage, 'getItem'> | null,
): AgeAccessDecision {
  return ageAccessPolicySnapshot(readRegionHint(storage));
}

/** Mental health + crisis resources shown platform-wide. */
export const MENTAL_HEALTH_RESOURCES = [
  {
    id: 'iasp',
    label: 'International Association for Suicide Prevention',
    href: 'https://www.iasp.info/suicidalthoughts/',
    detail: 'Find a local crisis resource by country.',
  },
  {
    id: 'iasp-resources',
    label: 'IASP resources hub',
    href: 'https://www.iasp.info/resources/',
    detail: 'Broader mental health and support links.',
  },
  {
    id: 'samhsa',
    label: 'SAMHSA National Helpline (US)',
    href: 'https://www.samhsa.gov/find-help/national-helpline',
    detail: '24/7 treatment referral and information (US).',
  },
  {
    id: 'support-agent',
    label: 'WetDrool support agent',
    href: '/support',
    detail: 'Talk to our always-on support agent — no judgment, real help paths.',
  },
] as const;
