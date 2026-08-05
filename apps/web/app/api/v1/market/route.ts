import { createListingId, listListings, putListing, publicListing } from '@/lib/marketplace-store';
import { wrapUnlockSecret } from '@/lib/marketplace-unlock';
import type { SealedEnvelope } from '@/lib/e2ee-seal';
import { SEAL_PROTOCOL } from '@/lib/e2ee-seal';
import {
  buildPaymentRequirements,
  getDefaultNetwork,
  getMarketplaceRpcUrl,
  isValidSolanaAddress,
  lamportsFromSol,
} from '@/lib/x402';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const items = listListings().map(publicListing);
  const rpcConfigured = getMarketplaceRpcUrl() !== null;
  const network = getDefaultNetwork();
  return jsonOk({
    ok: true,
    count: items.length,
    listings: items,
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

  const id = createListingId();
  const network = getDefaultNetwork();
  const lamports = lamportsFromSol(priceSol);
  const wrapped = await wrapUnlockSecret(unlockSecret);

  // content hash from envelope message id + room for public ref
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
    },
    { status: 201 },
  );
}
