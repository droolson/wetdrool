import type { Metadata } from 'next';
import { InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Reports and appeals',
  description: 'Reporting and appeal safeguards without collecting unencrypted evidence.',
};

export default function ReportSettingsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="unavailable">Submission disabled</StatusBadge>}
        eyebrow="Reports and appeals"
        title="Evidence deserves its own privacy boundary."
      >
        <p>
          Reports may contain highly sensitive context. They must be encrypted to an authorized,
          policy-scoped reviewer before leaving the device.
        </p>
      </AppPageHeader>
      <SettingsNav />

      <section className="report-workspace" aria-labelledby="report-workspace-title">
        <div className="report-flow">
          <p className="section-kicker">Required delivery path</p>
          <h2 id="report-workspace-title">Collect less. Encrypt first. Authorize every reader.</h2>
          <ol>
            <li>
              <strong>Scope</strong>
              <span>Choose personal, community, service, or protocol authority.</span>
            </li>
            <li>
              <strong>Minimize</strong>
              <span>Include only evidence necessary for the stated policy.</span>
            </li>
            <li>
              <strong>Encrypt</strong>
              <span>Seal evidence to current authorized reviewer keys.</span>
            </li>
            <li>
              <strong>Receipt</strong>
              <span>Return a signed report ID, policy, retention, and appeal route.</span>
            </li>
          </ol>
        </div>

        <form aria-describedby="report-disabled-note" className="report-form">
          <fieldset disabled>
            <legend>Report draft</legend>
            <label htmlFor="report-authority">Reviewing authority</label>
            <select id="report-authority">
              <option>Choose after authorization is resolved</option>
            </select>
            <label htmlFor="report-reason">Policy reason</label>
            <select id="report-reason">
              <option>Choose a published policy reason</option>
            </select>
            <label htmlFor="report-context">Minimum necessary context</label>
            <textarea
              id="report-context"
              placeholder="Evidence entry is disabled until encryption is configured."
              rows={5}
            />
            <button type="button">Encrypted submission unavailable</button>
          </fieldset>
          <p id="report-disabled-note">
            This form does not store or transmit text, screenshots, message contents, or
            identifiers.
          </p>
        </form>
      </section>

      <section className="appeal-boundary" aria-labelledby="appeal-title">
        <div>
          <p className="section-kicker">Appeals</p>
          <h2 id="appeal-title">A decision needs a route back.</h2>
          <p>
            Appeals require an authenticated report receipt, the issuing authority’s current policy,
            a separate authorized review path, and encrypted supporting evidence. No appeal can be
            started in this build.
          </p>
        </div>
        <button aria-describedby="appeal-disabled" disabled type="button">
          Start appeal unavailable
        </button>
        <p className="visually-hidden" id="appeal-disabled">
          Appeal authorization and encrypted evidence services are not connected.
        </p>
      </section>

      <section className="product-card-grid" aria-label="Report safeguards">
        <InfoCard eyebrow="Evidence" title="Private by default" tone="plum">
          <p>Message contents and sensitive attachments never become public moderation objects.</p>
        </InfoCard>
        <InfoCard eyebrow="Authority" title="Reviewers are scoped" tone="coral">
          <p>
            A community moderator does not automatically gain service-wide or protocol authority.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Retention" title="Deletion has a policy" tone="sky">
          <p>Encrypted evidence receipts disclose retention, access, and appeal expectations.</p>
        </InfoCard>
      </section>
    </div>
  );
}
