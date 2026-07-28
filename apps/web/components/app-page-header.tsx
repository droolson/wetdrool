import type { ReactNode } from 'react';

export interface AppPageHeaderProps {
  actions?: ReactNode;
  children: ReactNode;
  eyebrow: string;
  title: string;
}

export function AppPageHeader({ actions, children, eyebrow, title }: AppPageHeaderProps) {
  return (
    <header className="product-page-header">
      <div>
        <p className="section-kicker">{eyebrow}</p>
        <h1>{title}</h1>
      </div>
      <div className="product-page-header__context">{children}</div>
      {actions ? <div className="product-page-header__actions">{actions}</div> : null}
    </header>
  );
}
