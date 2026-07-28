import type { Metadata } from 'next';
import { InfoCard, StatusBadge } from '@socially-woke/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Delete account data',
  description: 'Deletion boundaries and no-op controls until authenticated adapters exist.',
};

export default function DeleteSettingsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="unavailable">Deletion disabled</StatusBadge>}
        eyebrow="Deletion"
        title="Say exactly what can disappear."
      >
        <p>
          Public protocol history, content storage, private service data, and local browser data
          have different deletion mechanics. One button cannot honestly promise all four.
        </p>
      </AppPageHeader>
      <SettingsNav />

      <section className="deletion-ledger" aria-labelledby="deletion-ledger-title">
        <div>
          <p className="section-kicker">Deletion ledger</p>
          <h2 id="deletion-ledger-title">Four scopes, four receipts.</h2>
        </div>
        <dl>
          <div>
            <dt>Local browser</dt>
            <dd>Drafts and preferences can be cleared through browser controls.</dd>
          </div>
          <div>
            <dt>Service data</dt>
            <dd>Requires authenticated operator deletion and a retention receipt.</dd>
          </div>
          <div>
            <dt>Public storage</dt>
            <dd>
              Availability depends on provider policy; permanent media cannot be promised erased.
            </dd>
          </div>
          <div>
            <dt>Protocol state</dt>
            <dd>Tombstones and rotations supersede state without rewriting finalized history.</dd>
          </div>
        </dl>
      </section>

      <div className="destructive-noop" role="note">
        <div>
          <p className="section-kicker">No-op boundary</p>
          <h2>No deletion request can be submitted.</h2>
          <p>
            Identity authentication, exact-scope review, export-first confirmation, provider
            receipts, transaction finality, and post-action verification are not connected.
          </p>
        </div>
        <button aria-describedby="delete-disabled-note" disabled type="button">
          Delete unavailable
        </button>
        <p id="delete-disabled-note">
          Pressing this disabled control changes no browser, service, storage, or protocol data.
        </p>
      </div>

      <section className="product-card-grid" aria-label="Deletion safeguards">
        <InfoCard eyebrow="Preview" title="Exact targets first" tone="plum">
          <p>
            Every account, object, provider, and device scope must be listed before confirmation.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Recovery" title="Export before irreversible action" tone="coral">
          <p>A verified archive and cooling-off period protect against accidental loss.</p>
        </InfoCard>
        <InfoCard eyebrow="Proof" title="Receipts, then re-check" tone="sky">
          <p>
            Success requires provider receipts and independent verification that each scope changed.
          </p>
        </InfoCard>
      </section>
    </div>
  );
}
