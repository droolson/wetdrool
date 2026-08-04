import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Group messages',
  description: 'Group messaging readiness without simulated encryption or participants.',
};

export default function GroupMessagesPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="unavailable">Group keys unavailable</StatusBadge>}
        eyebrow="Group messages"
        title="A private room needs a real key schedule."
      >
        <p>
          Group messaging must authenticate membership changes, rotate sender keys, and encrypt
          every message and attachment before a relay sees it.
        </p>
      </AppPageHeader>

      <section className="group-key-map" aria-labelledby="group-key-title">
        <div>
          <p className="section-kicker">Membership transition</p>
          <h2 id="group-key-title">Every arrival and departure changes the room.</h2>
        </div>
        <div className="group-key-map__steps">
          <span>Signed membership</span>
          <span aria-hidden="true">→</span>
          <span>Key rotation</span>
          <span aria-hidden="true">→</span>
          <span>Encrypted envelope</span>
        </div>
      </section>

      <StatePanel
        action={
          <ButtonLink href="/messages" variant="secondary">
            Back to messages
          </ButtonLink>
        }
        eyebrow="No conversation created"
        title="There are no sample participants or simulated locks."
        tone="empty"
      >
        <p>
          Authenticated identity, group membership, device keys, encrypted storage, relay delivery,
          and abuse controls are all required before this page can create or read a room.
        </p>
      </StatePanel>

      <section className="product-card-grid" aria-label="Group messaging safeguards">
        <InfoCard eyebrow="Membership" title="Changes are authenticated" tone="plum">
          <p>Only a current authorized member can propose a change under the room’s policy.</p>
        </InfoCard>
        <InfoCard eyebrow="Forward secrecy" title="Departures rotate keys" tone="coral">
          <p>Removed devices cannot decrypt future messages with an old sender key.</p>
        </InfoCard>
        <InfoCard eyebrow="Consent" title="Invites begin as requests" tone="sky">
          <p>Unknown groups do not gain notification or inbox access automatically.</p>
        </InfoCard>
      </section>
    </div>
  );
}
