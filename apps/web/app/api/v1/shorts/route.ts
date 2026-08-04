import { rankShorts, type DiscoveryMode } from '@/lib/short-feed';
import { jsonError, jsonOk, parseLimit } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseMode(raw: string | null): DiscoveryMode {
  if (raw === 'straight' || raw === 'pride' || raw === 'all') return raw;
  return 'all';
}

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const mode = parseMode(url.searchParams.get('mode'));
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const items = rankShorts(mode, limit);
  return jsonOk({
    ok: true,
    mode,
    limit,
    count: items.length,
    items,
    synthetic: true as const,
    note: 'Abstract fixtures until licensed, consented media pipeline is live.',
  });
}

export function POST(): Response {
  return jsonError(405, 'method_not_allowed', 'Use GET for shorts ranking.');
}
