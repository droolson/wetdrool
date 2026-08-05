import { LIVE_ROOMS } from '@/lib/live-catalog';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request: Request): Response {
  const url = new URL(request.url);
  const nsfwParam = url.searchParams.get('nsfw');
  // nsfw=0|false → SFW-only listing; default returns full catalog (client age-gates).
  const sfwOnly = nsfwParam === '0' || nsfwParam === 'false';
  const rooms = sfwOnly ? LIVE_ROOMS.filter((r) => !r.nsfw) : LIVE_ROOMS;

  return jsonOk({
    ok: true,
    rooms,
    count: rooms.length,
    join: 'disabled',
    synthetic: true,
    note: 'Live SFU / chat / tips not online. Cards are product scaffolding.',
  });
}

export function POST(): Response {
  return jsonError(405, 'method_not_allowed', 'Use GET for live room catalog.');
}
