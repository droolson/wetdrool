/**
 * In-process E2EE marketplace listings (Vercel alpha).
 * Ciphertext + x402 terms only. Unlock keys never stored in plaintext.
 */

import type { SealedEnvelope } from './e2ee-seal';
import type { X402Network } from './x402';

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
  /** Ciphertext envelope (middle-out + AES). Buyer still needs listing unlock secret after pay. */
  readonly envelope: SealedEnvelope;
  /**
   * Unlock secret wrapped for release after payment.
   * Alpha: base64 of unlock passphrase encrypted with a server listing key derived from
   * listing id + payTo — actually for true E2EE we store unlock passphrase *encrypted
   * to itself via seller-provided unlock token*.
   *
   * Simpler alpha: seller provides unlockPassphraseHint hash only; after payment
   * the sealed envelope uses roomId=listingId and passphrase=unlockSecret that
   * seller set. Server stores unlockSecret encrypted with payment-gate key so
   * only after verified payment is unlockSecret returned.
   */
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

const g = globalThis as unknown as {
  __wetdroolMarket?: Map<string, MarketplaceListing>;
  __wetdroolPurchases?: Map<string, PurchaseReceipt>;
  __wetdroolListingKey?: CryptoKey;
};

function listings(): Map<string, MarketplaceListing> {
  if (!g.__wetdroolMarket) g.__wetdroolMarket = new Map();
  return g.__wetdroolMarket;
}

function purchases(): Map<string, PurchaseReceipt> {
  if (!g.__wetdroolPurchases) g.__wetdroolPurchases = new Map();
  return g.__wetdroolPurchases;
}

export function createListingId(): string {
  return `lst_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function putListing(listing: MarketplaceListing): void {
  listings().set(listing.id, listing);
}

export function getListing(id: string): MarketplaceListing | null {
  return listings().get(id) ?? null;
}

export function listListings(): readonly MarketplaceListing[] {
  return [...listings().values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function recordPurchase(receipt: PurchaseReceipt): void {
  purchases().set(`${receipt.listingId}:${receipt.signature}`, receipt);
}

export function hasPurchase(listingId: string, signature?: string): boolean {
  if (signature) return purchases().has(`${listingId}:${signature}`);
  for (const key of purchases().keys()) {
    if (key.startsWith(`${listingId}:`)) return true;
  }
  return false;
}

export function getPurchase(listingId: string, signature: string): PurchaseReceipt | null {
  return purchases().get(`${listingId}:${signature}`) ?? null;
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
