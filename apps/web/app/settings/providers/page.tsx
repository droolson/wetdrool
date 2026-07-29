import type { Metadata } from 'next';
import { ProviderCard, SectionHeading, StatusBadge } from '@wokesocial/ui';

import { getProviderSummaries, type ProviderSummary } from '@/lib/provider-config';
import { SettingsNav } from '@/components/settings-nav';

export const metadata: Metadata = {
  title: 'Provider settings',
  description: 'Inspect which replaceable WokeSocial service endpoints are configured.',
};

export const dynamic = 'force-dynamic';

const PROVIDER_COPY: Readonly<Record<ProviderSummary['id'], string>> = {
  indexer: 'Builds a fast, disposable projection from public protocol events and signed manifests.',
  rpc: 'Reads WokeSocial program state on Solana and submits transactions. No single RPC should be required.',
  gateway:
    'Retrieves content-addressed public media and manifests, with hash verification before display.',
  relay: 'Carries ephemeral notifications, presence, typing, message envelopes, and live signals.',
};

function statusFor(provider: ProviderSummary) {
  if (provider.configuredCount > 0) {
    return {
      label: 'Configured, unchecked',
      tone: 'neutral' as const,
    };
  }
  return {
    label: 'Not configured',
    tone: 'degraded' as const,
  };
}

export default function ProviderSettingsPage() {
  const providers = getProviderSummaries();

  return (
    <div className="providers-page page-shell">
      <header className="providers-hero">
        <SectionHeading
          eyebrow="Replaceable infrastructure"
          level={1}
          title="Know which doors you’re using."
          description={
            <p>
              This foundation reads deployment-owned endpoint configuration and never treats syntax
              as proof of health. Secure in-app editing and failover controls remain planned.
            </p>
          }
        />
        <StatusBadge tone="pending">Read-only foundation</StatusBadge>
      </header>

      <SettingsNav />

      <section className="provider-grid" aria-label="Configured providers">
        {providers.map((provider) => {
          const status = statusFor(provider);
          return (
            <ProviderCard
              detail={`${PROVIDER_COPY[provider.id]} ${provider.detail}`}
              eyebrow={provider.id}
              footer={
                provider.displayEndpoints.length > 0 ? (
                  <ul aria-label={`${provider.label} endpoint origins`}>
                    {provider.displayEndpoints.map((endpoint) => (
                      <li key={endpoint}>
                        <code>{endpoint}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span>Add the corresponding environment value to the deployment.</span>
                )
              }
              key={provider.id}
              name={provider.label}
              status={status.label}
              tone={status.tone}
            />
          );
        })}
      </section>

      <section className="provider-editor" aria-labelledby="provider-editor-title">
        <div>
          <p className="section-kicker">Editing status</p>
          <h2 id="provider-editor-title">No decorative save button.</h2>
          <p>
            Endpoint changes can affect privacy, censorship resistance, and transaction safety. This
            interface stays read-only until secure validation, health checks, local preference
            storage, and rollback are implemented.
          </p>
        </div>
        <fieldset disabled aria-describedby="provider-editor-note">
          <legend>Provider endpoint editor</legend>
          <label htmlFor="indexer-setting">Indexer base URL</label>
          <input id="indexer-setting" placeholder="Managed by WOKESOCIAL_INDEXER_URL" type="url" />
          <button type="button">Saving is not connected</button>
        </fieldset>
        <p id="provider-editor-note">
          A configured endpoint is never labeled healthy until a real request succeeds and its
          response is validated.
        </p>
      </section>

      <section className="provider-safety-note">
        <h2>What changes when you switch?</h2>
        <dl>
          <div>
            <dt>Identity</dt>
            <dd>Should remain rooted in protocol-controlled keys.</dd>
          </div>
          <div>
            <dt>Freshness</dt>
            <dd>Depends on the selected indexer, RPC, and relay.</dd>
          </div>
          <div>
            <dt>Privacy</dt>
            <dd>Each operator sees its own connection and request metadata.</dd>
          </div>
          <div>
            <dt>Policy</dt>
            <dd>Clients and indexers may apply different published lawful rules.</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
