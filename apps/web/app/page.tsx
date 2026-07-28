import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, SectionHeading, StatusBadge } from '@wokesocial/ui';

export const metadata: Metadata = {
  title: 'Own your voice',
  description:
    'Meet the foundation of a social network built around portable identity, inspectable feeds, and layered safety.',
};

const VALUES = [
  {
    marker: '01',
    title: 'Identity that leaves with you',
    copy: 'A handle is for people. Signed protocol state is for portability. Wallet details stay out of the way until a decision truly needs them.',
  },
  {
    marker: '02',
    title: 'Feeds with an explanation',
    copy: 'Choose chronological, following, community, or compatible third-party feeds—and ask why any recommendation appeared.',
  },
  {
    marker: '03',
    title: 'Safety with visible authority',
    copy: 'Personal, community, service, and protocol controls stay distinct, so every action can say who made it and where it applies.',
  },
] as const;

const FOUNDATION_LAYERS = [
  {
    label: 'Identity',
    title: 'Portable roots',
    copy: 'Designed for passkeys, linked wallets, delegated devices, and recovery without putting email onchain.',
    tone: 'plum',
  },
  {
    label: 'Content',
    title: 'Signed manifests',
    copy: 'Public content is designed to carry a signature, hash, audience, accessibility data, and an honest storage policy.',
    tone: 'coral',
  },
  {
    label: 'Choice',
    title: 'Replaceable services',
    copy: 'RPCs, gateways, indexers, relays, and feed providers are conveniences—not the owner of your identity.',
    tone: 'sky',
  },
] as const;

export default function MarketingPage() {
  return (
    <>
      <section className="hero page-shell" aria-labelledby="hero-title">
        <div className="hero__copy">
          <StatusBadge tone="pending">Foundation preview</StatusBadge>
          <p className="hero__eyebrow">The social web, awake.</p>
          <h1 id="hero-title">
            Own your voice.
            <span>Choose your crowd.</span>
            <em>Keep the keys.</em>
          </h1>
          <p className="hero__lede">
            WokeSocial is building an affirming social network where identity is portable, feeds are
            inspectable, and safety does not require one company to become the world’s speech
            authority.
          </p>
          <div className="hero__actions">
            <ButtonLink href="/home">Inspect the network feed</ButtonLink>
            <ButtonLink href="/protocol" variant="secondary">
              See how it is designed
            </ButtonLink>
          </div>
          <ul className="hero__promises" aria-label="Product commitments">
            <li>No platform token</li>
            <li>No wallet wall</li>
            <li>No opaque success states</li>
          </ul>
        </div>

        <div className="hero-object" aria-label="WokeSocial design principles">
          <div className="hero-object__halo" aria-hidden="true" />
          <article className="signal-card signal-card--front">
            <div className="signal-card__top">
              <span className="signal-card__avatar" aria-hidden="true">
                S
              </span>
              <div>
                <p>WokeSocial principle</p>
                <span>Designed in public</span>
              </div>
              <StatusBadge tone="neutral">Concept</StatusBadge>
            </div>
            <blockquote>
              “A social graph should feel like a community, not a hostage situation.”
            </blockquote>
            <div className="signal-card__proof">
              <span>Readable by people</span>
              <span>Verifiable by clients</span>
            </div>
          </article>
          <article className="signal-card signal-card--back" aria-hidden="true">
            <p>Feed recipe</p>
            <strong>People you chose</strong>
            <span className="recipe-line recipe-line--long" />
            <span className="recipe-line recipe-line--medium" />
            <span className="recipe-line recipe-line--short" />
          </article>
          <p className="hero-object__caption">
            Original CSS artwork. No borrowed brand interface or stock illustration.
          </p>
        </div>
      </section>

      <section className="commitment-strip" aria-label="Foundation status">
        <div className="page-shell">
          <p>
            <strong>Honest by default.</strong> The web foundation is visible now. Protocol writes,
            uploads, and transactions remain disabled until their real SDK paths and tests exist.
          </p>
          <Link href="/settings/providers">Review provider status →</Link>
        </div>
      </section>

      <section className="values-section page-shell">
        <SectionHeading
          eyebrow="Built around people"
          title={
            <>
              Familiar where it helps.
              <br />
              Radically portable where it matters.
            </>
          }
          description={
            <p>
              You should not need a crypto vocabulary to join a conversation, protect yourself, or
              understand what happens when you press publish.
            </p>
          }
        />
        <div className="values-grid">
          {VALUES.map((value) => (
            <article key={value.marker}>
              <span>{value.marker}</span>
              <h3>{value.title}</h3>
              <p>{value.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="foundation-section">
        <div className="page-shell">
          <SectionHeading
            align="center"
            eyebrow="One protocol, many doors"
            title="A network should survive its favorite app."
            description={
              <p>
                The flagship experience can be delightful without becoming the only doorway. These
                are design targets; implementation status is shown separately.
              </p>
            }
          />
          <div className="foundation-grid">
            {FOUNDATION_LAYERS.map((layer) => (
              <article
                className={`foundation-card foundation-card--${layer.tone}`}
                key={layer.label}
              >
                <p>{layer.label}</p>
                <h3>{layer.title}</h3>
                <p>{layer.copy}</p>
              </article>
            ))}
          </div>
          <div className="foundation-cta">
            <div>
              <p className="section-kicker">Start with proof</p>
              <h2>The feed refuses to invent a network.</h2>
              <p>
                Connect a compatible indexer to see its typed response and verification metadata.
                Without one, you get a useful degraded state—not demo content pretending to be live.
              </p>
            </div>
            <ButtonLink href="/home" variant="secondary">
              Open the honest feed
            </ButtonLink>
          </div>
        </div>
      </section>

      <section className="closing-statement page-shell">
        <p className="section-kicker">WokeSocial</p>
        <h2>
          Bold enough to be joyful.
          <span>Serious enough to earn trust.</span>
        </h2>
        <div>
          <p>
            Explicitly LGBTQ+ affirming. Open to everyone who honors the community’s safety
            standards. Never dependent on disclosing gender, sexuality, a legal name, or a visible
            wallet address.
          </p>
          <ButtonLink href="/about" variant="quiet">
            Read the principles →
          </ButtonLink>
        </div>
      </section>
    </>
  );
}
