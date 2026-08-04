import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { DroolAiChat } from '@/components/drool-ai-chat';
import { getDroolAiRuntimeConfig } from '@/lib/drool-ai';
import { getAiIntegrationReport } from '@/lib/drooly-bridge';

export const metadata: Metadata = {
  title: 'Drool AI',
  description:
    'Grok-like on-platform AI for WetDrool. Frontend chat now; Grok 4.5 backend when your API key is set. Companions use Grok 4.5 + Mythic/Hermes.',
};

export const dynamic = 'force-dynamic';

export default function DroolAiPage() {
  const runtime = getDroolAiRuntimeConfig();
  const integration = getAiIntegrationReport();

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Grok 4.5 ready · key optional</StatusBadge>}
        eyebrow="Drool AI"
        title="A Grok-like assistant in your feed."
      >
        <p>
          Platform chat is frontend-first (see the floating <strong>Ask Drool</strong> dock). Wire{' '}
          <code>WETDROOL_GROK_API_KEY</code> / xAI when you have it. Companions and org agents run on{' '}
          <strong>Grok 4.5</strong> + <strong>Mythic/Hermes</strong>. Self-hosted Drool model tiers
          remain optional later.
        </p>
      </AppPageHeader>

      <DroolAiChat
        runtime={
          runtime.kind === 'configured'
            ? { endpoint: runtime.endpoint, kind: 'configured' }
            : { detail: runtime.detail, kind: 'unavailable' }
        }
      />

      <section className="product-card" aria-labelledby="ai-integration-title">
        <div className="section-heading">
          <p className="section-kicker">Product boundary</p>
          <h2 id="ai-integration-title">WetDrool AI surfaces and DROOLY.AI</h2>
        </div>
        <p>
          Cross-origin session sharing:{' '}
          <strong>{String(integration.crossOriginSessionSharing)}</strong>. Private by default:{' '}
          <strong>{String(integration.privateByDefault)}</strong>. Sibling products stay on
          separate origins — no shared wallet cookies or adult-feed bleed.
        </p>
        <div className="product-card-grid" aria-label="AI integration surfaces">
          {integration.surfaces.map((surface) => (
            <InfoCard
              key={surface.id}
              eyebrow={surface.sameProduct ? 'WetDrool' : 'Sibling'}
              title={surface.label}
              tone={surface.adultContext ? 'coral' : 'sky'}
            >
              <p>{surface.detail}</p>
              <p>
                {surface.sameProduct ? (
                  <ButtonLink href={surface.href} variant="secondary">
                    Open {surface.label}
                  </ButtonLink>
                ) : (
                  <a href={surface.href} rel="noopener noreferrer" target="_blank">
                    Open {surface.label} ↗
                  </a>
                )}
              </p>
            </InfoCard>
          ))}
        </div>
        <ul className="e2ee-status__details">
          {integration.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
