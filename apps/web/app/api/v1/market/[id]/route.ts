import {
  getListing,
  hasPurchase,
  publicListing,
  recordPurchase,
} from '@/lib/marketplace-store';
import { unwrapUnlockSecret } from '@/lib/marketplace-unlock';
import {
  buildPaymentRequirements,
  encodePaymentHeader,
  getMarketplaceRpcUrl,
  isValidTxSignature,
  parsePaymentHeader,
  verifySolanaPayment,
  type X402PaymentPayload,
} from '@/lib/x402';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function paymentFromRequest(request: Request): X402PaymentPayload | null {
  const header =
    request.headers.get('x-payment') ||
    request.headers.get('X-PAYMENT') ||
    request.headers.get('x-402-payment');
  const fromHeader = parsePaymentHeader(header);
  if (fromHeader) return fromHeader;
  const url = new URL(request.url);
  const sig = url.searchParams.get('signature') || url.searchParams.get('payment');
  if (sig && isValidTxSignature(sig)) {
    const listing = getListing(url.pathname.split('/').pop() || '');
    return {
      x402Version: 1,
      scheme: 'exact',
      network: listing?.network || 'solana:devnet',
      payload: { signature: sig },
    };
  }
  return null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const listing = getListing(id);
  if (!listing) return jsonError(404, 'not_found', 'Listing not found.');

  const payment = paymentFromRequest(request);
  const resource = `/api/v1/market/${id}`;
  const accepts = buildPaymentRequirements({
    network: listing.network,
    payTo: listing.payTo,
    lamports: BigInt(listing.lamports),
    resource,
    description: listing.title,
    mimeType: listing.contentType,
    listingId: listing.id,
    contentHash: listing.contentHash,
  });

  if (!payment) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: { code: 'payment_required', message: 'Payment Required' },
        x402Version: 1,
        accepts: [accepts],
        listing: publicListing(listing),
      }),
      {
        status: 402,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
          'PAYMENT-REQUIRED': 'true',
        },
      },
    );
  }

  // Already recorded?
  if (hasPurchase(listing.id, payment.payload.signature)) {
    const unlockSecret = await unwrapUnlockSecret(
      listing.unlockSecretCiphertext,
      listing.unlockSecretIv,
    );
    return jsonOk({
      ok: true,
      listing: publicListing(listing),
      envelope: listing.envelope,
      unlockSecret,
      paid: true,
      signature: payment.payload.signature,
    });
  }

  const rpc = getMarketplaceRpcUrl();
  const verified = await verifySolanaPayment({
    rpcUrl: rpc,
    signature: payment.payload.signature,
    payTo: listing.payTo,
    minLamports: BigInt(listing.lamports),
    network: listing.network,
  });

  if (!verified.ok) {
    // Dev escape hatch: WETDROOL_X402_DEV_ACCEPT=1 accepts any well-formed sig shape only on non-production
    const dev =
      process.env.WETDROOL_X402_DEV_ACCEPT === '1' &&
      process.env.NODE_ENV !== 'production' &&
      verified.reason === 'no_rpc';

    if (!dev) {
      return jsonError(402, 'payment_unverified', `Payment not verified: ${verified.reason}`, {
        accepts: [accepts],
        reason: verified.reason,
      });
    }
  }

  recordPurchase({
    listingId: listing.id,
    signature: payment.payload.signature,
    payer: payment.payload.payer,
    verifiedAt: new Date().toISOString(),
    slot: verified.ok ? verified.slot : undefined,
  });

  const unlockSecret = await unwrapUnlockSecret(
    listing.unlockSecretCiphertext,
    listing.unlockSecretIv,
  );

  return jsonOk({
    ok: true,
    listing: publicListing(listing),
    envelope: listing.envelope,
    unlockSecret,
    paid: true,
    signature: payment.payload.signature,
    devAccepted: !verified.ok,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Allow payment proof in JSON body too
  const { id } = await context.params;
  let body: { signature?: string; payer?: string } = {};
  try {
    body = (await request.json()) as { signature?: string; payer?: string };
  } catch {
    /* empty */
  }
  if (!body.signature || !isValidTxSignature(body.signature)) {
    return jsonError(400, 'invalid_payment', 'Body must include Solana tx signature.');
  }
  const listing = getListing(id);
  if (!listing) return jsonError(404, 'not_found', 'Listing not found.');

  const payload: X402PaymentPayload = {
    x402Version: 1,
    scheme: 'exact',
    network: listing.network,
    payload: { signature: body.signature, payer: body.payer },
  };

  // Re-dispatch as GET with header
  const headers = new Headers(request.headers);
  headers.set('X-PAYMENT', encodePaymentHeader(payload));
  const fake = new Request(request.url, { method: 'GET', headers });
  return GET(fake, context);
}
