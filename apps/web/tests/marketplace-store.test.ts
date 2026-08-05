import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createListingId,
  filterListingsByQuery,
  getMarketplaceStore,
  pageListings,
  publicListing,
  resetMarketplaceStoreCache,
  type MarketplaceListing,
} from '../lib/marketplace-store';
import {
  getMarketplaceGateMode,
  resetMarketplaceGateCache,
  unwrapUnlockSecret,
  wrapUnlockSecret,
} from '../lib/marketplace-unlock';
import { parseOffset } from '../lib/product-api';
import { SEAL_PROTOCOL } from '../lib/e2ee-seal';

function sampleListing(id: string): MarketplaceListing {
  return {
    id,
    title: 'Drop',
    description: 'd',
    seller: 's',
    payTo: '11111111111111111111111111111111',
    lamports: '10000000',
    network: 'solana:devnet',
    contentType: 'text/plain',
    contentHash: 'h',
    createdAt: new Date().toISOString(),
    envelope: {
      protocol: SEAL_PROTOCOL,
      roomId: id,
      messageId: 'm1',
      createdAt: new Date().toISOString(),
      contentType: 'text/plain',
      ivBase64: 'aGk=',
      ciphertextBase64: 'Y2lwaGVy',
      compression: 'middle-out-lite-v1',
    },
    unlockSecretCiphertext: 'x',
    unlockSecretIv: 'y',
  };
}

describe('marketplace store', () => {
  afterEach(() => {
    resetMarketplaceStoreCache();
    resetMarketplaceGateCache();
  });

  it('pages listings', () => {
    const all = [sampleListing('a'), sampleListing('b'), sampleListing('c')];
    const page = pageListings(all, 2, 1);
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(2);
    expect(page.hasMore).toBe(false);
    expect(parseOffset('3')).toBe(3);
    expect(parseOffset('-1')).toBe(0);
  });

  it('filters listings by query substring', () => {
    const all = [
      { ...sampleListing('lst_aaa'), title: 'Neon drops' },
      { ...sampleListing('lst_bbb'), title: 'Quiet loft', seller: 'violet' },
    ];
    expect(filterListingsByQuery(all, '')).toHaveLength(2);
    expect(filterListingsByQuery(all, 'neon')).toHaveLength(1);
    expect(filterListingsByQuery(all, 'VIOLET')[0]?.id).toBe('lst_bbb');
    expect(filterListingsByQuery(all, 'zzz')).toHaveLength(0);
  });

  it('memory store round-trips listings and purchases', () => {
    const store = getMarketplaceStore({}, { forceNew: true });
    expect(store.kind).toBe('memory-ephemeral');
    const id = createListingId();
    const listing = sampleListing(id);
    store.putListing(listing);
    expect(store.getListing(id)?.title).toBe('Drop');
    expect(publicListing(listing).e2ee).toBe(true);
    store.recordPurchase({
      listingId: id,
      signature: '5'.repeat(88),
      verifiedAt: new Date().toISOString(),
    });
    expect(store.hasPurchase(id, '5'.repeat(88))).toBe(true);
  });

  it('file store survives re-open on same path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wd-market-'));
    const path = join(dir, 'store.json');
    try {
      const env = { WETDROOL_MARKETPLACE_DATA_PATH: path };
      const a = getMarketplaceStore(env, { forceNew: true });
      expect(a.kind).toBe('file-local');
      const id = createListingId();
      a.putListing(sampleListing(id));
      const b = getMarketplaceStore(env, { forceNew: true });
      expect(b.getListing(id)?.id).toBe(id);
      expect(b.listListings().length).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('stable gate secret round-trips unlock wrap', async () => {
    const env = { WETDROOL_MARKETPLACE_GATE_SECRET: 'test-gate-secret-32b-min' };
    expect(getMarketplaceGateMode(env)).toBe('env-stable');
    const wrapped = await wrapUnlockSecret('buyer-pass-phrase', env);
    resetMarketplaceGateCache();
    const plain = await unwrapUnlockSecret(wrapped.ciphertext, wrapped.iv, env);
    expect(plain).toBe('buyer-pass-phrase');
  });
});
