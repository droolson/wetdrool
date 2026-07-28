import type { ReactNode } from 'react';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@socially-woke/ui';

import { AppPageHeader } from './app-page-header';

export interface ProductStateCard {
  copy: string;
  eyebrow: string;
  footer?: string;
  title: string;
  tone?: 'coral' | 'neutral' | 'plum' | 'sky';
}

export interface ProductStateProps {
  actionHref?: string;
  actionLabel?: string;
  cards: readonly ProductStateCard[];
  children?: ReactNode;
  detail: string;
  eyebrow: string;
  intro: string;
  stateEyebrow: string;
  stateTitle: string;
  title: string;
}

export function ProductState({
  actionHref = '/settings/providers',
  actionLabel = 'Review provider settings',
  cards,
  children,
  detail,
  eyebrow,
  intro,
  stateEyebrow,
  stateTitle,
  title,
}: ProductStateProps) {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Provider unavailable</StatusBadge>}
        eyebrow={eyebrow}
        title={title}
      >
        <p>{intro}</p>
      </AppPageHeader>

      {children}

      <StatePanel
        action={
          <ButtonLink href={actionHref} variant="secondary">
            {actionLabel}
          </ButtonLink>
        }
        eyebrow={stateEyebrow}
        headingLevel={2}
        title={stateTitle}
        tone="empty"
      >
        <p>{detail}</p>
      </StatePanel>

      <section className="product-card-grid" aria-label={`${title} design commitments`}>
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
