import type { Metadata } from 'next';
import { InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { LocalExportPanel } from '@/components/local-export-panel';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Export data',
  description: 'Export browser-local settings while account export adapters remain unavailable.',
};

export default function ExportSettingsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="neutral">Local export available</StatusBadge>}
        eyebrow="Export"
        title="Take what this device actually has."
      >
        <p>
          A small browser export works now. A full portable account archive still needs
          authenticated protocol reconstruction, verified storage retrieval, and private-data
          authorization.
        </p>
      </AppPageHeader>
      <SettingsNav />
      <LocalExportPanel />
      <section className="product-card-grid" aria-label="Full export requirements">
        <InfoCard eyebrow="Public state" title="Rebuild from protocol events" tone="plum">
          <p>
            Identity, graph, community, and public-object references need a declared checkpoint.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Stored objects" title="Verify every retrieved hash" tone="coral">
          <p>
            Profile, post, and media manifests are included only after content integrity checks.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Private data" title="Authenticate and decrypt locally" tone="sky">
          <p>Messages, evidence, and recovery material require separate consent and key access.</p>
        </InfoCard>
      </section>
    </div>
  );
}
