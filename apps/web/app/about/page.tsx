import type { Metadata } from 'next';
import { ButtonLink, SectionHeading } from '@socially-woke/ui';

export const metadata: Metadata = {
  title: 'About',
  description: 'The values, inclusion commitments, and product posture behind Socially Woke.',
};

const INCLUSION_COMMITMENTS = [
  'Chosen names stand apart from legal names.',
  'Pronouns can be custom, multiple, private, or absent.',
  'Gender and sexuality are optional and never inferred.',
  'Chosen-family labels do not force a legal or biological model.',
  'Current views protect against deadnaming while history is disclosed honestly.',
  'Localization never assumes English identity language.',
] as const;

export default function AboutPage() {
  return (
    <article className="editorial-page">
      <header className="editorial-hero page-shell">
        <p className="section-kicker">About Socially Woke</p>
        <h1>
          A place to be fully seen—
          <em>without being fully exposed.</em>
        </h1>
        <p>
          Socially Woke is a trans-owned, LGBTQ+ affirming social network in development. Its
          ambition is simple to say and hard to fake: make a beautiful public square whose people
          can leave with their identity, relationships, and choices intact.
        </p>
      </header>

      <section className="editorial-split page-shell" aria-labelledby="why-title">
        <div>
          <p className="section-kicker">Why this exists</p>
          <h2 id="why-title">Belonging should not be rented.</h2>
        </div>
        <div className="prose-stack">
          <p>
            Modern social products are often welcoming only until their incentives change. A policy
            shifts, an algorithm becomes opaque, an account disappears, and a whole community
            discovers that its history lived at someone else’s discretion.
          </p>
          <p>
            Decentralization alone does not solve harassment, exclusion, or confusing technology.
            Socially Woke pairs portable protocol state with layered moderation, consent controls,
            clear recovery, and an interface that does not turn ordinary people into blockchain
            operators.
          </p>
        </div>
      </section>

      <section className="inclusion-panel">
        <div className="page-shell">
          <SectionHeading
            eyebrow="Inclusion is behavior"
            title="Affirmation lives in the controls, not a rainbow wash."
            description={
              <p>
                The product is designed to respect how people name themselves, decide what to
                reveal, and protect their history.
              </p>
            }
          />
          <ul>
            {INCLUSION_COMMITMENTS.map((commitment, index) => (
              <li key={commitment}>
                <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                {commitment}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="principle-grid page-shell" aria-labelledby="principles-title">
        <div className="principle-grid__intro">
          <p className="section-kicker">Non-negotiables</p>
          <h2 id="principles-title">The promises shape the plumbing.</h2>
        </div>
        <article>
          <h3>No proprietary source of truth</h3>
          <p>
            A third party should be able to interpret signed public objects and rebuild a useful
            network view without a private flagship API.
          </p>
        </article>
        <article>
          <h3>No sensitive data onchain</h3>
          <p>
            Email, private locations, messages, recovery secrets, and moderation evidence never
            belong in permanent public state.
          </p>
        </article>
        <article>
          <h3>No cosmetic decentralization</h3>
          <p>
            Ordinary posts are not NFTs, the product does not need a speculative token, and service
            replacement must be tested instead of asserted.
          </p>
        </article>
        <article>
          <h3>No fake completion</h3>
          <p>
            Experimental work stays labeled. A polished control never claims a transaction, upload,
            deletion, or encryption that did not happen.
          </p>
        </article>
      </section>

      <section className="editorial-cta page-shell">
        <div>
          <p className="section-kicker">See the boundaries</p>
          <h2>Trust grows when authority has a label.</h2>
        </div>
        <div>
          <ButtonLink href="/protocol">Explore the protocol</ButtonLink>
          <ButtonLink href="/safety" variant="secondary">
            Explore the safety model
          </ButtonLink>
        </div>
      </section>
    </article>
  );
}
