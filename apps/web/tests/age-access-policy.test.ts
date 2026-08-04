import { describe, expect, it } from 'vitest';

import {
  AGE_ACCESS_POLICY_VERSION,
  DEFAULT_OPERATOR,
  ageAccessPolicySnapshot,
  normalizeRegionHint,
  resolveAgeAccessPolicy,
} from '../lib/age-access-policy';
import {
  AGE_GATE_STORAGE_KEY,
  REGION_HINT_STORAGE_KEY,
  isAgeAssuranceHintRegion,
  isSelfAttestPreferredRegion,
  readAgeAccessPolicy,
  readAgeGate,
  readContentMode,
  readRegionHint,
  writeAgeGate,
  writeContentMode,
  writeRegionHint,
} from '../lib/nsfw-mode';

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('age access policy', () => {
  it('defaults to 18+ self-attest without government ID', () => {
    const decision = resolveAgeAccessPolicy();
    expect(decision.version).toBe(AGE_ACCESS_POLICY_VERSION);
    expect(decision.outcome).toBe('allow_self_attest');
    expect(decision.defaultProof).toBe('self_attest_18');
    expect(decision.collectGovernmentId).toBe(false);
    expect(decision.walletIsAgeProof).toBe(false);
    expect(decision.minimumAge).toBe(18);
    expect(decision.regionHint).toBeNull();
    expect(decision.operator.kind).toBe('swiss_foundation_planned');
    expect(decision.operator).toEqual(DEFAULT_OPERATOR);
    expect(decision.reasons.some((r) => r.includes('self-attest'))).toBe(true);
  });

  it('normalizes region hints and rejects garbage', () => {
    expect(normalizeRegionHint('ch')).toBe('CH');
    expect(normalizeRegionHint('  us-ca ')).toBe('US-CA');
    expect(normalizeRegionHint('')).toBeNull();
    expect(normalizeRegionHint('not a region')).toBeNull();
    expect(normalizeRegionHint('TOOLONGCODE')).toBeNull();
    expect(normalizeRegionHint(null)).toBeNull();
  });

  it('keeps self-attest when region is preferred or unknown', () => {
    const ch = resolveAgeAccessPolicy({ regionHint: 'CH' });
    expect(ch.outcome).toBe('allow_self_attest');
    expect(ch.regionHint).toBe('CH');
    expect(ch.collectGovernmentId).toBe(false);

    const unknown = resolveAgeAccessPolicy({ regionHint: 'XX' });
    expect(unknown.outcome).toBe('allow_self_attest');
  });

  it('snapshot matches resolve with the same hint', () => {
    expect(ageAccessPolicySnapshot('ch')).toEqual(resolveAgeAccessPolicy({ regionHint: 'ch' }));
  });
});

describe('nsfw-mode region helpers + gate', () => {
  it('round-trips region hints through normalize', () => {
    const storage = new MemoryStorage();
    expect(writeRegionHint(storage, 'ch')).toEqual({ ok: true, regionHint: 'CH' });
    expect(storage.values.get(REGION_HINT_STORAGE_KEY)).toBe('CH');
    expect(readRegionHint(storage)).toBe('CH');
    expect(writeRegionHint(storage, 'not-valid')).toEqual({ ok: true, regionHint: null });
    expect(storage.values.has(REGION_HINT_STORAGE_KEY)).toBe(false);
  });

  it('exposes honest region preference helpers', () => {
    expect(isSelfAttestPreferredRegion(null)).toBe(true);
    expect(isSelfAttestPreferredRegion('CH')).toBe(true);
    expect(isAgeAssuranceHintRegion(null)).toBe(false);
    // Assurance list stays empty until counsel signs off — do not invent enforcement.
    expect(isAgeAssuranceHintRegion('US')).toBe(false);
  });

  it('blocks NSFW until age gate is confirmed', () => {
    const storage = new MemoryStorage();
    expect(readAgeGate(storage).confirmed).toBe(false);
    expect(readContentMode(storage)).toBe('sfw');
    expect(writeContentMode(storage, 'nsfw')).toEqual({ ok: false, reason: 'age-gate' });

    writeAgeGate(storage, true);
    expect(readAgeGate(storage).confirmed).toBe(true);
    expect(storage.values.has(AGE_GATE_STORAGE_KEY)).toBe(true);
    expect(writeContentMode(storage, 'nsfw')).toEqual({ ok: true });
    expect(readContentMode(storage)).toBe('nsfw');
  });

  it('reads policy from storage region hint', () => {
    const storage = new MemoryStorage();
    writeRegionHint(storage, 'CH');
    const policy = readAgeAccessPolicy(storage);
    expect(policy.regionHint).toBe('CH');
    expect(policy.defaultProof).toBe('self_attest_18');
    expect(policy.collectGovernmentId).toBe(false);
  });
});
