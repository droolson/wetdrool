import { describe, expect, it } from 'vitest';

import { rankShorts, scoreShort, SHORT_CLIPS } from '../lib/short-feed';
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

  it('labels abstract fixtures synthetic and founder media real', () => {
    const abstracts = SHORT_CLIPS.filter((c) => c.id !== 'founder-cumdump');
    expect(abstracts.every((c) => c.synthetic && c.contentWarning === 'abstract-only')).toBe(true);
    const cumdump = SHORT_CLIPS.find((c) => c.id === 'founder-cumdump');
    expect(cumdump).toBeDefined();
    expect(cumdump!.synthetic).toBe(false);
    expect(cumdump!.mediaSrc).toBe('/media/cumdump.webm');
    expect(cumdump!.title).toContain('EVIL');
    expect(cumdump!.title).not.toContain('EFIL');
  });

  it('ranks founder CUMDUMP near the top in all mode', () => {
    const ranked = rankShorts('all', 5);
    expect(ranked.some((c) => c.id === 'founder-cumdump')).toBe(true);
    expect(ranked[0]!.id).toBe('founder-cumdump');
  });
});

describe('$DROOL token boundary', () => {
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
