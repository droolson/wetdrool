import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Events',
  description: 'Portable event discovery awaiting verified event and attendance projections.',
};

export default function EventsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Event projection unavailable</StatusBadge>}
        eyebrow="Events"
        title="Gather with context, not exposure."
      >
        <p>
          Events combine public discovery with sensitive attendance, location, accessibility, and
          safety choices. Each field needs an explicit audience.
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

      <StatePanel
        action={
          <ButtonLink href="/communities" variant="secondary">
            Browse community readiness
          </ButtonLink>
        }
        eyebrow="No event directory"
        title="No fictional RSVPs or nearby events are shown."
        tone="empty"
      >
        <p>
          A compatible event projection, viewer-aware field visibility, timezone handling, and
          attendance privacy must be connected before this page can list or join an event.
        </p>
      </StatePanel>

      <section className="product-card-grid" aria-label="Event privacy commitments">
        <InfoCard eyebrow="Attendance" title="RSVP visibility is separate" tone="plum">
          <p>Joining an event never has to publish attendance to the entire network.</p>
        </InfoCard>
        <InfoCard eyebrow="Location" title="Reveal it at the right time" tone="coral">
          <p>Private venue details can remain limited to approved attendees.</p>
        </InfoCard>
        <InfoCard eyebrow="Cancellation" title="Changes are signed state" tone="sky">
          <p>Clients distinguish updates and cancellation from disappearance or stale indexing.</p>
        </InfoCard>
      </section>
    </div>
  );
}
