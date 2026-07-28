import type { Metadata } from 'next';
import { ButtonLink, InfoCard, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';

export const metadata: Metadata = {
  title: 'Developers',
  description: 'The exact public web contracts currently consumed by WokeSocial.',
};

const CONTRACTS = [
  {
    method: 'GET',
    path: '/v1/feed/home?limit=20',
    purpose: 'Typed home-feed response with indexer checkpoint and verification metadata.',
    state: 'Consumed when an indexer is configured',
  },
  {
    method: 'GET',
    path: '/v1/posts/:id',
    purpose: 'One typed post response with content and anchor proof metadata.',
    state: 'Consumed when an indexer is configured',
  },
] as const;

export default function DevelopersPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Narrow connected surface</StatusBadge>}
        eyebrow="Developers"
        title="Build another door to the same network."
      >
        <p>
          The flagship web app consumes a small typed indexer contract today. Planned routes do not
          become API promises until implementations and drift checks exist.
        </p>
      </AppPageHeader>

      <section className="developer-contracts" aria-labelledby="developer-contracts-title">
        <div>
          <p className="section-kicker">Current web consumers</p>
          <h2 id="developer-contracts-title">Two reads, no browser writes.</h2>
          <p>
            Base URLs come from deployment-owned provider configuration. The web layer validates
            response shape and never treats a successful HTTP status alone as verified content.
          </p>
        </div>
        <div className="developer-contract-list">
          {CONTRACTS.map((contract) => (
            <article key={contract.path}>
              <div>
                <span>{contract.method}</span>
                <code>{contract.path}</code>
              </div>
              <p>{contract.purpose}</p>
              <small>{contract.state}</small>
            </article>
          ))}
        </div>
      </section>

      <section className="developer-principles" aria-label="Developer contract principles">
        <InfoCard eyebrow="Canonical" title="One byte sequence to sign" tone="plum">
          <p>
            Portable objects need versioned schemas, deterministic encoding, domain separation, and
            golden fixtures.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Replaceable" title="Providers are configuration" tone="coral">
          <p>
            RPC, indexer, gateway, relay, storage, and feed services remain replaceable
            conveniences.
          </p>
        </InfoCard>
        <InfoCard eyebrow="Fail closed" title="Unknown data stops the checkpoint" tone="sky">
          <p>
            Clients and indexers reject unsupported versions and never fabricate fields to keep
            moving.
          </p>
        </InfoCard>
      </section>

      <div className="developer-actions">
        <ButtonLink href="/protocol">Read protocol boundaries</ButtonLink>
        <ButtonLink href="/settings/providers" variant="secondary">
          Inspect configured providers
        </ButtonLink>
        <ButtonLink href="/status" variant="quiet">
          Open status →
        </ButtonLink>
      </div>
    </div>
  );
}
