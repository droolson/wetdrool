import {
  LIVE_JOIN_STATUS,
  LIVE_ROOMS,
  emptyLiveRoomsMessage,
  listLiveTags,
  pageLiveRooms,
} from '@/lib/live-catalog';
import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const nsfwParam = url.searchParams.get('nsfw');
  // nsfw=0|false → SFW-only listing; default returns full catalog (client age-gates).
  const sfwOnly = nsfwParam === '0' || nsfwParam === 'false';
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const tagParam = url.searchParams.get('tag');
  const page = pageLiveRooms(LIVE_ROOMS, {
    nsfwAllowed: !sfwOnly,
    tag: tagParam,
    limit,
    offset,
  });
  const empty = page.total === 0;
  const emptyMessage = emptyLiveRoomsMessage({
    tag: page.tag,
    nsfwAllowed: !sfwOnly,
    total: page.total,
  });

  return jsonOk({
    ok: true,
    rooms: page.items,
    count: page.items.length,
    total: page.total,
    limit: page.limit,
    offset: page.offset,
    hasMore: page.hasMore,
    nextOffset: page.hasMore ? page.offset + page.items.length : null,
    tag: page.tag,
    tags: listLiveTags(LIVE_ROOMS),
    join: LIVE_JOIN_STATUS,
    empty,
    emptyMessage,
    synthetic: true,
    note: 'Live SFU / chat / tips not online. Cards are product scaffolding. join:disabled.',
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for live room catalog.');
}
