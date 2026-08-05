import { jsonOk, methodNotAllowed, parseLimit, parseOffset } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/notifications
 * Honest empty inbox until auth + relay + preference providers are wired.
 * Never invents mentions, follows, or unread counts.
 */
export function GET(request: Request): Response {
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 24, 48);
  const offset = parseOffset(url.searchParams.get('offset'), 0);
  const filterRaw = url.searchParams.get('filter')?.trim().toLowerCase() ?? null;
  const filter =
    filterRaw === 'mentions' ||
    filterRaw === 'communities' ||
    filterRaw === 'system' ||
    filterRaw === 'all'
      ? filterRaw
      : null;

  return jsonOk({
    ok: true,
    items: [] as const,
    count: 0,
    total: 0,
    limit,
    offset,
    hasMore: false,
    filter: filter === 'all' ? null : filter,
    configured: false as const,
    delivery: 'none' as const,
    unread: 0,
    protocolHistoryReconstructable: true as const,
    inventedSignals: false as const,
    note:
      'Notification inbox is unconfigured: no authenticated session, no relay subscription, and no push channel. Empty is honest — not a silent “all clear” from a live graph.',
  });
}

export function POST(): Response {
  return methodNotAllowed(
    'GET',
    'Use GET for the notification inbox. Marking read / mutating preferences is not implemented here.',
  );
}
