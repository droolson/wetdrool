import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createListingId,
  filterListingsByQuery,
  getMarketplaceStore,
  getMarketplaceStoreKind,
  getMarketplaceStoreMeta,
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

    const first = pageListings(all, 2, 0);
    expect(first.hasMore).toBe(true);
    expect(first.items.map((l) => l.id)).toEqual(['a', 'b']);
    const nextOffset = 0 + first.items.length;
    const second = pageListings(all, 2, nextOffset);
    expect(second.items.map((l) => l.id)).toEqual(['c']);
    expect(second.hasMore).toBe(false);
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
    const sig = '5'.repeat(88);
    store.recordPurchase({
      listingId: id,
      signature: sig,
      verifiedAt: new Date().toISOString(),
      verification: 'rpc_verified',
      slot: 12,
    });
    expect(store.hasPurchase(id, sig)).toBe(true);
    const receipt = store.getPurchase(id, sig);
    expect(receipt?.verification).toBe('rpc_verified');
    expect(receipt?.slot).toBe(12);
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

  it('reports honest store meta flags (always replica-unsafe, never revenue-ready)', () => {
    const mem = getMarketplaceStoreMeta({});
    expect(mem.kind).toBe('memory-ephemeral');
    expect(getMarketplaceStoreKind({})).toBe('memory-ephemeral');
    expect(mem.multiReplicaSafe).toBe(false);
    expect(mem.durableAcrossRestart).toBe(false);
    expect(mem.revenueReady).toBe(false);
    expect(mem.gate).toBe('ephemeral');
    expect(mem.label).toMatch(/replica-unsafe/i);
    expect(mem.note).toMatch(/In-process memory/i);

    const file = getMarketplaceStoreMeta({
      WETDROOL_MARKETPLACE_DATA_PATH: '/tmp/wetdrool-market-meta-test.json',
      WETDROOL_MARKETPLACE_GATE_SECRET: 'stable-gate-secret-ok',
    });
    expect(file.kind).toBe('file-local');
    expect(file.durableAcrossRestart).toBe(true);
    expect(file.multiReplicaSafe).toBe(false);
    expect(file.revenueReady).toBe(false);
    expect(file.gate).toBe('env-stable');
    expect(file.label).toMatch(/single-node/i);
    expect(file.label).toMatch(/replica-unsafe/i);
    expect(file.note).toMatch(/one node only/i);
  });

  it('file store without gate secret is still replica-unsafe with ephemeral gate', () => {
    const meta = getMarketplaceStoreMeta({
      WETDROOL_MARKETPLACE_DATA_PATH: '/tmp/wetdrool-market-meta-test2.json',
    });
    expect(meta.kind).toBe('file-local');
    expect(meta.gate).toBe('ephemeral');
    expect(meta.multiReplicaSafe).toBe(false);
    expect(meta.revenueReady).toBe(false);
    expect(meta.label).toMatch(/gate ephemeral/i);
  });

});

describe('market unlock attempt log (client helpers)', () => {
  it('parses, appends, filters without storing secrets', async () => {
    const {
      appendUnlockAttempt,
      filterUnlockAttemptsForListing,
      parseUnlockAttemptLog,
      signatureHintFromTx,
      MARKET_UNLOCK_ATTEMPT_MAX,
    } = await import('../lib/product-client');

    expect(parseUnlockAttemptLog(null)).toEqual([]);
    expect(parseUnlockAttemptLog('not-json')).toEqual([]);
    expect(parseUnlockAttemptLog('{}')).toEqual([]);

    const base = appendUnlockAttempt([], {
      listingId: 'lst_one',
      status: 'fail',
      reason: 'no_rpc',
      signatureHint: signatureHintFromTx('5'.repeat(88)),
      at: '2026-01-01T00:00:00.000Z',
      id: 'att_1',
    });
    expect(base).toHaveLength(1);
    expect(base[0]?.status).toBe('fail');
    expect(base[0]?.reason).toBe('no_rpc');
    expect(base[0]?.signatureHint).toMatch(/…/);
    expect(JSON.stringify(base)).not.toMatch(/unlockSecret/);

    const withSuccess = appendUnlockAttempt(base, {
      listingId: 'lst_two',
      status: 'success',
      verification: 'rpc_verified',
      at: '2026-01-02T00:00:00.000Z',
      id: 'att_2',
    });
    expect(withSuccess[0]?.listingId).toBe('lst_two');
    expect(filterUnlockAttemptsForListing(withSuccess, 'lst_one')).toHaveLength(1);

    const roundTrip = parseUnlockAttemptLog(JSON.stringify(withSuccess));
    expect(roundTrip).toHaveLength(2);

    let log = withSuccess;
    for (let i = 0; i < MARKET_UNLOCK_ATTEMPT_MAX + 5; i++) {
      log = appendUnlockAttempt(log, {
        listingId: `lst_${i}`,
        status: 'fail',
        reason: 'payment_unverified',
      });
    }
    expect(log.length).toBe(MARKET_UNLOCK_ATTEMPT_MAX);
  });

  it('persists to injected storage without secrets', async () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
      key: () => null,
      length: 0,
    } as Storage;

    const { recordUnlockAttempt, readUnlockAttemptLog, MARKET_UNLOCK_ATTEMPT_STORAGE_KEY } =
      await import('../lib/product-client');

    const next = recordUnlockAttempt(
      {
        listingId: 'lst_persist',
        status: 'fail',
        reason: 'tx_failed_or_missing',
      },
      storage,
    );
    expect(next).toHaveLength(1);
    expect(map.has(MARKET_UNLOCK_ATTEMPT_STORAGE_KEY)).toBe(true);
    const again = readUnlockAttemptLog(storage);
    expect(again[0]?.listingId).toBe('lst_persist');
    expect(map.get(MARKET_UNLOCK_ATTEMPT_STORAGE_KEY)).not.toMatch(/secret|ciphertext/i);
  });
});
