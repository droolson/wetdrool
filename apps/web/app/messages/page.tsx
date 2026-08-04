import type { Metadata } from 'next';
import { ButtonLink, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { getE2eeCapabilityReport } from '@/lib/e2ee-status';

export const metadata: Metadata = {
  title: 'Messages',
  description: 'Private pairwise E2EE status — no simulated inbox.',
};

export default function MessagesPage() {
  const e2ee = getE2eeCapabilityReport();

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">E2EE package · web not wired</StatusBadge>}
        eyebrow="Private messages"
        title="Private by construction."
      >
        <p>
          Protocol <code className="inline-identifier">{e2ee.protocol}</code>. Server-readable
          fallback: <strong>{String(e2ee.serverReadableFallback)}</strong>. Private by default:{' '}
          <strong>{String(e2ee.privateByDefault)}</strong>.
        </p>
      </AppPageHeader>

      <section className="e2ee-status" aria-labelledby="e2ee-status-title">
        <h2 id="e2ee-status-title">Capability report</h2>
        <dl className="e2ee-status__grid">
          <div>
            <dt>Pairwise</dt>
            <dd>
              <StatusBadge tone="pending">{e2ee.pairwise}</StatusBadge>
            </dd>
          </div>
          <div>
            <dt>Group rooms</dt>
            <dd>
              <StatusBadge tone="unavailable">{e2ee.groupRooms}</StatusBadge>
            </dd>
          </div>
        </dl>
        <ul className="e2ee-status__details">
          {e2ee.details.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="hero__actions">
          <ButtonLink href="/settings/privacy" variant="secondary">
            Privacy controls
          </ButtonLink>
          <ButtonLink href="/messages/group" variant="quiet">
            Group readiness
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}
