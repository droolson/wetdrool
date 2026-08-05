import { describe, expect, it } from 'vitest';

import { companionById, listCompanionDirectory, COMPANIONS } from '../lib/companions';

describe('companions directory', () => {
  it('lists synthetic companions with chatLive and earnings false', () => {
    const page = listCompanionDirectory({ limit: 48, offset: 0 });
    expect(page.total).toBe(COMPANIONS.length);
    expect(page.syntheticOnly).toBe(true);
    expect(page.chatLive).toBe(false);
    expect(page.earningsClaimed).toBe(false);
    expect(page.items.every((c) => c.chatLive === false)).toBe(true);
    expect(page.items.every((c) => c.earningsClaimed === false)).toBe(true);
    expect(page.items.every((c) => c.source === 'synthetic-catalog')).toBe(true);
  });

  it('filters nsfw when nsfwAllowed false', () => {
    const page = listCompanionDirectory({ nsfwAllowed: false, limit: 48 });
    expect(page.items.every((c) => c.nsfw === false)).toBe(true);
  });

  it('resolves companion by id', () => {
    const first = COMPANIONS[0]!;
    expect(companionById(first.id)?.name).toBe(first.name);
    expect(companionById('no-such-companion')).toBeUndefined();
  });
});
