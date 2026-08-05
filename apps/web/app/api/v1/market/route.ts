import {
  createListingId,
  filterListingsByQuery,
  getMarketplaceStoreKind,
  listListings,
  pageListings,
  putListing,
  publicListing,
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
  const all = filterListingsByQuery(listListings(), q || null);
  const page = pageListings(all, limit, offset);
  const items = page.items.map(publicListing);
  const rpcConfigured = getMarketplaceRpcUrl() !== null;
  const network = getDefaultNetwork();
  const store = getMarketplaceStoreKind();
  const gate = getMarketplaceGateMode();

  return jsonOk({
    ok: true,
    count: items.length,
    total: page.total,
    limit,
    offset,
    hasMore: page.hasMore,
    q: q || null,
    filter: {
      q: q || null,
      applied: Boolean(q),
      matched: page.total,
      note: q
        ? 'Case-insensitive substring over id, title, seller, description, payTo. Host listings only — not a global search index.'
        : 'No filter; full local store page.',
    },
    listings: items,
    store: {
      kind: store,
      durableAcrossRestart: store === 'file-local',
      multiReplicaSafe: false,
      gate: gate,
      note:
        store === 'file-local'
          ? 'File-backed local store. Survives restarts on one node when gate secret is set. Not multi-instance.'
          : 'In-process memory. Listings vanish on cold start / multi-instance. Set WETDROOL_MARKETPLACE_DATA_PATH for local durability.',
    },
    note: 'E2EE marketplace. Content unlock requires Solana x402-style payment then client decrypt.',
    paymentVerify: {
      rpcConfigured,
      network,
      note: rpcConfigured
        ? 'Unlock verifies SOL transfer via getTransaction against configured RPC.'
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
      store: storeKind,
      gate: gateMode,
    },
    { status: 201 },
  );
}
