/**
 * Marketplace listing store — memory (default) or optional durable JSON file.
 * Ciphertext + x402 terms only. Unlock keys never stored in plaintext.
 *
 * File mode (WETDROOL_MARKETPLACE_DATA_PATH): survives process restart on a
 * single node. Not multi-replica safe; not production commerce. Pair with
 * WETDROOL_MARKETPLACE_GATE_SECRET so unlock wrap keys survive restarts.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import type { SealedEnvelope } from './e2ee-seal';
import type { X402Network } from './x402';

export type MarketplaceStoreKind = 'memory-ephemeral' | 'file-local';

export interface MarketplaceListing {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly seller: string;
  readonly payTo: string;
  readonly lamports: string;
  readonly network: X402Network;
  readonly contentType: string;
  readonly contentHash: string;
  readonly createdAt: string;
  /** Ciphertext envelope (middle-out + AES). */
  readonly envelope: SealedEnvelope;
  readonly unlockSecretCiphertext: string;
  readonly unlockSecretIv: string;
}

export interface PurchaseReceipt {
  readonly listingId: string;
  readonly signature: string;
  readonly payer?: string;
  readonly verifiedAt: string;
  readonly slot?: number;
}

interface StoreSnapshot {
  readonly version: 1;
  readonly listings: readonly MarketplaceListing[];
  readonly purchases: readonly PurchaseReceipt[];
}

export interface MarketplaceStore {
  readonly kind: MarketplaceStoreKind;
  putListing(listing: MarketplaceListing): void;
  getListing(id: string): MarketplaceListing | null;
  listListings(): readonly MarketplaceListing[];
  recordPurchase(receipt: PurchaseReceipt): void;
  hasPurchase(listingId: string, signature?: string): boolean;
  getPurchase(listingId: string, signature: string): PurchaseReceipt | null;
}

const g = globalThis as unknown as {
  __wetdroolMarketStore?: MarketplaceStore;
};

function resolveDataPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const raw = env.WETDROOL_MARKETPLACE_DATA_PATH?.trim();
  if (!raw) return null;
  // Refuse empty / relative traversal tricks; require absolute path.
  if (!raw.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(raw)) return null;
  return raw;
}

class MemoryMarketplaceStore implements MarketplaceStore {
  readonly kind = 'memory-ephemeral' as const;
  private readonly listings = new Map<string, MarketplaceListing>();
  private readonly purchases = new Map<string, PurchaseReceipt>();

  putListing(listing: MarketplaceListing): void {
    this.listings.set(listing.id, listing);
  }

  getListing(id: string): MarketplaceListing | null {
    return this.listings.get(id) ?? null;
  }

  listListings(): readonly MarketplaceListing[] {
    return [...this.listings.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  recordPurchase(receipt: PurchaseReceipt): void {
    this.purchases.set(`${receipt.listingId}:${receipt.signature}`, receipt);
  }

  hasPurchase(listingId: string, signature?: string): boolean {
    if (signature) return this.purchases.has(`${listingId}:${signature}`);
    for (const key of this.purchases.keys()) {
      if (key.startsWith(`${listingId}:`)) return true;
    }
    return false;
  }

  getPurchase(listingId: string, signature: string): PurchaseReceipt | null {
    return this.purchases.get(`${listingId}:${signature}`) ?? null;
  }
}

class FileMarketplaceStore implements MarketplaceStore {
  readonly kind = 'file-local' as const;
  private readonly listings = new Map<string, MarketplaceListing>();
  private readonly purchases = new Map<string, PurchaseReceipt>();
  private loaded = false;

  constructor(private readonly path: string) {}

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!existsSync(this.path)) return;
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StoreSnapshot>;
      if (parsed.version !== 1 || !Array.isArray(parsed.listings)) return;
      for (const listing of parsed.listings) {
        if (listing && typeof listing.id === 'string') {
          this.listings.set(listing.id, listing as MarketplaceListing);
        }
      }
      if (Array.isArray(parsed.purchases)) {
        for (const p of parsed.purchases) {
          if (p && typeof p.listingId === 'string' && typeof p.signature === 'string') {
            this.purchases.set(`${p.listingId}:${p.signature}`, p as PurchaseReceipt);
          }
        }
      }
    } catch {
      // Corrupt file: start empty rather than crash the market API.
    }
  }

  private persist(): void {
    const snapshot: StoreSnapshot = {
      version: 1,
      listings: [...this.listings.values()],
      purchases: [...this.purchases.values()],
    };
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot), 'utf8');
    renameSync(tmp, this.path);
  }

  putListing(listing: MarketplaceListing): void {
    this.ensureLoaded();
    this.listings.set(listing.id, listing);
    this.persist();
  }

  getListing(id: string): MarketplaceListing | null {
    this.ensureLoaded();
    return this.listings.get(id) ?? null;
  }

  listListings(): readonly MarketplaceListing[] {
    this.ensureLoaded();
    return [...this.listings.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }

  recordPurchase(receipt: PurchaseReceipt): void {
    this.ensureLoaded();
    this.purchases.set(`${receipt.listingId}:${receipt.signature}`, receipt);
    this.persist();
  }

  hasPurchase(listingId: string, signature?: string): boolean {
    this.ensureLoaded();
    if (signature) return this.purchases.has(`${listingId}:${signature}`);
    for (const key of this.purchases.keys()) {
      if (key.startsWith(`${listingId}:`)) return true;
    }
    return false;
  }

  getPurchase(listingId: string, signature: string): PurchaseReceipt | null {
    this.ensureLoaded();
    return this.purchases.get(`${listingId}:${signature}`) ?? null;
  }
}

/** Resolve store for this process (cached). Pass env for tests. */
export function getMarketplaceStore(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options?: { readonly forceNew?: boolean },
): MarketplaceStore {
  if (!options?.forceNew && g.__wetdroolMarketStore && env === process.env) {
    return g.__wetdroolMarketStore;
  }
  const path = resolveDataPath(env);
  const store: MarketplaceStore = path ? new FileMarketplaceStore(path) : new MemoryMarketplaceStore();
  if (!options?.forceNew && env === process.env) {
    g.__wetdroolMarketStore = store;
  }
  return store;
}

/** Test/helper: clear process-cached store. */
export function resetMarketplaceStoreCache(): void {
  delete g.__wetdroolMarketStore;
}

export function getMarketplaceStoreKind(
  env: Readonly<Record<string, string | undefined>> = process.env,
): MarketplaceStoreKind {
  return resolveDataPath(env) ? 'file-local' : 'memory-ephemeral';
}

export function createListingId(): string {
  return `lst_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function putListing(listing: MarketplaceListing): void {
  getMarketplaceStore().putListing(listing);
}

export function getListing(id: string): MarketplaceListing | null {
  return getMarketplaceStore().getListing(id);
}

export function listListings(): readonly MarketplaceListing[] {
  return getMarketplaceStore().listListings();
}

export function recordPurchase(receipt: PurchaseReceipt): void {
  getMarketplaceStore().recordPurchase(receipt);
}

export function hasPurchase(listingId: string, signature?: string): boolean {
  return getMarketplaceStore().hasPurchase(listingId, signature);
}

export function getPurchase(listingId: string, signature: string): PurchaseReceipt | null {
  return getMarketplaceStore().getPurchase(listingId, signature);
}

/** Public view without ciphertext / unlock material. */
export function publicListing(listing: MarketplaceListing) {
  return {
    id: listing.id,
    title: listing.title,
    description: listing.description,
    seller: listing.seller,
    payTo: listing.payTo,
    lamports: listing.lamports,
    network: listing.network,
    contentType: listing.contentType,
    contentHash: listing.contentHash,
    createdAt: listing.createdAt,
    e2ee: true as const,
    x402: true as const,
  };
}

export function pageListings(
  all: readonly MarketplaceListing[],
  limit: number,
  offset: number,
): { readonly items: readonly MarketplaceListing[]; readonly total: number; readonly hasMore: boolean } {
  const total = all.length;
  const start = Math.max(0, offset);
  const items = all.slice(start, start + limit);
  return { items, total, hasMore: start + items.length < total };
}
