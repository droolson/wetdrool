import type { Metadata } from 'next';
import Link from 'next/link';

import { AgeGatePanel } from '@/components/age-gate-panel';

export const metadata: Metadata = {
  title: 'WetDrool — Creator-owned adult social',
  description:
    'WetDrool is an 18+ creator-owned social platform with passkey accounts, portable identity, private rooms, livestream discovery, and fail-closed monetization.',
};

const PRODUCT_PILLARS = [
  {
    number: '01',
    title: 'Your audience is portable',
    copy: 'Profiles, posts, follows, communities, and moderation labels use signed portable objects. WetDrool is a client—not the sole authority over your identity.',
    href: '/protocol',
    action: 'Inspect the protocol',
  },
  {
    number: '02',
    title: 'Your access starts with a passkey',
    copy: 'Create a pseudonymous service account without handing over a password, seed phrase, government ID, or legal name. Private signing material stays encrypted and browser-bound.',
    href: '/onboarding',
    action: 'Create an account',
  },
  {
    number: '03',
    title: 'Creator money stays honest',
    copy: 'Subscriptions, paid media, tips, and unlock receipts have real product surfaces, but checkout remains locked until settlement, entitlement, durability, and compliance gates are verified.',
    href: '/market',
    action: 'View the market',
  },
] as const;

const SURFACES = [
  ['Short video', '/feeds', 'Swipe discovery with explainable ranking and local safety controls.'],
  ['Live', '/live', 'Adult livestream discovery with explicit availability and safety states.'],
  [
    'Creators',
    '/creators',
    'Portable profiles, offerings, audience controls, and creator studios.',
  ],
  [
    'Private rooms',
    '/rooms',
    'Pairwise encrypted-room foundations with replaceable relay transport.',
  ],
  [
    'Communities',
    '/communities',
    'Signed membership and governance without a hidden platform roster.',
  ],
  [
    'AI companions',
    '/companions',
    'Disclosed synthetic companions with bounded identity and safety labels.',
  ],
] as const;

export default function RootPage() {
  return (
    <AgeGatePanel
      className="wetdrool-entry-gate"
      confirmLabel="I am 18+ · enter WetDrool"
      help={
        <>
          Under 18? Visit the separate SFW game at{' '}
          <a href="https://drooly.ai/games/ddd">drooly.ai/games/ddd</a>.
        </>
      }
      kicker="WetDrool · adults only"
      title="A creator network with boundaries."
    >
      <div className="wetdrool-landing">
        <section className="wetdrool-hero" aria-labelledby="wetdrool-hero-title">
          <div className="wetdrool-hero__glow" aria-hidden="true" />
          <div className="wetdrool-hero__copy">
            <p className="wetdrool-hero__eyebrow">18+ · creator-owned · protocol portable</p>
            <h1 id="wetdrool-hero-title">
              Get paid.
              <br />
              Keep your <em>identity.</em>
            </h1>
            <p className="wetdrool-hero__lede">
              WetDrool is adult social rebuilt around passkeys, portable audiences, consent-first
              discovery, private rooms, and creator commerce that refuses to fake a payout.
            </p>
            <div className="wetdrool-hero__actions">
              <Link className="wetdrool-button wetdrool-button--primary" href="/onboarding">
                Claim your space
              </Link>
              <Link className="wetdrool-button wetdrool-button--secondary" href="/hub">
                Explore the network
              </Link>
            </div>
            <p className="wetdrool-hero__status">
              Pre-release production shell. Public browsing is live; identity, publishing, uploads,
              and commerce activate only when their verified providers are ready.
            </p>
          </div>

          <aside className="wetdrool-signal" aria-label="WetDrool product principles">
            <span className="wetdrool-signal__live">PRE-RELEASE</span>
            <p className="wetdrool-signal__mark" aria-hidden="true">
              W/
            </p>
            <dl>
              <div>
                <dt>Identity</dt>
                <dd>Portable</dd>
              </div>
              <div>
                <dt>Accounts</dt>
                <dd>Passkey-first</dd>
              </div>
              <div>
                <dt>Private chat</dt>
                <dd>E2EE boundary</dd>
              </div>
              <div>
                <dt>Commerce</dt>
                <dd>Fail-closed</dd>
              </div>
            </dl>
          </aside>
        </section>

        <section className="wetdrool-manifesto" aria-labelledby="wetdrool-manifesto-title">
          <p>THE PLATFORM SHOULD BE REPLACEABLE.</p>
          <h2 id="wetdrool-manifesto-title">
            Your work should not disappear because one company changes the rules.
          </h2>
        </section>

        <section className="wetdrool-pillars" aria-label="WetDrool product pillars">
          {PRODUCT_PILLARS.map((pillar) => (
            <article key={pillar.number}>
              <span>{pillar.number}</span>
              <h2>{pillar.title}</h2>
              <p>{pillar.copy}</p>
              <Link href={pillar.href}>{pillar.action} →</Link>
            </article>
          ))}
        </section>

        <section className="wetdrool-surfaces" aria-labelledby="wetdrool-surfaces-title">
          <header>
            <p>ONE ACCOUNT. MANY SURFACES.</p>
            <h2 id="wetdrool-surfaces-title">Built for creators, viewers, and communities.</h2>
          </header>
          <div className="wetdrool-surfaces__grid">
            {SURFACES.map(([title, href, copy]) => (
              <Link href={href} key={title}>
                <span aria-hidden="true">↗</span>
                <h3>{title}</h3>
                <p>{copy}</p>
              </Link>
            ))}
          </div>
        </section>

        <section className="wetdrool-proof" aria-labelledby="wetdrool-proof-title">
          <div>
            <p>NO FAKE DECENTRALIZATION</p>
            <h2 id="wetdrool-proof-title">Know what is live, local, staged, or blocked.</h2>
          </div>
          <p>
            WetDrool publishes machine-readable readiness instead of turning placeholders into
            claims. No invented token, payout, follower count, creator income, or mainnet state.
          </p>
          <div className="wetdrool-proof__actions">
            <Link href="/status">Read product status</Link>
            <Link href="/safety">Review safety</Link>
            <a href="/api/v1/status">Open readiness JSON</a>
          </div>
        </section>
      </div>
    </AgeGatePanel>
  );
}
