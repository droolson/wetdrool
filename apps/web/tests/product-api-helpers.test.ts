import { describe, expect, it } from 'vitest';

import { parseLimit } from '../lib/product-api';
import { rankShorts } from '../lib/short-feed';
import { getDroolTokenConfig, transferTaxAmount } from '../lib/drool-token';
import {
  FAME_SEED,
  fameTier,
  rankBoard,
  rankBoardWithSeed,
  emptyLocalProfile,
  type FameEntry,
} from '../lib/hall-of-fame';
import { LIVE_ROOMS, filterLiveRooms } from '../lib/live-catalog';

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
    expect(items[0]).toHaveProperty('synthetic');
    expect(items.every((c) => c.mode === 'pride' && c.synthetic)).toBe(true);
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

  it('merges api seed with local grinder and drops api local rows', () => {
    const apiSeed: FameEntry[] = [
      ...FAME_SEED,
      {
        handle: 'spoof',
        displayName: 'Spoof',
        lifetimePoints: 999999,
        streakDays: 1,
        badges: ['x'],
        source: 'local',
      },
    ];
    const local = {
      ...emptyLocalProfile(),
      handle: 'you',
      lifetimePoints: 500,
      checkinDays: ['2026-08-04'],
    };
    const board = rankBoardWithSeed(apiSeed, local, '2026-08-04');
    expect(board.some((e) => e.handle === 'spoof')).toBe(false);
    expect(board.some((e) => e.source === 'local' && e.handle === 'you')).toBe(true);
    expect(board[0]!.lifetimePoints).toBeGreaterThanOrEqual(board[board.length - 1]!.lifetimePoints);
  });

  it('live catalog filters nsfw when not allowed', () => {
    expect(LIVE_ROOMS.length).toBeGreaterThanOrEqual(2);
    const sfw = filterLiveRooms(LIVE_ROOMS, { nsfwAllowed: false });
    expect(sfw.every((r) => !r.nsfw)).toBe(true);
    const all = filterLiveRooms(LIVE_ROOMS, { nsfwAllowed: true });
    expect(all.length).toBe(LIVE_ROOMS.length);
  });
});
