import {
  getDroolTokenConfig,
  getTokenHonestFlags,
  tokenEconomyNote,
  transferTaxAmount,
} from '@/lib/drool-token';
import { proModeQuote } from '@/lib/creator-economy';
import { jsonOk, methodNotAllowed } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/token
 * Honest economy boundary: no invented mint, no earnings claims.
 */
export function GET(): Response {
  const token = getDroolTokenConfig();
  const pro = proModeQuote();

  return jsonOk({
    ok: true,
    token,
    pro,
    exampleTaxOn100: transferTaxAmount(100),
    honest: getTokenHonestFlags(token),
    note: tokenEconomyNote(token),
  });
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for token economy config. No mint or trade endpoint.',
  );
}
