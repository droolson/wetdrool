import { describe, expect, it } from 'vitest';

import {
  getVanityHonestFlags,
  vanityQuote,
  vanityRegistryNote,
  VANITY_MONTHLY_USD,
} from '../lib/points';
import { buildVanityRegistryStatus } from '../lib/product-vanity';

describe('product-vanity honesty boundary', () => {
  it('registry is not live and invents no claims', () => {
    const status = buildVanityRegistryStatus();
    expect(status.registryLive).toBe(false);
    expect(status.claimExecutable).toBe(false);
    expect(status.settlementLive).toBe(false);
    expect(status.claims).toEqual([]);
    expect(status.claimCount).toBe(0);
    expect(status.monthlyUsd).toBe(VANITY_MONTHLY_USD);
    expect(status.quote.monthlyUsd).toBe(VANITY_MONTHLY_USD);
    expect(status.path).toBe('/api/v1/vanity');
    expect(status.product).toBe('wetdrool');
    expect(status.honest.registryLive).toBe(false);
    expect(status.honest.claimExecutable).toBe(false);
    expect(status.honest.inventsOwnedNames).toBe(false);
    expect(status.note.toLowerCase()).toMatch(/not live|registry/);
    expect(status.note).toMatch(/claimExecutable:\s*false/i);
  });

  it('honest flags never report live registry or executable claim', () => {
    const flags = getVanityHonestFlags();
    expect(flags.registryLive).toBe(false);
    expect(flags.claimExecutable).toBe(false);
    expect(flags.inventsOwnedNames).toBe(false);
    expect(flags.anonymousCandidateIsNotClaim).toBe(true);
    expect(flags.pointsDoNotClaim).toBe(true);
  });

  it('quote is pricing intent only', () => {
    const q = vanityQuote();
    expect(q.monthlyUsd).toBe(VANITY_MONTHLY_USD);
    expect(q.solEstimate).toBeNull();
    expect(q.perks.length).toBeGreaterThan(0);
    const withSol = vanityQuote(100, 100);
    expect(withSol.solEstimate).toBeCloseTo(VANITY_MONTHLY_USD / 100, 6);
  });

  it('note states registry offline and no invented names', () => {
    const note = vanityRegistryNote();
    expect(note).toMatch(/not live/i);
    expect(note).toMatch(/registryLive:\s*false/i);
    expect(note).toMatch(/claimExecutable:\s*false/i);
  });
});
