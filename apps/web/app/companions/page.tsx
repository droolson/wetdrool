import type { Metadata } from 'next';
import { StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { CompanionsDirectory } from '@/components/companions-directory';
import { COMPANION_POLICY } from '@/lib/companions';
import { MENTAL_HEALTH_RESOURCES } from '@/lib/nsfw-mode';

export const metadata: Metadata = {
  title: 'Companions',
  description:
    'Hire WetDrool AI companions for immersive 18+ roleplay. Directory via product API — synthetic fixtures until chat and policy gates wire.',
};

export default function CompanionsPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">Companions via product API</StatusBadge>}
        eyebrow="AI companions"
        title="Always available. Extremely immersive. Still AI."
      >
        <p>
          Sexbots and companions you can hire for DM RP that feels human — without pretending to be
          a non-consenting real person. Rows appear only after a successful{' '}
          <code>/api/v1/companions</code> response — never as silent local re-fanout. HTTP errors
          (including 404) fail closed to empty. Runtime when live: <strong>Grok 4.5</strong> and{' '}
          <strong>Mythic/Hermes</strong>. Limits: illegal content only.
        </p>
      </AppPageHeader>

      <section aria-labelledby="companion-directory-title">
        <div>
          <p className="section-kicker">For hire</p>
          <h2 id="companion-directory-title">Pick a vibe</h2>
        </div>
        <CompanionsDirectory />
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
              <a
                href={r.href}
                rel="noopener noreferrer"
                target={r.href.startsWith('http') ? '_blank' : undefined}
              >
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
