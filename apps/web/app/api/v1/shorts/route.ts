import { probeFeedServiceConfig } from '@/lib/feed-service-config';
import {
  discoveryHonestyNote,
  emptyDiscoveryMessage,
  listShortCategories,
  parseDiscoveryMode,
  parseShortSortMode,
  personalizationStatusFromProbe,
  rankingPolicyNote,
  rankShortsPage,
  SHORT_RANK_WEIGHTS,
  shortSortLabel,
} from '@/lib/short-feed';
import { jsonError, jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
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

  // Optional explicit probe for non-loopback (still never ranks via feed-service).
  const explicitProbe =
    url.searchParams.get('probe') === '1' || url.searchParams.get('probe') === 'true';

  const page = rankShortsPage(mode, { limit, offset, category, sort });
  const empty = page.total === 0;
  const allSynthetic =
    empty || (page.syntheticCount === page.items.length && page.licensedCount === 0);
  const honesty = discoveryHonestyNote(allSynthetic || empty);

  // Config probe only — loopback auto; non-loopback needs explicit allow.
  // Never call feed-service for ranking; personalizationActive stays false.
  const feedProbe = await probeFeedServiceConfig({
    explicit: explicitProbe,
    timeoutMs: 1_200,
  });
  const personalization = personalizationStatusFromProbe(feedProbe);

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
      source: feedProbe.rankingSource,
    },
    personalization,
    feedService: {
      configured: feedProbe.configured,
      origin: feedProbe.origin,
      loopback: feedProbe.loopback,
      wiring: feedProbe.wiring,
      healthz: feedProbe.healthz,
      personalizationActive: false as const,
      note: feedProbe.note,
    },
    note: empty ? emptyDiscoveryMessage(mode, page.category) : honesty,
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for shorts ranking.');
}
