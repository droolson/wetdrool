import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { getDroolTokenConfig } from '@/lib/drool-token';
import { getE2eeCapabilityReport } from '@/lib/e2ee-status';
import { getMeshCapabilityReport } from '@/lib/mesh-status';
import { FAME_SEED } from '@/lib/hall-of-fame';

export const metadata: Metadata = {
  title: 'CEO dashboard',
  description: 'Owner monitor for Droolhouse — agent CEO runs ops; human owns equity.',
};

export const dynamic = 'force-dynamic';

export default function CeoDashboardPage() {
  const token = getDroolTokenConfig();
  const e2ee = getE2eeCapabilityReport();
  const mesh = getMeshCapabilityReport();

  return (
    <div className="product-page page-shell ceo-dash">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Owner view · agent CEO</StatusBadge>}
        eyebrow="Droolhouse"
        title="CEO dashboard"
      >
        <p>
          You are the <strong>Owner</strong>. Day-to-day is the Paperclip{' '}
          <strong>CEO agent</strong> (Hermes + Grok 4.5 / xAI OAuth). OpenAI OAuth is retired for
          this company.
        </p>
      </AppPageHeader>

      <section className="ceo-dash__grid" aria-label="Runtime">
        <article className="ceo-dash__card">
          <h2>Inference</h2>
          <ul>
            <li>Primary: Grok 4.5 · xai-oauth</li>
            <li>Fallback: Grok 4.3 · xai-oauth</li>
            <li>Forbidden: OpenAI OAuth / openai-codex</li>
          </ul>
        </article>
        <article className="ceo-dash__card">
          <h2>$DROOL</h2>
          <p>Status: {token.status}</p>
          <p>Tax: {token.transferTaxLabel}</p>
          <p>Mint: {token.mint || '—'}</p>
          <Link href="/token">Economy →</Link>
        </article>
        <article className="ceo-dash__card">
          <h2>Privacy stack</h2>
          <p>E2EE pairwise: {e2ee.pairwise}</p>
          <p>Mesh production: {String(mesh.productionMeshDeployed)}</p>
          <Link href="/messages">Messages →</Link>
        </article>
        <article className="ceo-dash__card">
          <h2>Hall of Fame (seed top)</h2>
          <ol>
            {FAME_SEED.slice(0, 3).map((e) => (
              <li key={e.handle}>
                @{e.handle} · {e.lifetimePoints.toLocaleString()} pts
              </li>
            ))}
          </ol>
          <Link href="/fame">Grind board →</Link>
        </article>
      </section>

      <section aria-labelledby="swarm-title">
        <h2 id="swarm-title">Coding swarm</h2>
        <ul className="ceo-dash__swarm">
          <li>
            <code>code-web</code> high — apps/web
          </li>
          <li>
            <code>code-protocol</code> high — protocol/program
          </li>
          <li>
            <code>code-services</code> high — backend apps
          </li>
          <li>
            <code>code-economy</code> medium — points/fame
          </li>
          <li>
            <code>code-edge</code> low — CF/Vercel/HOF pushes
          </li>
        </ul>
        <p className="field-help">
          Import pack: <code>paperclip/droolhouse</code>. GitHub push machine: branch{' '}
          <code>hall-of-fame</code> · Actions every ~5 min.
        </p>
      </section>

      <p>
        <Link href="/hub">Hub</Link> · <Link href="/docs">Docs</Link> ·{' '}
        <Link href="/status">Status</Link>
      </p>
    </div>
  );
}
