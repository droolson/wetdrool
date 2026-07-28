import type { Metadata } from 'next';
import { ButtonLink, SectionHeading } from '@socially-woke/ui';

export const metadata: Metadata = {
  title: 'Safety',
  description:
    'A layered safety model with immediate personal controls, scoped authority, and appeals.',
};

const SAFETY_LAYERS = [
  {
    title: 'Yours',
    label: 'Personal controls',
    copy: 'Block, mute, filter, limit replies and mentions, control messages, preview shared blocklists, and switch on anti-dogpile safety mode.',
  },
  {
    title: 'Ours',
    label: 'Community moderation',
    copy: 'Published rules, scoped roles, time-bounded actions, restricted evidence, audit trails, conflict checks, and independent appeals.',
  },
  {
    title: 'This door',
    label: 'Client and indexer policy',
    copy: 'Each operator publishes what it labels, hides, or declines to serve—and identifies that treatment as service-scoped.',
  },
  {
    title: 'The wire',
    label: 'Protocol validity',
    copy: 'Malformed payloads, invalid signatures, replay, unauthorized mutation, and technical abuse are rejected narrowly and transparently.',
  },
] as const;

export default function SafetyPage() {
  return (
    <article className="safety-page">
      <header className="safety-hero">
        <div className="page-shell">
          <p className="section-kicker">Safety without fog</p>
          <h1>
            Protect people.
            <em>Label the power.</em>
          </h1>
          <p>
            Every moderation action should answer three questions: who made the decision, where does
            it apply, and how can it be reviewed?
          </p>
        </div>
      </header>

      <section className="safety-layers page-shell" aria-labelledby="safety-layers-title">
        <SectionHeading
          eyebrow="Layered authority"
          title="Immediate control. Scoped enforcement. Real appeal."
          description={
            <p>
              Decentralization is not an excuse to abandon abuse prevention, consent, or legal
              obligations. Central convenience is not an excuse to claim universal authority.
            </p>
          }
        />
        <h2 className="visually-hidden" id="safety-layers-title">
          Safety layers
        </h2>
        <ol>
          {SAFETY_LAYERS.map((layer, index) => (
            <li key={layer.title}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <div>
                <p>{layer.label}</p>
                <h3>{layer.title}</h3>
                <p>{layer.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="safety-spotlight">
        <div className="page-shell">
          <div>
            <p className="section-kicker">Identity-targeted harm</p>
            <h2>Context matters. Dignity is not optional.</h2>
          </div>
          <div className="prose-stack">
            <p>
              Reports can identify targeted repeated deadnaming, misgendering, outing threats,
              doxxing, nonconsensual intimate media, and coordinated harassment without requiring a
              legal name or medical proof.
            </p>
            <p>
              Current views use a person’s current chosen name. If immutable signed history is
              intentionally opened for a legitimate review, the older identity data appears behind a
              clear historical-data warning.
            </p>
          </div>
        </div>
      </section>

      <section className="report-flow page-shell" aria-labelledby="report-title">
        <SectionHeading
          eyebrow="Evidence with consent"
          title="A report should disclose exactly what you chose."
          description={
            <p>
              Private messages stay encrypted until a reporter intentionally selects specific
              evidence and confirms the preview.
            </p>
          }
        />
        <ol id="report-title">
          <li>
            <span>1</span>
            <div>
              <h3>Select</h3>
              <p>Choose the object, category, and only the context needed.</p>
            </div>
          </li>
          <li>
            <span>2</span>
            <div>
              <h3>Preview</h3>
              <p>See the exact messages, attachments, people, and metadata.</p>
            </div>
          </li>
          <li>
            <span>3</span>
            <div>
              <h3>Track</h3>
              <p>Receive a private receipt, scoped outcome, and appeal path.</p>
            </div>
          </li>
        </ol>
      </section>

      <section className="deletion-language page-shell">
        <p className="section-kicker">Words with boundaries</p>
        <div>
          <h2>Hide is not delete. Suppress is not erase.</h2>
          <p>
            Safety notices distinguish a personal hide, community removal, operator suppression,
            provider deletion request, signed tombstone, key destruction, and protocol rejection.
            Permanent or independently replicated copies may remain even after official clients stop
            serving them.
          </p>
        </div>
      </section>

      <section className="editorial-cta page-shell">
        <div>
          <p className="section-kicker">Foundation status</p>
          <h2>Safety controls are specified, not yet simulated.</h2>
        </div>
        <div>
          <ButtonLink href="/home">View current feed state</ButtonLink>
          <ButtonLink href="/about" variant="secondary">
            Read our principles
          </ButtonLink>
        </div>
      </section>
    </article>
  );
}
