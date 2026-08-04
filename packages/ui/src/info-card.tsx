import type { ReactNode } from 'react';

export interface InfoCardProps {
  children: ReactNode;
  eyebrow?: string;
  footer?: ReactNode;
  title: string;
  tone?: 'coral' | 'neutral' | 'plum' | 'sky';
}

export function InfoCard({ children, eyebrow, footer, title, tone = 'neutral' }: InfoCardProps) {
  return (
    <article className={`wetdrool-info-card wetdrool-info-card--${tone}`}>
      <div className="wetdrool-info-card__top">
        {eyebrow ? <p className="wetdrool-eyebrow">{eyebrow}</p> : null}
        <span aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <div className="wetdrool-info-card__copy">{children}</div>
      {footer ? <footer>{footer}</footer> : null}
    </article>
  );
}
