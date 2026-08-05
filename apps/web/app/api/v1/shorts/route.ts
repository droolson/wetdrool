import {
  listShortCategories,
  parseDiscoveryMode,
  rankingPolicyNote,
  rankShortsPage,
  SHORT_RANK_WEIGHTS,
} from '@/lib/short-feed';
import { jsonError, jsonOk, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const mode = parseDiscoveryMode(url.searchParams.get('mode'));
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const categoryRaw = url.searchParams.get('category')?.trim().toLowerCase() ?? '';
  const known = listShortCategories();
  const category =
    categoryRaw && categoryRaw !== 'all' && known.includes(categoryRaw) ? categoryRaw : null;

  if (categoryRaw && categoryRaw !== 'all' && !category) {
    return jsonError(400, 'invalid_category', `Unknown category. Known: ${known.join(', ')}`);
  }

  const page = rankShortsPage(mode, { limit, offset, category });
  const allSynthetic = page.items.length === 0 || page.items.every((item) => item.synthetic);

  return jsonOk({
    ok: true,
    mode: page.mode,
    category: page.category,
    limit: page.limit,
    offset: page.offset,
    count: page.items.length,
    total: page.total,
    hasMore: page.hasMore,
    items: page.items,
    synthetic: allSynthetic,
    syntheticCount: page.syntheticCount,
    licensedCount: page.licensedCount,
    categories: known,
    ranking: {
      name: 'droolrank-lite',
      weights: SHORT_RANK_WEIGHTS,
      note: rankingPolicyNote(),
    },
    note: allSynthetic
      ? 'Abstract fixtures until licensed, consented media pipeline is live. Labels are synthetic on purpose.'
      : 'Mixed corpus: synthetic fixtures plus licensed media. Third-party adult media still needs consent + licensing.',
  });
}

export function POST(): Response {
  return jsonError(405, 'method_not_allowed', 'Use GET for shorts ranking.');
}
