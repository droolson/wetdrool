import { describe, expect, it } from 'vitest';

import {
  normalizeProductSearchQuery,
  searchSyntheticCatalog,
} from '../lib/product-search';

describe('product-search synthetic catalog', () => {
  it('normalizes q: trim, lower, strip @, empty → null, cap length', () => {
    expect(normalizeProductSearchQuery(null)).toBe(null);
    expect(normalizeProductSearchQuery('')).toBe(null);
    expect(normalizeProductSearchQuery('  @Neon  ')).toBe('neon');
    expect(normalizeProductSearchQuery('a'.repeat(100)?.length === 100 ? 'a'.repeat(100) : '')?.length).toBe(
      64,
    );
  });

  it('empty query returns no invented results', () => {
    const page = searchSyntheticCatalog('');
    expect(page.q).toBe(null);
    expect(page.results).toEqual([]);
    expect(page.configured).toBe(false);
    expect(page.globalIndex).toBe(false);
    expect(page.syntheticOnly).toBe(true);
  });

  it('matches synthetic shorts/creators without claiming global index', () => {
    const page = searchSyntheticCatalog('neon', { limit: 24 });
    expect(page.q).toBe('neon');
    expect(page.configured).toBe(false);
    expect(page.globalIndex).toBe(false);
    expect(page.results.length).toBeGreaterThan(0);
    expect(page.results.every((h) => h.source === 'synthetic-catalog')).toBe(true);
  });

  it('unknown needle yields empty total', () => {
    const page = searchSyntheticCatalog('zzznomatch_fixture_xyz_999');
    expect(page.total).toBe(0);
    expect(page.results).toHaveLength(0);
  });
});
