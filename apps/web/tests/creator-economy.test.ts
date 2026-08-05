import { describe, expect, it } from 'vitest';

import {
  listCreatorDirectory,
  normalizeCreatorHandle,
  normalizeCreatorSearchQuery,
  resolveCreatorProfile,
} from '../lib/creator-economy';

describe('creator-economy directory search', () => {
  it('normalizes q: trim, lower, strip @, empty → null, cap length', () => {
    expect(normalizeCreatorSearchQuery(null)).toBe(null);
    expect(normalizeCreatorSearchQuery(undefined)).toBe(null);
    expect(normalizeCreatorSearchQuery('')).toBe(null);
    expect(normalizeCreatorSearchQuery('   ')).toBe(null);
    expect(normalizeCreatorSearchQuery('@Neon')).toBe('neon');
    expect(normalizeCreatorSearchQuery('  Queer  ')).toBe('queer');
    const long = 'a'.repeat(100);
    expect(normalizeCreatorSearchQuery(long)?.length).toBe(64);
  });

  it('listCreatorDirectory without q returns full synthetic set', () => {
    const page = listCreatorDirectory({ limit: 48, offset: 0 });
    expect(page.synthetic).toBe(true);
    expect(page.q).toBe(null);
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.some((c) => c.source === 'founder')).toBe(true);
  });

  it('filters by handle substring', () => {
    const all = listCreatorDirectory({ limit: 48, offset: 0 });
    const founder = all.items.find((c) => c.source === 'founder');
    expect(founder).toBeDefined();
    const needle = founder!.handle.slice(0, Math.min(6, founder!.handle.length));
    const page = listCreatorDirectory({ limit: 48, offset: 0, q: needle });
    expect(page.q).toBe(needle.toLowerCase());
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.every((c) => c.handle.includes(page.q!))).toBe(true);
    expect(page.items.some((c) => c.handle === founder!.handle)).toBe(true);
  });

  it('filters by tag (e.g. queer / pride modes from fixtures)', () => {
    const page = listCreatorDirectory({ limit: 48, offset: 0, q: 'queer' });
    expect(page.q).toBe('queer');
    // Founder tags include queer; short-feed may too.
    expect(page.total).toBeGreaterThan(0);
    expect(
      page.items.every(
        (c) =>
          c.handle.includes('queer') ||
          c.displayName.toLowerCase().includes('queer') ||
          c.tags.some((t) => t.toLowerCase().includes('queer')),
      ),
    ).toBe(true);
  });

  it('empty filter match is honest: total 0, hasMore false, items empty', () => {
    const page = listCreatorDirectory({
      limit: 12,
      offset: 0,
      q: 'zzznomatch_fixture_xyz',
    });
    expect(page.q).toBe('zzznomatch_fixture_xyz');
    expect(page.items).toHaveLength(0);
    expect(page.total).toBe(0);
    expect(page.hasMore).toBe(false);
    expect(page.synthetic).toBe(true);
  });

  it('pagination applies after filter', () => {
    const full = listCreatorDirectory({ limit: 48, offset: 0, q: 'a' });
    if (full.total < 2) {
      // Catalog may be tiny; skip strict mid-page assert.
      expect(full.total).toBeGreaterThanOrEqual(0);
      return;
    }
    const first = listCreatorDirectory({ limit: 1, offset: 0, q: 'a' });
    const second = listCreatorDirectory({ limit: 1, offset: 1, q: 'a' });
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0]!.handle).not.toBe(second.items[0]!.handle);
    expect(first.total).toBe(full.total);
    expect(second.total).toBe(full.total);
    expect(first.hasMore).toBe(full.total > 1);
  });

  it('resolveCreatorProfile still normalizes handles', () => {
    expect(normalizeCreatorHandle('@NeonAngel')).toBe('neonangel');
    const founder = resolveCreatorProfile('kingofqueens6ix');
    expect(founder?.handle).toBe('kingofqueens6ix');
  });
});
