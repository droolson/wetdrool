import type { Metadata } from 'next';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { ProductEvents } from '@/components/product-events';

export const metadata: Metadata = {
  title: 'Events',
  description:
    'Honest event discovery via product API — synthetic fixtures only until a verified calendar and attendance projection exist.',
};

export default function EventsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Events via product API</StatusBadge>}
        eyebrow="Events"
        title="Gather with context, not exposure."
      >
        <p>
          Events combine public discovery with sensitive attendance, location, accessibility, and
          safety choices. Rows appear only after a successful <code>/api/v1/events</code> response —
          never as silent local re-fanout. HTTP errors (including 404) fail closed to empty.
        </p>
      </AppPageHeader>

      <section className="event-agenda" aria-labelledby="event-agenda-title">
        <div>
          <p className="section-kicker">An event object should carry</p>
          <h2 id="event-agenda-title">Enough to arrive informed.</h2>
        </div>
        <dl>
          <div>
            <dt>When</dt>
            <dd>Timezone-aware start, end, recurrence, and cancellation state</dd>
          </div>
          <div>
            <dt>Where</dt>
            <dd>Public venue, limited-access details, online room, or intentionally undisclosed</dd>
          </div>
          <div>
            <dt>Access</dt>
            <dd>Mobility, sensory, language, cost, age, and content information</dd>
          </div>
        </dl>
      </section>

      <ProductEvents />
    </div>
  );
}
