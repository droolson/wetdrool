/**
 * Honest production / revenue readiness for WetDrool web.
 * Never report earning capability without verified payment rails.
 */

import { getDefaultNetwork, getMarketplaceRpcUrl } from './x402';
import { listListings } from './marketplace-store';

export type ReadinessLevel = 'local-only' | 'preview' | 'production-shell' | 'revenue-capable';

export interface RevenueBlocker {
  readonly id: string;
  readonly severity: 'critical' | 'major' | 'minor';
  readonly message: string;
}

export interface RevenueReadinessReport {
  readonly ok: true;
  readonly product: 'wetdrool';
  readonly canonicalOrigin: 'https://wetdrool.com';
  readonly checkedAt: string;
  readonly level: ReadinessLevel;
  /** True only when payment verification can run and store is durable enough to sell. */
  readonly revenueReady: false | true;
  /** Explicit: never invent live earnings. */
  readonly earningClaimed: false;
  readonly network: ReturnType<typeof getDefaultNetwork>;
  readonly checks: {
    readonly rpcConfigured: boolean;
    readonly marketplaceListings: number;
    readonly marketplaceStore: 'memory-ephemeral';
    readonly droolMint: 'does-not-exist';
    readonly founderMediaPath: null;
  };
  readonly blockers: readonly RevenueBlocker[];
  readonly nextActions: readonly string[];
}

export function buildRevenueReadiness(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RevenueReadinessReport {
  const rpc = getMarketplaceRpcUrl(env);
  const network = getDefaultNetwork(env);
  const listingCount = listListings().length;
  const blockers: RevenueBlocker[] = [];

  if (!rpc) {
    blockers.push({
      id: 'rpc_missing',
      severity: 'critical',
      message:
        'No Solana RPC URL (set WETDROOL_SOLANA_RPC_URL or NEXT_PUBLIC_SOLANA_RPC_URL). x402 verification returns no_rpc.',
    });
  }

  blockers.push({
    id: 'market_store_ephemeral',
    severity: 'critical',
    message:
      'Marketplace listings live in process memory. Multi-instance/cold-start Vercel loses listings and receipts — not production commerce.',
  });

  blockers.push({
    id: 'domain_unverified_here',
    severity: 'major',
    message:
      'This process cannot prove wetdrool.com DNS is attached. Confirm public HTTPS + /api/v1/status on the canonical host.',
  });

  if (network !== 'solana:mainnet') {
    blockers.push({
      id: 'not_mainnet',
      severity: 'major',
      message: `Payment network is ${network}. Real customer revenue expects solana:mainnet with operator payTo risk accepted.`,
    });
  }

  blockers.push({
    id: 'no_auto_earnings',
    severity: 'minor',
    message:
      'No automated revenue ledger. Do not display fake MRR. Count only verified SOL unlock receipts once durable store exists.',
  });

  const critical = blockers.filter((b) => b.severity === 'critical').length;
  const revenueReady = false; // fail-closed until durable market + RPC + mainnet ops proven elsewhere
  void critical;
  void rpc;

  let level: ReadinessLevel = 'local-only';
  if (rpc) level = 'preview';
  // production-shell / revenue-capable require external evidence; never auto-promote here.

  return {
    ok: true,
    product: 'wetdrool',
    canonicalOrigin: 'https://wetdrool.com',
    checkedAt: new Date().toISOString(),
    level,
    revenueReady,
    earningClaimed: false,
    network,
    checks: {
      rpcConfigured: Boolean(rpc),
      marketplaceListings: listingCount,
      marketplaceStore: 'memory-ephemeral',
      droolMint: 'does-not-exist',
      founderMediaPath: null,
    },
    blockers,
    nextActions: [
      'Deploy apps/web to Vercel with monorepo install/build (docs/ops/DEPLOY_WEB.md)',
      'Attach wetdrool.com DNS to that project',
      'Set WETDROOL_SOLANA_RPC_URL for payment verification',
      'Replace marketplace-store Map with durable backend before selling',
      'Create first paid listing with operator payTo and verify a real unlock',
    ],
  };
}
