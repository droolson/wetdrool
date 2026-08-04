import type { Metadata } from 'next';
import { ButtonLink, SectionHeading, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { ESCALATION_ORDER, FREE_SPEECH_NOTE, MODERATION_RULES } from '@/lib/moderation-policy';
import { MENTAL_HEALTH_RESOURCES } from '@/lib/nsfw-mode';

export const metadata: Metadata = {
  title: 'Support',
  description: 'WetDrool support agent, reports, and mental health resources.',
};

export default function SupportPage() {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="pending">AI first · human last</StatusBadge>}
        eyebrow="Support agent"
        title="We’re here. No shame. Real escalation."
      >
        <p>
          Talk to the always-on support agent for reports, account issues, and safety. AI
          auto-resolves clear policy hits 24/7. Humans are the last resort — not the bottleneck.
        </p>
        <ButtonLink href="/messages?agent=support">Message support agent</ButtonLink>
      </AppPageHeader>

      <section>
        <SectionHeading eyebrow="Speech" title="Freedom with a spine" />
        <p>{FREE_SPEECH_NOTE}</p>
      </section>

      <section>
        <SectionHeading eyebrow="Escalation" title="How cases move" />
        <ol>
          {ESCALATION_ORDER.map((step) => (
            <li key={step}>
              <code>{step}</code>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <SectionHeading eyebrow="Policy highlights" title="What auto-resolves" />
        <ul>
          {MODERATION_RULES.filter((r) => r.autoResolve).map((rule) => (
            <li key={rule.id}>
              <strong>{rule.category}</strong> ({rule.severity}) — {rule.summary}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <SectionHeading eyebrow="Mental health" title="If you’re taking it too far" />
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
