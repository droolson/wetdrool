/**
 * $DROOL token + points settlement boundary.
 *
 * Never invent a mint address. Until the owner pastes the exact Solana mint
 * (and it is recorded in network/solana deployments), status stays mint-pending.
 *
 * RevShare: planned launch rail with a 3% transfer tax configuration target.
 * Robinhood: planned visibility / listing path — not a live listing claim.
 */

export const DROOL_SYMBOL = '$DROOL' as const;
export const DROOL_TOKEN_CONFIG_VERSION = 1 as const;

/** Transfer tax in basis points (300 = 3%). */
export const DROOL_TRANSFER_TAX_BPS = 300 as const;

export const REVSHARE_URL = 'https://revshare.dev/' as const;

export type DroolMintStatus = 'mint-pending' | 'live';

export interface DroolTokenConfig {
  readonly version: typeof DROOL_TOKEN_CONFIG_VERSION;
  readonly symbol: typeof DROOL_SYMBOL;
  readonly status: DroolMintStatus;
  /** Empty until owner pastes exact mint. */
  readonly mint: string;
  readonly tradeUrl: string;
  readonly revshareUrl: typeof REVSHARE_URL;
  readonly transferTaxBps: typeof DROOL_TRANSFER_TAX_BPS;
  readonly transferTaxLabel: '3%';
  readonly robinhood: {
    readonly status: 'planned';
    readonly detail: string;
  };
  readonly uses: readonly string[];
  readonly notClaims: readonly string[];
}

/**
 * Sole client config. Update only after verified mint paste + review.
 */
export function getDroolTokenConfig(
  env: Readonly<Record<string, string | undefined>> = typeof process !== 'undefined'
    ? process.env
    : {},
): DroolTokenConfig {
  const mint = env.NEXT_PUBLIC_DROOL_MINT?.trim() || env.WETDROOL_DROOL_MINT?.trim() || '';
  const tradeUrl = env.NEXT_PUBLIC_DROOL_TRADE_URL?.trim() || '';
  const live = mint.length >= 32 && mint.length <= 64;

  return {
    version: DROOL_TOKEN_CONFIG_VERSION,
    symbol: DROOL_SYMBOL,
    status: live ? 'live' : 'mint-pending',
    mint: live ? mint : '',
    tradeUrl: live ? tradeUrl || `${REVSHARE_URL}` : '',
    revshareUrl: REVSHARE_URL,
    transferTaxBps: DROOL_TRANSFER_TAX_BPS,
    transferTaxLabel: '3%',
    robinhood: {
      status: 'planned',
      detail:
        'Robinhood / Robinhood Chain visibility for $DROOL is planned product work — not a live listing, wallet integration, or price claim.',
    },
    uses: [
      'Creator tips and stream support (when mint is live)',
      'Vanity name.drool settlement rail',
      'Optional points ↔ token bridges under the ad-revenue points cap',
      'RevShare launch + 3% transfer tax as published tokenomics',
    ],
    notClaims: [
      'No mint address is invented in-repo',
      'Points are not $DROOL',
      'SOL/lamports are never labeled $DROOL',
      'Reading feeds does not require holding $DROOL',
    ],
  };
}

export function transferTaxAmount(amount: number, bps = DROOL_TRANSFER_TAX_BPS): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return (amount * bps) / 10_000;
}
