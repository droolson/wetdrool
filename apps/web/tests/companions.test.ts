import { describe, expect, it } from 'vitest';

import {
  COMPANIONS,
  companionById,
  buildProductCompanionsResponse,
  pageSyntheticCompanions,
  toSyntheticCompanionListing,
} from '../lib/companions';
import { PRODUCT_API_LINKS, PRODUCT_API_SURFACES } from '../lib/product-api';

describe('companions pure helpers', () => {
  it('companionById resolves fixtures and misses stay undefined', () => {
    expect(companionById('nectar')?.name).toBe('Nectar');
    expect(companionById('nope')).toBeUndefined();
  });

  it('toSyntheticCompanionListing never invents chat history or earnings', () => {
    const listing = toSyntheticCompanionListing(COMPANIONS[0]!);
    expect(listing.synthetic).toBe(true);
    expect(listing.source).toBe('synthetic-catalog');
    expect(listing.chatLive).toBe(false);
    expect(listing.chatHistory).toBeNull();
    expect(listing.sessionsClaimed).toBe(false);
    expect(listing.earningsClaimed).toBe(false);
    expect(listing.meshCompanion).toBe(false);
    expect(listing.href).toBe('/companions/nectar');
  });

  it('pageSyntheticCompanions is syntheticOnly with configured false', () => {
    const page = pageSyntheticCompanions({ limit: 2, offset: 0 });
    expect(page.configured).toBe(false);
    expect(page.syntheticOnly).toBe(true);
    expect(page.inventsChatHistory).toBe(false);
    expect(page.inventsEarnings).toBe(false);
    expect(page.chatLive).toBe(false);
    expect(page.meshCompanions).toBe(false);
    expect(page.sessionsClaimed).toBe(false);
    expect(page.earningsClaimed).toBe(false);
    expect(page.items).toHaveLength(2);
    expect(page.total).toBe(COMPANIONS.length);
    expect(page.hasMore).toBe(true);
    expect(page.items.every((c) => c.chatHistory === null)).toBe(true);
    expect(page.items.every((c) => c.earningsClaimed === false)).toBe(true);
  });

  it('high offset yields honest empty page without inventing rows', () => {
    const empty = pageSyntheticCompanions({ limit: 10, offset: 9999 });
    expect(empty.items).toEqual([]);
    expect(empty.count).toBe(0);
    expect(empty.hasMore).toBe(false);
    expect(empty.syntheticOnly).toBe(true);
    expect(empty.configured).toBe(false);
  });

  it('nsfwAllowed false filters NSFW personas (may be empty)', () => {
    const sfw = pageSyntheticCompanions({ nsfwAllowed: false });
    expect(sfw.items.every((c) => c.nsfw === false)).toBe(true);
    expect(sfw.syntheticOnly).toBe(true);
  });

  it('buildProductCompanionsResponse aliases companions and keeps honesty flags', () => {
    const body = buildProductCompanionsResponse({ limit: 48, offset: 0 });
    expect(body.ok).toBe(true);
    expect(body.product).toBe('wetdrool');
    expect(body.path).toBe('/api/v1/companions');
    expect(body.companions).toEqual(body.items);
    expect(body.configured).toBe(false);
    expect(body.syntheticOnly).toBe(true);
    expect(body.inventsChatHistory).toBe(false);
    expect(body.inventsEarnings).toBe(false);
    expect(body.chatLive).toBe(false);
    expect(body.meshCompanions).toBe(false);
    expect(body.earningsClaimed).toBe(false);
    expect(body.media).toBe('synthetic-fixtures');
    expect(body.note.toLowerCase()).toContain('never invented');
  });

  it('surface catalog registers GET /api/v1/companions', () => {
    const surface = PRODUCT_API_SURFACES.find((s) => s.id === 'companions');
    expect(surface?.path).toBe('/api/v1/companions');
    expect(surface?.methods).toEqual(['GET']);
    expect(PRODUCT_API_LINKS.companions).toBe('/api/v1/companions');
  });
});
