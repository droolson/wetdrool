import type { Metadata } from 'next';
import { StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import {
  SiteBuilder,
  SiteBuilderInfoCards,
  SiteBuilderUnavailableNote,
} from '@/components/site-builder';
import { getWokeAiRuntimeConfig } from '@/lib/woke-ai';

export const metadata: Metadata = {
  title: 'Sites',
  description:
    'Reserve the woke.social subdomain your .woke handle maps to and draft a site with the Woke AI builder.',
};

export const dynamic = 'force-dynamic';

export default function SitesPage() {
  const runtime = getWokeAiRuntimeConfig();
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Drafting preview</StatusBadge>}
        eyebrow="Sites"
        title="Every .woke name is a website waiting to happen."
      >
        <p>
          Your finalized handle is a whole identity bundle: the name{' '}
          <code className="inline-identifier">alexbtc420.woke</code>, the subdomain{' '}
          <code className="inline-identifier">alexbtc420.woke.social</code>, and the encrypted inbox{' '}
          <code className="inline-identifier">alexbtc420@woke.social</code> — all keyed to the same
          onchain claim. The Woke AI builder turns a short brief into your site. Three presets:
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
