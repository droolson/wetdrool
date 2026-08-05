import { describe, expect, it } from 'vitest';

import { getMarketplaceStoreMeta } from '../lib/marketplace-store';
import { buildRevenueReadiness } from '../lib/revenue-readiness';

describe('revenue readiness', () => {
  it('never claims earnings and stays fail-closed without durable market', () => {
    const report = buildRevenueReadiness({});
    expect(report.ok).toBe(true);
    expect(report.earningClaimed).toBe(false);
    expect(report.revenueReady).toBe(false);
    expect(report.checks.droolMint).toBe('does-not-exist');
    expect(report.checks.marketplaceStore).toBe('memory-ephemeral');
    expect(report.checks.marketplaceGate).toBe('ephemeral');
    expect(report.checks.roomsStore).toBe('memory-ephemeral');
    expect(report.checks.roomsDurableAcrossRestart).toBe(false);
    expect(report.storeKinds.multiReplicaSafe).toBe(false);
    expect(report.storeKinds.marketplace).toBe('memory-ephemeral');
    expect(report.storeKinds.rooms).toBe('memory-ephemeral');
    expect(report.storeKinds.authStatusPath).toBe('/api/v1/auth/status');
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

  it('reports file store without claiming multi-replica revenue readiness', () => {
    const report = buildRevenueReadiness({
      WETDROOL_SOLANA_RPC_URL: 'https://api.devnet.solana.com',
      WETDROOL_MARKETPLACE_DATA_PATH: '/tmp/wetdrool-market-test.json',
      WETDROOL_MARKETPLACE_GATE_SECRET: 'stable-gate-secret-ok',
      WETDROOL_ROOMS_DATA_PATH: '/tmp/wetdrool-rooms-test.json',
    });
    expect(report.checks.marketplaceStore).toBe('file-local');
    expect(report.checks.marketplaceGate).toBe('env-stable');
    expect(report.checks.roomsStore).toBe('file-local');
    expect(report.checks.roomsDurableAcrossRestart).toBe(true);
    expect(report.storeKinds.marketplace).toBe('file-local');
    expect(report.storeKinds.rooms).toBe('file-local');
    expect(report.storeKinds.multiReplicaSafe).toBe(false);
    expect(report.revenueReady).toBe(false);
    expect(report.blockers.some((b) => b.id === 'market_store_ephemeral')).toBe(false);
    expect(report.blockers.some((b) => b.id === 'market_store_not_multi_replica')).toBe(true);
  });

  it('aligns storeKinds with marketplace store meta (replica-unsafe)', () => {
    const env = {
      WETDROOL_MARKETPLACE_DATA_PATH: '/tmp/wetdrool-market-ready.json',
      WETDROOL_MARKETPLACE_GATE_SECRET: 'stable-gate-secret-ok',
    };
    const meta = getMarketplaceStoreMeta(env);
    const report = buildRevenueReadiness(env);
    expect(report.storeKinds.marketplace).toBe(meta.kind);
    expect(report.storeKinds.multiReplicaSafe).toBe(false);
    expect(meta.multiReplicaSafe).toBe(false);
    expect(meta.revenueReady).toBe(false);
    expect(report.revenueReady).toBe(false);
  });
});
