import type { Metadata } from 'next';
import { ButtonLink, SectionHeading, StatusBadge } from '@wokesocial/ui';

export const metadata: Metadata = {
  title: 'Protocol',
  description:
    'How WokeSocial separates verifiable protocol state from replaceable service conveniences.',
};

const LAYERS = [
  {
    number: '01',
    title: 'WokeNet proof',
    label: 'Compact and verifiable',
    copy: 'Identity roots, delegations, selected public relationships, hashes, references, governance state, payments, and tombstones belong in compact protocol state—not raw media or private information.',
  },
  {
    number: '02',
    title: 'Signed content',
    label: 'Content-addressed',
    copy: 'Versioned manifests carry body and media references, language, warnings, accessibility fields, audience, hashes, and signatures. Deletion-compatible storage remains the default.',
  },
  {
    number: '03',
    title: 'Open projection',
    label: 'Rebuildable',
    copy: 'Indexers validate events and manifests into fast search and feed views. Their databases are disposable projections, never the canonical social network.',
  },
  {
    number: '04',
    title: 'Human experience',
    label: 'Replaceable and humane',
    copy: 'Clients, relays, gateways, media workers, and recommendation providers make the network pleasant. People can replace them without replacing who they are.',
  },
] as const;

export default function ProtocolPage() {
  return (
    <article className="protocol-page">
      <header className="protocol-hero page-shell">
        <div>
          <StatusBadge tone="pending">Architecture target</StatusBadge>
          <h1>
            Proof where it counts.
            <em>Choice everywhere else.</em>
          </h1>
        </div>
        <div>
          <p>
            WokeSocial separates durable protocol facts from fast, replaceable services. That makes
            the network independently verifiable without asking every screen to feel like a block
            explorer.
          </p>
          <p className="protocol-hero__note">
            This page describes the intended protocol. Live writes remain disabled until the SDK,
            programs, and real-validator tests pass.
          </p>
        </div>
      </header>

      <section className="layer-section page-shell" aria-labelledby="layers-title">
        <SectionHeading
          eyebrow="Four layers"
          title="Canonical is a narrow word on purpose."
          description={
            <p>
              The less a protocol must own, the more operators can improve the experience without
              capturing it.
            </p>
          }
        />
        <ol id="layers-title">
          {LAYERS.map((layer) => (
            <li key={layer.number}>
              <span>{layer.number}</span>
              <div>
                <p>{layer.label}</p>
                <h2>{layer.title}</h2>
              </div>
              <p>{layer.copy}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="replaceability-section">
        <div className="page-shell">
          <SectionHeading
            align="center"
            eyebrow="Replaceability test"
            title="If it goes away, what survives?"
          />
          <div className="replaceability-grid">
            <article>
              <p className="section-kicker">RPC unavailable</p>
              <h3>Reading degrades, identity survives.</h3>
              <p>
                The client tries configured alternatives and explains freshness. Cached public
                reading should not become a blank screen.
              </p>
            </article>
            <article>
              <p className="section-kicker">Indexer unavailable</p>
              <h3>Convenience pauses, proof remains.</h3>
              <p>
                Another operator can replay protocol events and verified manifests. The flagship
                projection is not the source of truth.
              </p>
            </article>
            <article>
              <p className="section-kicker">Client disappears</p>
              <h3>Your identity opens elsewhere.</h3>
              <p>
                Public specifications and portable provider settings let a compatible client
                continue without a proprietary interpretation service.
              </p>
            </article>
          </div>
        </div>
      </section>

      <section className="permanence-callout page-shell">
        <div className="permanence-callout__mark" aria-hidden="true">
          !
        </div>
        <div>
          <p className="section-kicker">Permanence deserves consent</p>
          <h2>A content hash is not a promise of erasure.</h2>
          <p>
            Ordinary publishing is designed to prefer deletion-compatible storage. Permanent
            providers require item-specific consent. Tombstones tell compliant clients to stop
            serving content, while receipts must explain which independent or immutable copies may
            remain.
          </p>
        </div>
      </section>

      <section className="editorial-cta page-shell">
        <div>
          <p className="section-kicker">Inspect the boundary</p>
          <h2>Provider status is visible, not implied.</h2>
        </div>
        <div>
          <ButtonLink href="/settings/providers">Review providers</ButtonLink>
          <ButtonLink href="/home" variant="secondary">
            Open the feed
          </ButtonLink>
        </div>
      </section>
    </article>
  );
}
