import type { Metadata } from 'next';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import {
  SiteBuilder,
  SiteBuilderInfoCards,
  SiteBuilderUnavailableNote,
} from '@/components/site-builder';
import { getDroolAiRuntimeConfig } from '@/lib/drool-ai';

export const metadata: Metadata = {
  title: 'Sites',
  description:
    'Reserve the wetdrool.com subdomain your .drool handle maps to and draft a site with the Drool AI builder.',
};

export const dynamic = 'force-dynamic';

export default function SitesPage() {
  const runtime = getDroolAiRuntimeConfig();
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Drafting preview</StatusBadge>}
        eyebrow="Sites"
        title="Every .drool name is a website waiting to happen."
      >
        <p>
          Your finalized handle is a whole identity bundle: the name{' '}
          <code className="inline-identifier">alexbtc420.drool</code>, the subdomain{' '}
          <code className="inline-identifier">alexbtc420.wetdrool.com</code>, and the encrypted inbox{' '}
          <code className="inline-identifier">alexbtc420@wetdrool.com</code> — all keyed to the same
          onchain claim. The Drool AI builder turns a short brief into your site. Three presets:
          Crypto Project, Personal Blog, and Work Portfolio.
        </p>
      </AppPageHeader>

      <SiteBuilderUnavailableNote />

      <SiteBuilder
        runtime={
          runtime.kind === 'configured'
            ? { endpoint: runtime.endpoint, kind: 'configured' }
            : { detail: runtime.detail, kind: 'unavailable' }
        }
      />

      <SiteBuilderInfoCards />
    </div>
  );
}
