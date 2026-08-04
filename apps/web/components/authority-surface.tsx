import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wetdrool/ui';

import { AppPageHeader } from './app-page-header';

export interface AuthoritySurfaceProps {
  backHref: string;
  backLabel: string;
  cards: readonly {
    copy: string;
    eyebrow: string;
    title: string;
    tone: 'coral' | 'neutral' | 'plum' | 'sky';
  }[];
  detail: string;
  eyebrow: string;
  identifier: string;
  requirements: readonly string[];
  stateTitle: string;
  title: string;
}

export function AuthoritySurface({
  backHref,
  backLabel,
  cards,
  detail,
  eyebrow,
  identifier,
  requirements,
  stateTitle,
  title,
}: AuthoritySurfaceProps) {
  const displayIdentifier = identifier.slice(0, 96);

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Authority unresolved</StatusBadge>}
        eyebrow={eyebrow}
        title={title}
      >
        <p>
          Requested identifier: <code className="inline-identifier">{displayIdentifier}</code>
          {identifier.length > displayIdentifier.length ? '…' : ''}
        </p>
      </AppPageHeader>

      <section className="authority-checklist" aria-labelledby="authority-checklist-title">
        <div>
          <p className="section-kicker">Fail-closed checks</p>
          <h2 id="authority-checklist-title">No role is inferred from the URL.</h2>
        </div>
        <ol>
          {requirements.map((requirement, index) => (
            <li key={requirement}>
              <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              {requirement}
            </li>
          ))}
        </ol>
      </section>

      <StatePanel
        action={
          <ButtonLink href={backHref} variant="secondary">
            {backLabel}
          </ButtonLink>
        }
        eyebrow="Read-only boundary"
        title={stateTitle}
        tone="degraded"
      >
        <p>{detail}</p>
      </StatePanel>

      <section className="product-card-grid" aria-label={`${eyebrow} authority boundaries`}>
        {cards.map((card) => (
          <InfoCard eyebrow={card.eyebrow} key={card.title} title={card.title} tone={card.tone}>
            <p>{card.copy}</p>
          </InfoCard>
        ))}
      </section>
    </div>
  );
}
