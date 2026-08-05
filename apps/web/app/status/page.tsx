import type { Metadata } from 'next';
import Link from 'next/link';
import { ProviderCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { MeshStatusPanel } from '@/components/mesh-status-panel';
import { getProviderSummaries, type ProviderSummary } from '@/lib/provider-config';
import { buildRevenueReadiness } from '@/lib/revenue-readiness';

export const metadata: Metadata = {
  title: 'System status',
  description: 'Configuration visibility without unverified uptime or revenue claims.',
};

export const dynamic = 'force-dynamic';

const PROVIDER_PURPOSE: Readonly<Record<ProviderSummary['id'], string>> = {
  gateway: 'Retrieves public content-addressed objects after integrity checks.',
  indexer: 'Projects public protocol events into typed read models.',
  relay: 'Carries ephemeral presence, notifications, envelopes, and live signals.',
  rpc: 'Reads chain state and submits transactions when a signed write is available.',
};

export default function StatusPage() {
  const providers = getProviderSummaries();
  const configured = providers.filter((provider) => provider.configuredCount > 0).length;
  const revenue = buildRevenueReadiness();

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="verified">Web route rendering</StatusBadge>}
        eyebrow="Status"
        title="Configuration is not uptime."
      >
        <p>
          This page reports which provider origins are present in deployment configuration. It does
          not ping them, infer health from syntax, or publish an operational SLA. It never invents
          revenue or a <code>$DROOL</code> mint.
        </p>
      </AppPageHeader>

      <section className="status-summary" aria-labelledby="mesh-product-readiness-title">
        <div>
          <p className="section-kicker">Mesh product readiness</p>
          <h2 id="mesh-product-readiness-title">Not a live peer mesh</h2>
          <p className="field-help">
            Client strip over <code>/api/v1/mesh</code> — configuration honesty only. See{' '}
            <Link href="/mesh">/mesh</Link> for the full panel.
          </p>
          <MeshStatusPanel compact />
        </div>
      </section>

      <section className="status-summary" aria-labelledby="revenue-readiness-title">
        <div>
          <p className="section-kicker">Revenue readiness · fail-closed</p>
          <h2 id="revenue-readiness-title">
            {revenue.revenueReady ? 'Revenue rails ready' : 'Not revenue-ready'}
          </h2>
          <p>
            Level <strong>{revenue.level}</strong> · network <strong>{revenue.network}</strong> ·
            earning claimed: <strong>false</strong> · store{' '}
            <strong>{revenue.checks.marketplaceStore}</strong>
          </p>
          <ul>
            {revenue.blockers.slice(0, 4).map((b) => (
              <li key={b.id}>
                <strong>{b.severity}</strong>: {b.message}
              </li>
            ))}
          </ul>
          <p>
            Machine JSON: <Link href="/api/v1/status">/api/v1/status</Link> · deploy runbook in{' '}
            <code>docs/ops/DEPLOY_WEB.md</code>
          </p>
        </div>
      </section>

      <section className="status-summary" aria-labelledby="status-summary-title">
        <div>
          <p className="section-kicker">Local observation</p>
          <h2 id="status-summary-title">
            {configured} of {providers.length} provider categories configured
          </h2>
        </div>
        <dl>
          <div>
            <dt>Web shell</dt>
            <dd>Rendering this response</dd>
          </div>
          <div>
            <dt>Provider health</dt>
            <dd>Not checked</dd>
          </div>
          <div>
            <dt>Incident feed</dt>
            <dd>Not configured</dd>
          </div>
        </dl>
      </section>

      <section className="provider-grid" aria-label="Provider configuration status">
        {providers.map((provider) => (
          <ProviderCard
            detail={`${PROVIDER_PURPOSE[provider.id]} ${provider.detail}`}
            eyebrow={provider.id}
            footer={
              provider.displayEndpoints.length > 0
                ? provider.displayEndpoints.join(' · ')
                : 'No endpoint origin configured'
            }
            key={provider.id}
            name={provider.label}
            status={provider.configuredCount > 0 ? 'Configured, unchecked' : 'Not configured'}
            tone={provider.configuredCount > 0 ? 'neutral' : 'degraded'}
          />
        ))}
      </section>

      <section className="status-legend" aria-labelledby="status-legend-title">
        <h2 id="status-legend-title">What these labels mean</h2>
        <dl>
          <div>
            <dt>Rendering</dt>
            <dd>The current web request completed.</dd>
          </div>
          <div>
            <dt>Configured</dt>
            <dd>An endpoint origin passed configuration validation; health remains unknown.</dd>
          </div>
          <div>
            <dt>Verified response</dt>
            <dd>A route accepted a typed response and shows its reported proof metadata.</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
