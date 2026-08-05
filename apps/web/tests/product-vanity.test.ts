import { describe, expect, it } from 'vitest';

import {
  getVanityHonestFlags,
  getVanityRegistryStatus,
  listVanityClaims,
  vanityQuote,
  vanityRegistryNote,
  VANITY_MONTHLY_USD,
  VANITY_NOT_CLAIMS,
} from '../lib/points';

describe('vanity /.drool honesty boundary', () => {
  it('quote is pricing intent only', () => {
    const q = vanityQuote();
    expect(q.monthlyUsd).toBe(VANITY_MONTHLY_USD);
    expect(q.usdc).toBe(VANITY_MONTHLY_USD);
    expect(q.pointsPrice).toBe(Math.ceil(VANITY_MONTHLY_USD * 100));
    expect(q.solEstimate).toBeNull();
    expect(q.perks.length).toBeGreaterThan(0);
  });

  it('honest flags never report live registry or executable claim', () => {
    const flags = getVanityHonestFlags();
    expect(flags.registryLive).toBe(false);
    expect(flags.claimExecutable).toBe(false);
    expect(flags.inventsOwnedNames).toBe(false);
    expect(flags.anonymousCandidateIsNotClaim).toBe(true);
    expect(flags.pointsDoNotClaim).toBe(true);
  });

  it('never invents owned names (empty claims)', () => {
    expect(listVanityClaims()).toEqual([]);
    const status = getVanityRegistryStatus();
    expect(status.claims).toEqual([]);
    expect(status.claimCount).toBe(0);
    expect(status.registryLive).toBe(false);
    expect(status.claimExecutable).toBe(false);
    expect(status.honest.registryLive).toBe(false);
    expect(status.honest.claimExecutable).toBe(false);
    expect(status.honest.inventsOwnedNames).toBe(false);
    expect(status.path).toBe('/api/v1/vanity');
    expect(status.product).toBe('wetdrool');
    expect(status.notClaims).toEqual(VANITY_NOT_CLAIMS);
  });

  it('note states registry is offline and no invented names', () => {
    const note = vanityRegistryNote();
    expect(note).toMatch(/not live/i);
    expect(note).toMatch(/claimExecutable:\s*false/i);
    expect(note).toMatch(/registryLive:\s*false/i);
    expect(note).toMatch(/never invent|not invent|no owned/i);
  });

  it('sol estimate only when positive solUsd provided', () => {
    expect(vanityQuote(100, null).solEstimate).toBeNull();
    expect(vanityQuote(100, 0).solEstimate).toBeNull();
    expect(vanityQuote(100, -1).solEstimate).toBeNull();
    const withSol = vanityQuote(100, 100);
    expect(withSol.solEstimate).toBeCloseTo(VANITY_MONTHLY_USD / 100, 6);
  });
});
