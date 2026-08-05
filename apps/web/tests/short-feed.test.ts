import { describe, expect, it } from 'vitest';

import {
  chipKeyNavIndex,
  contentWarningLabel,
  discoveryHonestyNote,
  discoverySortNote,
  emptyDiscoveryMessage,
  listShortCategories,
  parseDiscoveryMode,
  parseShortSortMode,
  personalizationStatus,
  personalizationUnconfiguredNote,
  rankShorts,
  rankShortsPage,
  scoreShort,
  SHORT_CLIPS,
  SHORT_RANK_WEIGHTS,
  SHORTS_PAGE_SIZE,
  shortSortLabel,
  syntheticMediaLabel,
} from '../lib/short-feed';
import { transferTaxAmount, getDroolTokenConfig } from '../lib/drool-token';
import { awardPoints, defaultCap, emptyLedger, fundAdCap } from '../lib/points-ledger';

describe('short feed ranking', () => {
  it('ranks pride mode with pride items first', () => {
    const ranked = rankShorts('pride', 10);
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked.every((c) => c.mode === 'pride')).toBe(true);
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[ranked.length - 1]!.score);
  });

  it('scores mode match higher than mismatch', () => {
    const item = SHORT_CLIPS.find((c) => c.mode === 'pride')!;
    expect(scoreShort(item, 'pride')).toBeGreaterThan(scoreShort(item, 'straight'));
  });

  it('labels fixtures synthetic with honest abstract copy', () => {
    expect(SHORT_CLIPS.every((c) => c.synthetic && c.contentWarning === 'abstract-only')).toBe(
      true,
    );
    expect(syntheticMediaLabel(SHORT_CLIPS[0]!)).toContain('SYNTHETIC');
    expect(syntheticMediaLabel(SHORT_CLIPS[0]!)).toMatch(/abstract/i);
    expect(contentWarningLabel('abstract-only')).toMatch(/Synthetic/i);
    expect(discoveryHonestyNote(true)).toMatch(/synthetic/i);
    expect(discoveryHonestyNote(false)).toMatch(/Mixed/i);
  });

  it('filters by category and paginates', () => {
    const page = rankShortsPage('all', { category: 'femboy', limit: 5, offset: 0 });
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.every((i) => i.category === 'femboy')).toBe(true);
    expect(page.syntheticCount).toBe(page.items.length);
    expect(page.licensedCount).toBe(0);
    expect(page.items[0]!.syntheticLabel).toContain('SYNTHETIC');
    expect(page.sort).toBe('trending');

    const cats = listShortCategories();
    expect(cats).toContain('trans');
    expect(parseDiscoveryMode('pride')).toBe('pride');
    expect(parseDiscoveryMode('nope')).toBe('all');
    expect(SHORT_RANK_WEIGHTS.provenance).toBe(0.35);
  });

  it('offset pagination hasMore across pages', () => {
    const first = rankShortsPage('all', { limit: 3, offset: 0 });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = rankShortsPage('all', { limit: 3, offset: 3 });
    expect(second.offset).toBe(3);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);

    const full = rankShortsPage('all', { limit: SHORTS_PAGE_SIZE, offset: 0 });
    expect(full.items.length).toBeLessThanOrEqual(SHORTS_PAGE_SIZE);
    if (full.total > SHORTS_PAGE_SIZE) {
      expect(full.hasMore).toBe(true);
      const next = rankShortsPage('all', { limit: SHORTS_PAGE_SIZE, offset: SHORTS_PAGE_SIZE });
      const ids = new Set([...full.items, ...next.items].map((i) => i.id));
      expect(ids.size).toBe(full.items.length + next.items.length);
      expect(full.items.length + next.items.length).toBeLessThanOrEqual(full.total);
    }
  });

  it('emptyDiscoveryMessage is honest about synthetic catalog', () => {
    expect(emptyDiscoveryMessage('pride', 'missing-cat')).toMatch(/synthetic/i);
    expect(emptyDiscoveryMessage('all', null)).toMatch(/synthetic/i);
    expect(emptyDiscoveryMessage('straight', 'cosplay')).toMatch(/straight/i);
  });

  it('chipKeyNavIndex wraps and supports Home/End', () => {
    expect(chipKeyNavIndex('ArrowRight', 0, 3)).toBe(1);
    expect(chipKeyNavIndex('ArrowRight', 2, 3)).toBe(0);
    expect(chipKeyNavIndex('ArrowLeft', 0, 3)).toBe(2);
    expect(chipKeyNavIndex('Home', 2, 3)).toBe(0);
    expect(chipKeyNavIndex('End', 0, 3)).toBe(2);
    expect(chipKeyNavIndex('Enter', 0, 3)).toBeNull();
    expect(chipKeyNavIndex('ArrowDown', 0, 0)).toBeNull();
  });

  it('unknown category filter yields empty page with hasMore false', () => {
    const page = rankShortsPage('all', { category: 'does-not-exist', limit: 6, offset: 0 });
    expect(page.total).toBe(0);
    expect(page.items).toHaveLength(0);
    expect(page.hasMore).toBe(false);
    expect(page.syntheticCount).toBe(0);
    expect(page.licensedCount).toBe(0);
  });

  it('personalization stays explicitly unconfigured', () => {
    const status = personalizationStatus();
    expect(status.configured).toBe(false);
    expect(status.mode).toBe('unconfigured');
    expect(status.note).toMatch(/unconfigured/i);
    expect(status.note).toMatch(/for-you/i);
    expect(personalizationUnconfiguredNote()).toBe(status.note);
  });

  it('sort modes: trending by score, recent by recency', () => {
    expect(parseShortSortMode('recent')).toBe('recent');
    expect(parseShortSortMode('trending')).toBe('trending');
    expect(parseShortSortMode('nope')).toBe('trending');
    expect(shortSortLabel('recent')).toMatch(/Recent/i);
    expect(shortSortLabel('trending')).toMatch(/Trending/i);

    const trending = rankShortsPage('all', { sort: 'trending', limit: 24 });
    const recent = rankShortsPage('all', { sort: 'recent', limit: 24 });
    expect(trending.sort).toBe('trending');
    expect(recent.sort).toBe('recent');
    expect(trending.items.length).toBe(recent.items.length);

    for (let i = 1; i < recent.items.length; i++) {
      expect(recent.items[i - 1]!.recency).toBeGreaterThanOrEqual(recent.items[i]!.recency);
    }
    for (let i = 1; i < trending.items.length; i++) {
      expect(trending.items[i - 1]!.score).toBeGreaterThanOrEqual(trending.items[i]!.score);
    }
    expect(recent.items[0]!.why.some((w) => w.includes('sort recent'))).toBe(true);
    expect(discoverySortNote('trending')).toMatch(/Trending/i);
    expect(discoverySortNote('trending')).toMatch(/not a for-you/i);
    expect(discoverySortNote('recent')).toMatch(/Recent/i);
    expect(discoverySortNote('recent')).toMatch(/public catalog/i);
  });
});

describe('token mint boundary', () => {
  it('stays mint-pending without env mint', () => {
    const cfg = getDroolTokenConfig({});
    expect(cfg.status).toBe('mint-pending');
    expect(cfg.mint).toBe('');
    expect(cfg.transferTaxBps).toBe(300);
    expect(transferTaxAmount(100)).toBe(3);
  });
});

describe('points ledger', () => {
  it('freezes awards when ad cap is empty', () => {
    const result = awardPoints(emptyLedger(), defaultCap(), 'watch_complete');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('cap');
  });

  it('awards when cap is funded', () => {
    const cap = fundAdCap(defaultCap(), 100);
    const result = awardPoints(emptyLedger(), cap, 'watch_complete');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.awarded).toBe(1);
      expect(result.ledger.available).toBe(1);
    }
  });
});
