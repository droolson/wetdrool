import { describe, expect, it } from 'vitest';

import { parseLimit } from '../lib/product-api';
import { rankShorts } from '../lib/short-feed';
import { getDroolTokenConfig, transferTaxAmount } from '../lib/drool-token';
import { FAME_SEED, fameTier, rankBoard, emptyLocalProfile } from '../lib/hall-of-fame';

describe('product api helpers', () => {
  it('clamps limit', () => {
    expect(parseLimit(null)).toBe(24);
    expect(parseLimit('3')).toBe(3);
    expect(parseLimit('999', 24, 48)).toBe(48);
    expect(parseLimit('nope')).toBe(24);
  });

  it('ranks shorts for api payload shape', () => {
    const items = rankShorts('pride', 5);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveProperty('score');
    expect(items[0]).toHaveProperty('synthetic', true);
  });

  it('token tax is 3%', () => {
    expect(getDroolTokenConfig({}).transferTaxBps).toBe(300);
    expect(transferTaxAmount(100)).toBe(3);
  });

  it('fame board ranks seed', () => {
    const board = rankBoard(emptyLocalProfile(), '2026-08-04');
    expect(board[0]!.lifetimePoints).toBeGreaterThanOrEqual(board[1]!.lifetimePoints);
    expect(fameTier(FAME_SEED[0]!.lifetimePoints).length).toBeGreaterThan(0);
  });
});
