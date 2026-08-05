import {
  buildEmptyNotificationsInbox,
  jsonOk,
  methodNotAllowed,
  parseLimit,
  parseOffset,
  type NotificationsFilter,
} from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/notifications?limit=&offset=&filter=
 * Honest empty inbox until auth + relay + preference providers are wired.
 * Never invents mentions, follows, or unread counts.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const filterRaw = url.searchParams.get('filter')?.trim().toLowerCase() ?? null;
  let filter: NotificationsFilter | null = null;
  if (
    filterRaw === 'mentions' ||
    filterRaw === 'communities' ||
    filterRaw === 'system'
  ) {
    filter = filterRaw;
  }

  return jsonOk(buildEmptyNotificationsInbox({ limit, offset, filter }));
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for the notification inbox. Marking read / mutating preferences is not implemented here.',
  );
}
