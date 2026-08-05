import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, SectionHeading, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { CompanionsDirectory } from '@/components/companions-directory';
import { COMPANIONS, COMPANION_POLICY } from '@/lib/companions';
import { MENTAL_HEALTH_RESOURCES } from '@/lib/nsfw-mode';

export const metadata: Metadata = {
  title: 'Companions',
  description:
    'Hire WetDrool AI companions for immersive 18+ roleplay. Powered by Grok 4.5 and Mythic/Hermes.',
};

export default function CompanionsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={
          <>
            <StatusBadge tone="pending">chatLive: false</StatusBadge>
            <StatusBadge tone="degraded">earningsClaimed: false</StatusBadge>
            <StatusBadge tone="pending">Grok 4.5 + Mythic</StatusBadge>
          </>
        }
        eyebrow="AI companions"
        title="Always available. Extremely immersive. Still AI."
      >
        <p>
          Sexbots and companions you can hire for DM RP that feels human — without pretending to be
          a non-consenting real person. Runtime: <strong>Grok 4.5</strong> and{' '}
          <strong>Mythic/Hermes</strong>. Limits: illegal content only. Chat is not live until
          model keys and policy gates wire.
        </p>
      </AppPageHeader>

      <CompanionsDirectory />

      <section aria-labelledby="companion-grid">
        <SectionHeading eyebrow="Local fixtures" title="SSR catalog (same synthetic set)" />
        <ul className="companion-grid" id="companion-grid">
          {COMPANIONS.map((c) => (
            <li key={c.id} className="companion-card">
              <h2>
                <Link href={`/companions/${c.id}`}>{c.name}</Link>
              </h2>
              <p className="companion-card__tagline">{c.tagline}</p>
              <p>{c.blurb}</p>
              <p>
                <StatusBadge tone="pending">{c.model}</StatusBadge>{' '}
                <span>{c.hirePointsPerMinute} pts/min</span>
              </p>
              <ul className="tag-row">
                {c.tones.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
              <ButtonLink href={`/messages?companion=${c.id}`}>Open DM RP</ButtonLink>
            </li>
          ))}
        </ul>
      </section>

      <section className="policy-block" aria-labelledby="companion-policy">
        <h2 id="companion-policy">Consent & limits</h2>
        <ul>
          <li>{COMPANION_POLICY.age}</li>
          <li>{COMPANION_POLICY.consent}</li>
          <li>{COMPANION_POLICY.limits}</li>
          <li>{COMPANION_POLICY.labeling}</li>
          <li>{COMPANION_POLICY.mentalHealth}</li>
        </ul>
      </section>

      <section className="policy-block" aria-labelledby="mh-title">
        <h2 id="mh-title">Mental health</h2>
        <p>If sessions get intense or compulsive, pause. These links stay free and judgment-free:</p>
        <ul>
          {MENTAL_HEALTH_RESOURCES.map((r) => (
            <li key={r.id}>
              <a href={r.href} rel="noopener noreferrer" target={r.href.startsWith('http') ? '_blank' : undefined}>
                {r.label}
              </a>
              — {r.detail}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
