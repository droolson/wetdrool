import { describe, expect, it } from 'vitest';

import {
  FAME_SEED,
  fameEntryMatchesQuery,
  normalizeFameSearchQuery,
  pageFameSeed,
} from '../lib/hall-of-fame';

describe('hall-of-fame search helpers', () => {
  it('normalizes search queries (trim, lower, strip @, max 64)', () => {
    expect(normalizeFameSearchQuery(null)).toBeNull();
    expect(normalizeFameSearchQuery(undefined)).toBeNull();
    expect(normalizeFameSearchQuery('')).toBeNull();
    expect(normalizeFameSearchQuery('   ')).toBeNull();
    expect(normalizeFameSearchQuery('  @NeonAngel  ')).toBe('neonangel');
    expect(normalizeFameSearchQuery('A'.repeat(100))).toBe('a'.repeat(64));
  });

  it('matches handle, display name, and badges case-insensitively', () => {
    const entry = FAME_SEED[0]!;
    expect(fameEntryMatchesQuery(entry, 'king')).toBe(true);
    expect(fameEntryMatchesQuery(entry, 'alex')).toBe(true);
    expect(fameEntryMatchesQuery(entry, 'founder')).toBe(true);
    expect(fameEntryMatchesQuery(entry, 'zzzz-nope')).toBe(false);
  });

  it('pageFameSeed filters by q and keeps seedOnly / no global ledger', () => {
    const page = pageFameSeed({ limit: 24, offset: 0, q: 'neon' });
    expect(page.seedOnly).toBe(true);
    expect(page.globalLedger).toBe(false);
    expect(page.q).toBe('neon');
    expect(page.board.length).toBeGreaterThan(0);
    expect(page.board.every((row) => fameEntryMatchesQuery(row, 'neon'))).toBe(true);
    expect(page.total).toBe(page.board.length);
  });

  it('pageFameSeed empty filter is honest (total 0, seedOnly still true)', () => {
    const page = pageFameSeed({ q: 'definitely-not-on-seed-board-xyz' });
    expect(page.board).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.seedOnly).toBe(true);
    expect(page.globalLedger).toBe(false);
    expect(page.q).toBe('definitely-not-on-seed-board-xyz');
  });

  it('preserves global rank numbers when filtering', () => {
    const unfiltered = pageFameSeed({ limit: 48 });
    const neon = unfiltered.board.find((r) => r.handle === 'neonangel');
    expect(neon).toBeDefined();
    const filtered = pageFameSeed({ q: 'neonangel' });
    expect(filtered.board).toHaveLength(1);
    expect(filtered.board[0]!.rank).toBe(neon!.rank);
  });
});
