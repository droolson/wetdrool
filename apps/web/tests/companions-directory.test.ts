import { describe, expect, it } from 'vitest';

import {
  extractCompanionsPayload,
  normalizeProductCompanions,
} from '../components/companions-directory';
import type { CompanionsApiResponse } from '../lib/product-client';

describe('normalizeProductCompanions', () => {
  it('returns empty for non-arrays', () => {
    expect(normalizeProductCompanions(null)).toEqual([]);
    expect(normalizeProductCompanions(undefined)).toEqual([]);
    expect(normalizeProductCompanions({})).toEqual([]);
    expect(normalizeProductCompanions('x')).toEqual([]);
  });

  it('drops malformed rows and never invents chat live or earnings', () => {
    const items = normalizeProductCompanions([
      {
        id: 'nectar',
        name: 'Nectar',
        tagline: 'Velvet',
        tones: ['soft', 1, ''],
        nsfw: true,
        hirePointsPerMinute: 12,
        model: 'grok-4.5',
        blurb: 'RP',
        source: 'synthetic-catalog',
        chatLive: true, // forced closed
        earningsClaimed: true, // forced closed
        href: '/companions/nectar',
      },
      { id: '', name: 'bad' },
      { name: 'no-id' },
      { id: 'x', name: '' },
      null,
      42,
      {
        id: 'volt',
        name: 'Volt',
        tones: ['chaotic'],
        nsfw: true,
        hirePointsPerMinute: 14,
        model: 'grok-4.5',
        href: '/companions/volt',
      },
    ]);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 'nectar',
      name: 'Nectar',
      tones: ['soft'],
      chatLive: false,
      earningsClaimed: false,
      synthetic: true,
    });
    expect(items[1]).toMatchObject({
      id: 'volt',
      name: 'Volt',
      chatLive: false,
      earningsClaimed: false,
      source: 'synthetic-catalog',
    });
  });

  it('preserves empty catalog without placeholders', () => {
    expect(normalizeProductCompanions([])).toEqual([]);
  });
});

describe('extractCompanionsPayload', () => {
  it('prefers companions and falls back to items for lag', () => {
    const withCompanions = {
      ok: true as const,
      companions: [{ id: 'a', name: 'A' }],
      items: [{ id: 'b', name: 'B' }],
    } as unknown as CompanionsApiResponse;
    expect(extractCompanionsPayload(withCompanions)).toEqual([{ id: 'a', name: 'A' }]);

    const withItemsOnly = {
      ok: true as const,
      items: [{ id: 'b', name: 'B' }],
    } as unknown as CompanionsApiResponse;
    expect(extractCompanionsPayload(withItemsOnly)).toEqual([{ id: 'b', name: 'B' }]);

    const empty = { ok: true as const } as CompanionsApiResponse;
    expect(extractCompanionsPayload(empty)).toEqual([]);
  });
});
