import { describe, expect, it } from 'vitest';

import {
  contentWarningLabel,
  listShortCategories,
  parseDiscoveryMode,
  rankShorts,
  rankShortsPage,
  scoreShort,
  SHORT_CLIPS,
  SHORT_RANK_WEIGHTS,
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

  it('labels fixtures synthetic', () => {
    expect(SHORT_CLIPS.every((c) => c.synthetic && c.contentWarning === 'abstract-only')).toBe(
      true,
    );
    expect(syntheticMediaLabel(SHORT_CLIPS[0]!)).toContain('SYNTHETIC');
    expect(contentWarningLabel('abstract-only')).toMatch(/Synthetic/i);
  });

  it('filters by category and paginates', () => {
    const page = rankShortsPage('all', { category: 'femboy', limit: 5, offset: 0 });
    expect(page.total).toBeGreaterThan(0);
    expect(page.items.every((i) => i.category === 'femboy')).toBe(true);
    expect(page.syntheticCount).toBe(page.items.length);
    expect(page.licensedCount).toBe(0);
    expect(page.items[0]!.syntheticLabel).toContain('SYNTHETIC');

    const cats = listShortCategories();
    expect(cats).toContain('trans');
    expect(parseDiscoveryMode('pride')).toBe('pride');
    expect(parseDiscoveryMode('nope')).toBe('all');
    expect(SHORT_RANK_WEIGHTS.provenance).toBe(0.35);
  });

  it('offset pagination hasMore', () => {
    const first = rankShortsPage('all', { limit: 3, offset: 0 });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = rankShortsPage('all', { limit: 3, offset: 3 });
    expect(second.offset).toBe(3);
    expect(second.items[0]!.id).not.toBe(first.items[0]!.id);
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
