import { getDroolTokenConfig, transferTaxAmount } from '@/lib/drool-token';
import { proModeQuote } from '@/lib/creator-economy';
import { jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(): Response {
  const token = getDroolTokenConfig();
  return jsonOk({
    ok: true,
    token,
    pro: proModeQuote(),
    exampleTaxOn100: transferTaxAmount(100),
  });
}
