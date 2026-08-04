import type { Metadata } from 'next';
import { InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { LocalSafetyList } from '@/components/local-safety-list';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Blocks and mutes',
  description: 'A reversible device-local safety list with explicit protocol limitations.',
};

export default function BlockSettingsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="neutral">Local filtering available</StatusBadge>}
        eyebrow="Blocks and mutes"
        title="A boundary should say where it applies."
      >
        <p>
          This build can hide exact identity IDs from the connected home feed on one device. It
          cannot publish a portable block or control what another service delivers.
        </p>
      </AppPageHeader>
      <SettingsNav />
      <LocalSafetyList />
      <section className="product-card-grid" aria-label="Block and mute distinctions">
        <InfoCard eyebrow="Hide" title="Local feed presentation" tone="plum">
          <p>
            Matching identity posts are removed after this browser loads its local preference list.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Mute" title="Future live signals" tone="coral">
          <p>
            Mute intent is saved, but no relay is connected to enforce typing or presence
            suppression.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Block" title="Portable relationship state" tone="sky">
          <p>
            A real protocol block needs authenticated authority, signing, finality, and indexer
            replay.
          </p>
        </InfoCard>
      </section>
    </div>
  );
}
