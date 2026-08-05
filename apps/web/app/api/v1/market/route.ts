import {
  createListingId,
  filterListingsByNetwork,
  filterListingsByQuery,
  getMarketplaceStoreKind,
  listListings,
  marketSortLabel,
  pageListings,
  parseMarketplaceListSort,
  putListing,
  publicListing,
  sortListings,
  toMarketplaceStoreApi,
} from '@/lib/marketplace-store';
import { getMarketplaceGateMode, wrapUnlockSecret } from '@/lib/marketplace-unlock';
import type { SealedEnvelope } from '@/lib/e2ee-seal';
import { SEAL_PROTOCOL } from '@/lib/e2ee-seal';
import {
  buildPaymentRequirements,
  getDefaultNetwork,
  getMarketplaceRpcUrl,
  isValidSolanaAddress,
  lamportsFromSol,
  parseX402Network,
} from '@/lib/x402';
import { jsonError, jsonOk, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const qRaw = url.searchParams.get('q')?.trim() ?? '';
  const q = qRaw.slice(0, 80);
  const networkFilter = parseX402Network(url.searchParams.get('network'));
  const sort = parseMarketplaceListSort(url.searchParams.get('sort'));
  // Invalid network query is ignored (no filter) rather than 400 — list stays usable.
  const filtered = filterListingsByNetwork(
    filterListingsByQuery(listListings(), q || null),
    networkFilter,
  );
  const all = sortListings(filtered, sort);
  const page = pageListings(all, limit, offset);
  const items = page.items.map(publicListing);
  const rpcConfigured = getMarketplaceRpcUrl() !== null;
  const network = getDefaultNetwork();
  const store = toMarketplaceStoreApi();

  const nextOffset = page.hasMore ? offset + items.length : null;
  const applied = Boolean(q) || networkFilter !== null || sort !== 'newest';
  const noteParts: string[] = [];
  if (q) {
    noteParts.push(
      'Case-insensitive substring over id, title, seller, description, payTo.',
    );
  }
  if (networkFilter) {
    noteParts.push(`Exact network match on listing.network (${networkFilter}).`);
  }
  noteParts.push(`Sort: ${marketSortLabel(sort)} (${sort}).`);
  if (!applied) {
    noteParts.push('No filter; full local store page.');
  } else {
    noteParts.push('Host listings only — not a global search index.');
  }

  return jsonOk({
    ok: true,
    count: items.length,
    total: page.total,
    limit,
    offset,
    hasMore: page.hasMore,
    nextOffset,
    q: q || null,
    network: networkFilter,
    sort,
    sortLabel: marketSortLabel(sort),
    filter: {
      q: q || null,
      network: networkFilter,
      sort,
      applied,
      matched: page.total,
      note: noteParts.join(' '),
    },
    listings: items,
    store,
    note: 'E2EE marketplace. Content unlock requires Solana x402-style payment then client decrypt. Not revenue-ready commerce.',
    paymentVerify: {
      rpcConfigured,
      network,
      note: rpcConfigured
        ? 'Unlock verifies SOL transfer via getTransaction against configured RPC. Host receipt is not multi-replica settlement.'
        : 'No RPC URL — unlocks fail closed with payment_unverified/no_rpc (except non-production WETDROOL_X402_DEV_ACCEPT=1).',
    },
  });
}

interface CreateBody {
  readonly title?: string;
  readonly description?: string;
  readonly seller?: string;
  readonly payTo?: string;
  readonly priceSol?: number;
  readonly unlockSecret?: string;
  readonly envelope?: SealedEnvelope;
}

export async function POST(request: Request): Promise<Response> {
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return jsonError(400, 'invalid_json', 'JSON body required.');
  }

  const title = body.title?.trim() ?? '';
  const description = body.description?.trim() ?? '';
  const seller = body.seller?.trim() || 'anonymous';
  const payTo = body.payTo?.trim() ?? '';
  const unlockSecret = body.unlockSecret?.trim() ?? '';
  const priceSol = Number(body.priceSol);
  const envelope = body.envelope;

  if (title.length < 1 || title.length > 120) {
    return jsonError(400, 'invalid_title', 'Title 1–120 chars.');
  }
  if (!isValidSolanaAddress(payTo)) {
    return jsonError(400, 'invalid_pay_to', 'payTo must be a Solana base58 address.');
  }
  if (!Number.isFinite(priceSol) || priceSol <= 0 || priceSol > 1000) {
    return jsonError(400, 'invalid_price', 'priceSol must be > 0 and ≤ 1000.');
  }
  if (unlockSecret.length < 8 || unlockSecret.length > 128) {
    return jsonError(400, 'invalid_unlock', 'unlockSecret 8–128 chars (used client-side to decrypt).');
  }
  if (
    !envelope ||
    envelope.protocol !== SEAL_PROTOCOL ||
    envelope.compression !== 'middle-out-lite-v1' ||
    typeof envelope.ciphertextBase64 !== 'string' ||
    envelope.ciphertextBase64.length > 6_000_000
  ) {
    return jsonError(400, 'invalid_envelope', 'Valid sealed envelope required.');
  }

  const storeKind = getMarketplaceStoreKind();
  const gateMode = getMarketplaceGateMode();
  if (storeKind === 'file-local' && gateMode === 'ephemeral') {
    return jsonError(
      503,
      'gate_secret_required',
      'File-backed market requires WETDROOL_MARKETPLACE_GATE_SECRET (≥16 chars) so unlocks survive restarts.',
    );
  }

  const id = createListingId();
  const network = getDefaultNetwork();
  const lamports = lamportsFromSol(priceSol);
  const wrapped = await wrapUnlockSecret(unlockSecret);

  const contentHash = envelope.messageId;

  const listing = {
    id,
    title,
    description: description.slice(0, 2000),
    seller: seller.slice(0, 64),
    payTo,
    lamports: lamports.toString(),
    network,
    contentType: envelope.contentType,
    contentHash,
    createdAt: new Date().toISOString(),
    envelope: {
      ...envelope,
      roomId: id,
    },
    unlockSecretCiphertext: wrapped.ciphertext,
    unlockSecretIv: wrapped.iv,
  };

  putListing(listing);

  const requirements = buildPaymentRequirements({
    network,
    payTo,
    lamports,
    resource: `/api/v1/market/${id}`,
    description: title,
    mimeType: envelope.contentType,
    listingId: id,
    contentHash,
  });

  return jsonOk(
    {
      ok: true,
      listing: publicListing(listing),
      accepts: requirements,
      store: toMarketplaceStoreApi(),
      gate: gateMode,
    },
    { status: 201 },
  );
}
