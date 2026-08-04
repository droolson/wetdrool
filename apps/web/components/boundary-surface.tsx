import type { ReactNode } from 'react';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from './app-page-header';

export interface BoundarySurfaceProps {
  action?: ReactNode;
  cards: readonly {
    copy: string;
    eyebrow: string;
    footer?: string;
    title: string;
    tone: 'coral' | 'neutral' | 'plum' | 'sky';
  }[];
  detail: string;
  eyebrow: string;
  intro: string;
  navigation?: ReactNode;
  requirements: readonly { label: string; state: string }[];
  stateTitle: string;
  title: string;
}

export function BoundarySurface({
  action,
  cards,
  detail,
  eyebrow,
  intro,
  navigation,
  requirements,
  stateTitle,
  title,
}: BoundarySurfaceProps) {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="unavailable">Authorization required</StatusBadge>}
        eyebrow={eyebrow}
        title={title}
      >
        <p>{intro}</p>
      </AppPageHeader>

      {navigation}

      <section className="boundary-ledger" aria-labelledby="boundary-ledger-title">
        <div>
          <p className="section-kicker">Activation ledger</p>
          <h2 id="boundary-ledger-title">What must be true first</h2>
        </div>
        <dl>
          {requirements.map((requirement) => (
            <div key={requirement.label}>
              <dt>{requirement.label}</dt>
              <dd>{requirement.state}</dd>
            </div>
          ))}
        </dl>
      </section>

      <StatePanel
        action={
          action ?? (
            <ButtonLink href="/settings/providers" variant="secondary">
              Review provider settings
            </ButtonLink>
          )
        }
        eyebrow="No operation attempted"
        title={stateTitle}
        tone="degraded"
      >
        <p>{detail}</p>
      </StatePanel>

      <section className="product-card-grid" aria-label={`${eyebrow} safeguards`}>
        {cards.map((card) => (
          <InfoCard
            eyebrow={card.eyebrow}
            footer={card.footer}
            key={card.title}
            title={card.title}
            tone={card.tone}
          >
            <p>{card.copy}</p>
          </InfoCard>
        ))}
      </section>
    </div>
  );
}
