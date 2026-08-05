import {
  discoveryHonestyNote,
  emptyDiscoveryMessage,
  listShortCategories,
  parseDiscoveryMode,
  parseShortSortMode,
  personalizationStatus,
  rankingPolicyNote,
  rankShortsPage,
  SHORT_RANK_WEIGHTS,
  shortSortLabel,
} from '@/lib/short-feed';
import { jsonError, jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const mode = parseDiscoveryMode(url.searchParams.get('mode'));
  const sort = parseShortSortMode(url.searchParams.get('sort'));
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const categoryRaw = url.searchParams.get('category')?.trim().toLowerCase() ?? '';
  const known = listShortCategories();
  const category =
    categoryRaw && categoryRaw !== 'all' && known.includes(categoryRaw) ? categoryRaw : null;

  if (categoryRaw && categoryRaw !== 'all' && !category) {
    return jsonError(400, 'invalid_category', `Unknown category. Known: ${known.join(', ')}`);
  }

  const page = rankShortsPage(mode, { limit, offset, category, sort });
  const empty = page.total === 0;
  const allSynthetic =
    empty || (page.syntheticCount === page.items.length && page.licensedCount === 0);
  const honesty = discoveryHonestyNote(allSynthetic || empty);
  const personalization = personalizationStatus();

  return jsonOk({
    ok: true,
    mode: page.mode,
    sort: page.sort,
    sortLabel: shortSortLabel(page.sort),
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
    empty,
    emptyMessage: empty ? emptyDiscoveryMessage(mode, page.category) : null,
    ranking: {
      name: 'droolrank-lite',
      sort: page.sort,
      weights: SHORT_RANK_WEIGHTS,
      note: rankingPolicyNote(),
    },
    personalization,
    note: empty ? emptyDiscoveryMessage(mode, page.category) : honesty,
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for shorts ranking.');
}
