import { describe, expect, it } from 'vitest';

import {
  buildPaymentRequirements,
  encodePaymentHeader,
  isValidSolanaAddress,
  isValidTxSignature,
  lamportsFromSol,
  parsePaymentHeader,
  solFromLamports,
} from '../lib/x402';

describe('x402 helpers', () => {
  it('converts sol/lamports', () => {
    expect(lamportsFromSol(0.01).toString()).toBe('10000000');
    expect(solFromLamports(1_000_000_000)).toBe(1);
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
});
