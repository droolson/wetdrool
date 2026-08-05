import { getDroolTokenConfig, transferTaxAmount } from '@/lib/drool-token';
import { proModeQuote } from '@/lib/creator-economy';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/token
 * Honest economy boundary: no invented mint, no earnings claims.
 */
export function GET(): Response {
  const token = getDroolTokenConfig();
  const pro = proModeQuote();
  const mintLive = token.status === 'live' && token.mint.length > 0;

  return jsonOk({
    ok: true,
    token,
    pro,
    exampleTaxOn100: transferTaxAmount(100),
    honest: {
      mintExists: mintLive,
      /** Explicit product rule: no $DROOL mint is shipped or invented in-repo. */
      droolMintInvented: false,
      earningClaimed: false,
      pointsAreNotToken: true,
      solIsNotDrool: true,
      transferTaxConfigured: token.transferTaxBps === 300,
      tradeExecutable: false,
    },
    note: mintLive
      ? 'Mint address configured from env. Trade execution and listings still require separate product gates.'
      : 'Mint pending: no contract address. $DROOL is not a live tradeable asset in this deployment. Points ≠ token. SOL is never labeled $DROOL.',
  });
}

export function POST(): Response {
  return jsonError(405, 'method_not_allowed', 'Use GET for token economy config. No mint or trade endpoint.');
}
