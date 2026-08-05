/**
 * x402-style HTTP Payment Required helpers for Solana (WetDrool marketplace).
 *
 * Protocol idea (https://www.x402.org / Solana x402 guides):
 *   GET resource → 402 + PaymentRequirements JSON
 *   Client pays on Solana → retries with X-PAYMENT (or body proof)
 *   Server verifies → 200 + resource
 *
 * This module is the WetDrool alpha adapter. Full facilitator settlement is
 * optional; local verification can accept a confirmed transfer signature when
 * RPC is configured.
 */

export const X402_VERSION = 1 as const;
export const X402_SCHEME = 'exact' as const;
export const X402_NETWORK_SOLANA_MAINNET = 'solana:mainnet' as const;
export const X402_NETWORK_SOLANA_DEVNET = 'solana:devnet' as const;

export type X402Network =
  | typeof X402_NETWORK_SOLANA_MAINNET
  | typeof X402_NETWORK_SOLANA_DEVNET;

export interface X402PaymentRequirements {
  readonly x402Version: typeof X402_VERSION;
  readonly scheme: typeof X402_SCHEME;
  readonly network: X402Network;
  /** Atomic units (lamports for native SOL). */
  readonly maxAmountRequired: string;
  readonly resource: string;
  readonly description: string;
  readonly mimeType: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly asset: 'sol' | 'spl';
  /** Optional SPL mint when asset is spl. */
  readonly mint?: string;
  readonly extra?: {
    readonly listingId: string;
    readonly contentHash: string;
    readonly e2ee: true;
  };
}

export interface X402PaymentPayload {
  readonly x402Version: typeof X402_VERSION;
  readonly scheme: typeof X402_SCHEME;
  readonly network: X402Network;
  readonly payload: {
    /** Base58 Solana transaction signature proving payment. */
    readonly signature: string;
    readonly payer?: string;
  };
}

export function isValidSolanaAddress(value: string): boolean {
  // Base58, 32–44 chars typical for pubkeys
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value);
}

export function isValidTxSignature(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{64,128}$/.test(value);
}

export function lamportsFromSol(sol: number): bigint {
  if (!Number.isFinite(sol) || sol < 0) return 0n;
  return BigInt(Math.round(sol * 1_000_000_000));
}

export function solFromLamports(lamports: bigint | string | number): number {
  const n = typeof lamports === 'bigint' ? lamports : BigInt(lamports);
  return Number(n) / 1_000_000_000;
}

export function buildPaymentRequirements(input: {
  readonly network: X402Network;
  readonly payTo: string;
  readonly lamports: bigint;
  readonly resource: string;
  readonly description: string;
  readonly mimeType: string;
  readonly listingId: string;
  readonly contentHash: string;
  readonly mint?: string;
}): X402PaymentRequirements {
  if (!isValidSolanaAddress(input.payTo)) {
    throw new Error('Invalid payTo address');
  }
  return {
    x402Version: X402_VERSION,
    scheme: X402_SCHEME,
    network: input.network,
    maxAmountRequired: input.lamports.toString(),
    resource: input.resource,
    description: input.description,
    mimeType: input.mimeType,
    payTo: input.payTo,
    maxTimeoutSeconds: 600,
    asset: input.mint ? 'spl' : 'sol',
    ...(input.mint ? { mint: input.mint } : {}),
    extra: {
      listingId: input.listingId,
      contentHash: input.contentHash,
      e2ee: true,
    },
  };
}

export function parsePaymentHeader(raw: string | null): X402PaymentPayload | null {
  if (!raw || raw.trim() === '') return null;
  try {
    const decoded = raw.trim().startsWith('{')
      ? raw
      : typeof atob === 'function'
        ? atob(raw)
        : Buffer.from(raw, 'base64').toString('utf8');
    const obj = JSON.parse(decoded) as Partial<X402PaymentPayload>;
    if (
      obj.x402Version !== 1 ||
      obj.scheme !== 'exact' ||
      !obj.network ||
      !obj.payload?.signature ||
      !isValidTxSignature(obj.payload.signature)
    ) {
      return null;
    }
    return obj as X402PaymentPayload;
  } catch {
    return null;
  }
}

export function encodePaymentHeader(payload: X402PaymentPayload): string {
  const json = JSON.stringify(payload);
  if (typeof btoa === 'function') {
    return btoa(json);
  }
  return Buffer.from(json, 'utf8').toString('base64');
}

/**
 * Verify a transfer via Solana JSON-RPC getTransaction (when RPC configured).
 * Returns true only if signature exists, succeeded, and transfers ≥ lamports to payTo.
 * Alpha: if no RPC URL, returns { ok:false, reason:'no_rpc' } rather than inventing success.
 */
export async function verifySolanaPayment(input: {
  readonly rpcUrl: string | null;
  readonly signature: string;
  readonly payTo: string;
  readonly minLamports: bigint;
  readonly network: X402Network;
}): Promise<
  | { readonly ok: true; readonly slot: number }
  | { readonly ok: false; readonly reason: string }
> {
  if (!isValidTxSignature(input.signature)) {
    return { ok: false, reason: 'invalid_signature' };
  }
  if (!input.rpcUrl) {
    return { ok: false, reason: 'no_rpc' };
  }

  try {
    const res = await fetch(input.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransaction',
        params: [
          input.signature,
          { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, reason: 'rpc_http' };
    const body = (await res.json()) as {
      result?: {
        slot?: number;
        meta?: { err?: unknown; preBalances?: number[]; postBalances?: number[] };
        transaction?: {
          message?: {
            accountKeys?: Array<string | { pubkey?: string }>;
          };
        };
      } | null;
    };
    const tx = body.result;
    if (!tx || tx.meta?.err) return { ok: false, reason: 'tx_failed_or_missing' };

    const keys = tx.transaction?.message?.accountKeys ?? [];
    const pubkeys = keys.map((k) => (typeof k === 'string' ? k : k.pubkey || ''));
    const payIdx = pubkeys.indexOf(input.payTo);
    if (payIdx < 0) return { ok: false, reason: 'payee_not_in_tx' };

    const pre = tx.meta?.preBalances?.[payIdx] ?? 0;
    const post = tx.meta?.postBalances?.[payIdx] ?? 0;
    const delta = BigInt(post - pre);
    if (delta < input.minLamports) {
      return { ok: false, reason: 'insufficient_amount' };
    }
    return { ok: true, slot: tx.slot ?? 0 };
  } catch {
    return { ok: false, reason: 'rpc_error' };
  }
}

export function getMarketplaceRpcUrl(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const raw =
    env.WETDROOL_SOLANA_RPC_URL?.trim() ||
    env.SOLANA_RPC_URL?.trim() ||
    env.NEXT_PUBLIC_SOLANA_RPC_URL?.trim() ||
    '';
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function getDefaultNetwork(
  env: Readonly<Record<string, string | undefined>> = process.env,
): X402Network {
  const c = (env.NEXT_PUBLIC_SOLANA_CLUSTER || env.SOLANA_CLUSTER || 'devnet').toLowerCase();
  return c === 'mainnet-beta' || c === 'mainnet' ? X402_NETWORK_SOLANA_MAINNET : X402_NETWORK_SOLANA_DEVNET;
}

/** Machine reasons returned by verifySolanaPayment / market unlock. */
export type X402PaymentFailureReason =
  | 'invalid_signature'
  | 'no_rpc'
  | 'rpc_http'
  | 'rpc_error'
  | 'tx_failed_or_missing'
  | 'payee_not_in_tx'
  | 'insufficient_amount'
  | 'payment_required'
  | 'payment_unverified'
  | 'unwrap_failed'
  | string;

/**
 * Human-readable, fail-closed copy for unlock UI and API error.message.
 * Never implies success or revenue readiness.
 */
export function describePaymentFailureReason(reason: string): string {
  switch (reason) {
    case 'invalid_signature':
      return 'Transaction signature format is invalid (expected base58 Solana sig).';
    case 'no_rpc':
      return 'No Solana RPC configured — payment verification is fail-closed. Set WETDROOL_SOLANA_RPC_URL, SOLANA_RPC_URL, or NEXT_PUBLIC_SOLANA_RPC_URL.';
    case 'rpc_http':
      return 'Solana RPC returned a non-OK HTTP status while fetching the transaction.';
    case 'rpc_error':
      return 'Solana RPC request failed or timed out. Retry after confirming network access.';
    case 'tx_failed_or_missing':
      return 'Transaction not found or failed on-chain. Wait for confirmation, then retry the same signature.';
    case 'payee_not_in_tx':
      return 'payTo address is not in this transaction. Pay the exact recipient shown in the 402 terms.';
    case 'insufficient_amount':
      return 'Transfer amount to payTo is below the listing price (lamports). Send the full amount in one confirmed tx.';
    case 'payment_required':
      return 'HTTP 402 — pay the exact SOL amount to payTo, then submit the transaction signature.';
    case 'payment_unverified':
      return 'Payment could not be verified. Unlocks stay sealed until RPC confirms a sufficient transfer.';
    case 'unwrap_failed':
      return 'Payment may be ok, but the server could not unwrap the unlock secret (gate key mismatch after restart?).';
    default:
      return `Payment not verified (${reason}). Unlock remains fail-closed.`;
  }
}

/**
 * How unlock was granted — never conflate dev accept with RPC-verified settlement.
 */
export type UnlockVerificationMode = 'rpc_verified' | 'prior_purchase' | 'dev_accept';

export interface UnlockReceipt {
  readonly listingId: string;
  readonly signature: string;
  readonly network: X402Network;
  readonly payTo: string;
  readonly lamports: string;
  readonly verifiedAt: string;
  readonly verification: UnlockVerificationMode;
  /** Present only when RPC verification (or prior purchase that had a slot) recorded one. */
  readonly slot?: number;
  readonly payer?: string;
  /**
   * Always false here: market store is not multi-replica durable commerce.
   * Clients must not treat unlock as revenue-ready settlement proof.
   */
  readonly settlementAuthoritative: false;
  readonly note: string;
}

export function buildUnlockReceipt(input: {
  readonly listingId: string;
  readonly signature: string;
  readonly network: X402Network;
  readonly payTo: string;
  readonly lamports: string;
  readonly verification: UnlockVerificationMode;
  readonly verifiedAt?: string;
  readonly slot?: number;
  readonly payer?: string;
}): UnlockReceipt {
  const verifiedAt = input.verifiedAt ?? new Date().toISOString();
  let note: string;
  switch (input.verification) {
    case 'rpc_verified':
      note =
        'Unlock after RPC-confirmed SOL transfer to payTo. Receipt is local to this host store — not multi-replica settlement.';
      break;
    case 'prior_purchase':
      note =
        'Replay of a signature already recorded on this host. Not proof of global commerce state.';
      break;
    case 'dev_accept':
      note =
        'Dev-only accept (WETDROOL_X402_DEV_ACCEPT=1, non-production, no_rpc). Not real payment verification.';
      break;
  }
  return {
    listingId: input.listingId,
    signature: input.signature,
    network: input.network,
    payTo: input.payTo,
    lamports: input.lamports,
    verifiedAt,
    verification: input.verification,
    ...(input.slot !== undefined ? { slot: input.slot } : {}),
    ...(input.payer !== undefined ? { payer: input.payer } : {}),
    settlementAuthoritative: false,
    note,
  };
}
