import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildPaymentRequirements,
  buildUnlockReceipt,
  describePaymentFailureReason,
  encodePaymentHeader,
  getMarketplaceRpcUrl,
  isValidSolanaAddress,
  isValidTxSignature,
  lamportsFromSol,
  parsePaymentHeader,
  parseX402Network,
  solFromLamports,
  verifySolanaPayment,
} from '../lib/x402';

describe('x402 helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('converts sol/lamports', () => {
    expect(lamportsFromSol(0.01).toString()).toBe('10000000');
    expect(solFromLamports(1_000_000_000)).toBe(1);
  });

  it('parses x402 network ids and cluster aliases', () => {
    expect(parseX402Network(null)).toBeNull();
    expect(parseX402Network('')).toBeNull();
    expect(parseX402Network('solana:devnet')).toBe('solana:devnet');
    expect(parseX402Network('devnet')).toBe('solana:devnet');
    expect(parseX402Network('solana:mainnet')).toBe('solana:mainnet');
    expect(parseX402Network('mainnet-beta')).toBe('solana:mainnet');
    expect(parseX402Network('MAINNET')).toBe('solana:mainnet');
    expect(parseX402Network('ethereum')).toBeNull();
    expect(parseX402Network('solana:testnet')).toBeNull();
  });

  it('validates addresses and signatures shape', () => {
    expect(isValidSolanaAddress('11111111111111111111111111111111')).toBe(true);
    expect(isValidSolanaAddress('nope')).toBe(false);
    expect(
      isValidTxSignature(
        '5'.repeat(88),
      ),
    ).toBe(true);
  });

  it('builds requirements and round-trips payment header', () => {
    const req = buildPaymentRequirements({
      network: 'solana:devnet',
      payTo: '11111111111111111111111111111111',
      lamports: 10_000_000n,
      resource: '/api/v1/market/lst_test',
      description: 'drop',
      mimeType: 'text/plain',
      listingId: 'lst_test',
      contentHash: 'abc',
    });
    expect(req.maxAmountRequired).toBe('10000000');
    expect(req.extra?.e2ee).toBe(true);

    const header = encodePaymentHeader({
      x402Version: 1,
      scheme: 'exact',
      network: 'solana:devnet',
      payload: { signature: '5'.repeat(88) },
    });
    const parsed = parsePaymentHeader(header);
    expect(parsed?.payload.signature.length).toBe(88);
  });

  it('fail-closes payment verify when RPC is missing', async () => {
    const result = await verifySolanaPayment({
      rpcUrl: null,
      signature: '5'.repeat(88),
      payTo: '11111111111111111111111111111111',
      minLamports: 1n,
      network: 'solana:devnet',
    });
    expect(result).toEqual({ ok: false, reason: 'no_rpc' });
  });

  it('fail-closes payment verify on invalid signature shape', async () => {
    const result = await verifySolanaPayment({
      rpcUrl: 'https://api.devnet.solana.com',
      signature: 'not-a-sig',
      payTo: '11111111111111111111111111111111',
      minLamports: 1n,
      network: 'solana:devnet',
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  it('accepts verified transfer when payee balance increased enough', async () => {
    const payTo = '11111111111111111111111111111111';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          result: {
            slot: 42,
            meta: {
              err: null,
              preBalances: [0, 1_000_000],
              postBalances: [0, 11_000_000],
            },
            transaction: {
              message: {
                accountKeys: ['payer1111111111111111111111111111111', payTo],
              },
            },
          },
        }),
      })),
    );

    const result = await verifySolanaPayment({
      rpcUrl: 'https://rpc.example',
      signature: '5'.repeat(88),
      payTo,
      minLamports: 10_000_000n,
      network: 'solana:devnet',
    });
    expect(result).toEqual({ ok: true, slot: 42 });
  });

  it('rejects insufficient transfer amount', async () => {
    const payTo = '11111111111111111111111111111111';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          result: {
            slot: 7,
            meta: {
              err: null,
              preBalances: [0, 1_000_000],
              postBalances: [0, 1_500_000],
            },
            transaction: {
              message: {
                accountKeys: ['payer1111111111111111111111111111111', payTo],
              },
            },
          },
        }),
      })),
    );

    const result = await verifySolanaPayment({
      rpcUrl: 'https://rpc.example',
      signature: '5'.repeat(88),
      payTo,
      minLamports: 10_000_000n,
      network: 'solana:devnet',
    });
    expect(result).toEqual({ ok: false, reason: 'insufficient_amount' });
  });

  it('reads marketplace RPC URL only from allow-listed env keys', () => {
    expect(getMarketplaceRpcUrl({})).toBeNull();
    expect(getMarketplaceRpcUrl({ SOLANA_RPC_URL: 'https://api.devnet.solana.com' })).toBe(
      'https://api.devnet.solana.com/',
    );
    expect(getMarketplaceRpcUrl({ SOLANA_RPC_URL: 'ftp://evil' })).toBeNull();
  });

  it('maps fail-closed payment reasons to actionable copy', () => {
    expect(describePaymentFailureReason('no_rpc')).toMatch(/No Solana RPC configured/i);
    expect(describePaymentFailureReason('insufficient_amount')).toMatch(/below the listing price/i);
    expect(describePaymentFailureReason('payee_not_in_tx')).toMatch(/payTo address/i);
    expect(describePaymentFailureReason('weird_custom')).toMatch(/weird_custom/);
  });

  it('builds honest unlock receipts that never claim settlement authority', () => {
    const rpc = buildUnlockReceipt({
      listingId: 'lst_a',
      signature: '5'.repeat(88),
      network: 'solana:devnet',
      payTo: '11111111111111111111111111111111',
      lamports: '10000000',
      verification: 'rpc_verified',
      slot: 99,
    });
    expect(rpc.settlementAuthoritative).toBe(false);
    expect(rpc.verification).toBe('rpc_verified');
    expect(rpc.slot).toBe(99);
    expect(rpc.note).toMatch(/not multi-replica/i);

    const dev = buildUnlockReceipt({
      listingId: 'lst_a',
      signature: '5'.repeat(88),
      network: 'solana:devnet',
      payTo: '11111111111111111111111111111111',
      lamports: '10000000',
      verification: 'dev_accept',
    });
    expect(dev.settlementAuthoritative).toBe(false);
    expect(dev.note).toMatch(/Dev-only/i);
  });
});
