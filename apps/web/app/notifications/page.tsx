import type { Metadata } from 'next';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { NotificationsInbox } from '@/components/notifications-inbox';

export const metadata: Metadata = {
  title: 'Notifications',
  description:
    'Honest attention inbox — empty until product API delivery and authenticated session exist.',
};

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ readonly filter?: string | string[] }>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const raw = params?.filter;
  const initialFilter = Array.isArray(raw) ? (raw[0] ?? null) : (raw ?? null);

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Inbox via product API</StatusBadge>}
        eyebrow="Attention inbox"
        title="Only the signals you invited."
      >
        <p>
          Notifications should explain what happened, who can substantiate it, and which preference
          controls the interruption. Rows appear only after a successful{' '}
          <code>/api/v1/notifications</code> response — never as fixtures.
        </p>
      </AppPageHeader>
      <NotificationsInbox initialFilter={initialFilter} />
    </div>
  );
}
