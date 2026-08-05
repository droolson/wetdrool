import { describe, expect, it } from 'vitest';

import {
  normalizeProductSearchQuery,
  searchSyntheticCatalog,
} from '../lib/product-search';
import { normalizeSearchHits } from '../components/product-search';
import { PRODUCT_API_SURFACES } from '../lib/product-api';

describe('product search helpers', () => {
  it('normalizes query: trim, lower, strip leading @, max 64', () => {
    expect(normalizeProductSearchQuery(null)).toBeNull();
    expect(normalizeProductSearchQuery('')).toBeNull();
    expect(normalizeProductSearchQuery('   ')).toBeNull();
    expect(normalizeProductSearchQuery('  @NeonAngel  ')).toBe('neonangel');
    expect(normalizeProductSearchQuery('Studio Signal')).toBe('studio signal');
    expect(normalizeProductSearchQuery('x'.repeat(80))?.length).toBe(64);
  });

  it('empty q returns honest empty (never invents hits)', () => {
    const empty = searchSyntheticCatalog(null);
    expect(empty.q).toBeNull();
    expect(empty.results).toEqual([]);
    expect(empty.total).toBe(0);
    expect(empty.configured).toBe(false);
    expect(empty.globalIndex).toBe(false);
    expect(empty.syntheticOnly).toBe(true);

    const blank = searchSyntheticCatalog('   ');
    expect(blank.results).toEqual([]);
    expect(blank.configured).toBe(false);
  });

  it('matches synthetic short title/creator and labels source', () => {
    const byCreator = searchSyntheticCatalog('neonangel', { limit: 12 });
    expect(byCreator.configured).toBe(false);
    expect(byCreator.q).toBe('neonangel');
    expect(byCreator.results.length).toBeGreaterThan(0);
    expect(byCreator.results.every((h) => h.source === 'synthetic-catalog')).toBe(true);
    expect(byCreator.results.some((h) => h.kind === 'short' || h.kind === 'creator')).toBe(true);

    const byTitle = searchSyntheticCatalog('studio signal', { limit: 8 });
    expect(byTitle.results.some((h) => h.kind === 'short' && /studio/i.test(h.title))).toBe(true);
  });

  it('caps results and never claims a global index', () => {
    const page = searchSyntheticCatalog('a', { limit: 3 });
    expect(page.results.length).toBeLessThanOrEqual(3);
    expect(page.globalIndex).toBe(false);
    expect(page.syntheticOnly).toBe(true);
  });

  it('no match stays empty without fabricating users', () => {
    const miss = searchSyntheticCatalog('zzznomatchfixture999');
    expect(miss.results).toEqual([]);
    expect(miss.total).toBe(0);
    expect(miss.configured).toBe(false);
  });

  it('surface catalog registers GET /api/v1/search', () => {
    const search = PRODUCT_API_SURFACES.find((s) => s.id === 'search');
    expect(search?.path).toBe('/api/v1/search');
    expect(search?.methods).toEqual(['GET']);
  });

  it('normalizeSearchHits drops malformed rows', () => {
    expect(normalizeSearchHits(null)).toEqual([]);
    expect(normalizeSearchHits([{ id: 'x' }])).toEqual([]);
    const ok = normalizeSearchHits([
      {
        id: 'short:pride-femboy-studio',
        kind: 'short',
        title: 'Studio signal · soft light',
        subtitle: '@neonangel',
        href: '/video',
        source: 'synthetic-catalog',
        tags: ['pride', 'synthetic'],
      },
      { id: 'bad' },
    ]);
    expect(ok).toHaveLength(1);
    expect(ok[0]?.source).toBe('synthetic-catalog');
    expect(ok[0]?.kind).toBe('short');
  });
});
