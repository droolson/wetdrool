import { describe, expect, it } from 'vitest';

import {
  DROOL_SYMBOL,
  DROOL_TRANSFER_TAX_BPS,
  getDroolTokenConfig,
  getTokenHonestFlags,
  tokenEconomyNote,
  transferTaxAmount,
} from '../lib/drool-token';

describe('drool-token honesty boundary', () => {
  it('keeps mint empty and mint-pending without env', () => {
    const cfg = getDroolTokenConfig({});
    expect(cfg.symbol).toBe(DROOL_SYMBOL);
    expect(cfg.status).toBe('mint-pending');
    expect(cfg.mint).toBe('');
    expect(cfg.tradeUrl).toBe('');
    expect(cfg.transferTaxBps).toBe(DROOL_TRANSFER_TAX_BPS);
    expect(cfg.transferTaxLabel).toBe('3%');
    expect(cfg.robinhood.status).toBe('planned');
    expect(cfg.notClaims.some((c) => c.includes('never labeled'))).toBe(true);
  });

  it('honest flags never invent mint or claim earnings', () => {
    const flags = getTokenHonestFlags(getDroolTokenConfig({}));
    expect(flags.mintExists).toBe(false);
    expect(flags.droolMintInvented).toBe(false);
    expect(flags.earningClaimed).toBe(false);
    expect(flags.tradeExecutable).toBe(false);
    expect(flags.pointsAreNotToken).toBe(true);
    expect(flags.solIsNotDrool).toBe(true);
    expect(flags.transferTaxConfigured).toBe(true);
  });

  it('note states mint does not exist when pending', () => {
    const note = tokenEconomyNote(getDroolTokenConfig({}));
    expect(note).toMatch(/Mint pending/i);
    expect(note).toMatch(/not a live tradeable asset/i);
    expect(note).toMatch(/SOL is never labeled/i);
  });

  it('transfer tax is 3% of amount', () => {
    expect(transferTaxAmount(100)).toBe(3);
    expect(transferTaxAmount(0)).toBe(0);
    expect(transferTaxAmount(-1)).toBe(0);
    expect(transferTaxAmount(Number.NaN)).toBe(0);
  });

  it('only treats a plausible mint length as live', () => {
    const short = getDroolTokenConfig({ NEXT_PUBLIC_DROOL_MINT: 'tooshort' });
    expect(short.status).toBe('mint-pending');
    expect(getTokenHonestFlags(short).mintExists).toBe(false);

    const plausible = '1'.repeat(44);
    const live = getDroolTokenConfig({
      NEXT_PUBLIC_DROOL_MINT: plausible,
      NEXT_PUBLIC_DROOL_TRADE_URL: 'https://example.test/trade',
    });
    expect(live.status).toBe('live');
    expect(live.mint).toBe(plausible);
    expect(live.tradeUrl).toBe('https://example.test/trade');
    const flags = getTokenHonestFlags(live);
    expect(flags.mintExists).toBe(true);
    // Still never invent or claim earnings / trade execution.
    expect(flags.droolMintInvented).toBe(false);
    expect(flags.earningClaimed).toBe(false);
    expect(flags.tradeExecutable).toBe(false);
    expect(tokenEconomyNote(live)).toMatch(/separate product gates/i);
  });
});
