import { describe, expect, it } from 'vitest';

import { buildRevenueReadiness } from '../lib/revenue-readiness';

describe('revenue readiness', () => {
  it('never claims earnings and stays fail-closed without durable market', () => {
    const report = buildRevenueReadiness({});
    expect(report.ok).toBe(true);
    expect(report.earningClaimed).toBe(false);
    expect(report.revenueReady).toBe(false);
    expect(report.checks.droolMint).toBe('does-not-exist');
    expect(report.checks.marketplaceStore).toBe('memory-ephemeral');
    expect(report.blockers.some((b) => b.id === 'rpc_missing')).toBe(true);
    expect(report.blockers.some((b) => b.id === 'market_store_ephemeral')).toBe(true);
  });

  it('marks rpc configured when env provides URL', () => {
    const report = buildRevenueReadiness({
      WETDROOL_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
      NEXT_PUBLIC_SOLANA_CLUSTER: 'devnet',
    });
    expect(report.checks.rpcConfigured).toBe(true);
    expect(report.revenueReady).toBe(false);
    expect(report.blockers.some((b) => b.id === 'rpc_missing')).toBe(false);
  });
});
