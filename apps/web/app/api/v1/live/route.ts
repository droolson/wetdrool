import { LIVE_ROOMS, pageLiveRooms } from '@/lib/live-catalog';
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
  const page = pageLiveRooms(LIVE_ROOMS, {
    nsfwAllowed: !sfwOnly,
    limit,
    offset,
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
    join: 'disabled',
    synthetic: true,
    note: 'Live SFU / chat / tips not online. Cards are product scaffolding.',
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for live room catalog.');
}
