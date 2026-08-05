import { describe, expect, it } from 'vitest';

import { buildVanityRegistryStatus } from '../lib/product-vanity';

describe('product-vanity', () => {
  it('registry is not live and invents no claims', () => {
    const status = buildVanityRegistryStatus();
    expect(status.registryLive).toBe(false);
    expect(status.claimExecutable).toBe(false);
    expect(status.settlementLive).toBe(false);
    expect(status.claims).toEqual([]);
    expect(status.monthlyUsd).toBeGreaterThan(0);
    expect(status.note.toLowerCase()).toMatch(/not live|not executable/);
  });
});
