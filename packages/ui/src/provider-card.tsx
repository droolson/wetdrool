import type { ReactNode } from 'react';

import { StatusBadge, type StatusTone } from './status-badge';

export interface ProviderCardProps {
  detail: string;
  eyebrow: string;
  footer?: ReactNode;
  name: string;
  status: string;
  tone: StatusTone;
}

export function ProviderCard({ detail, eyebrow, footer, name, status, tone }: ProviderCardProps) {
  return (
    <article className="sw-provider-card">
      <div className="sw-provider-card__topline">
        <p className="sw-eyebrow">{eyebrow}</p>
        <StatusBadge tone={tone}>{status}</StatusBadge>
      </div>
      <h3>{name}</h3>
      <p>{detail}</p>
      {footer ? <div className="sw-provider-card__footer">{footer}</div> : null}
    </article>
  );
}
