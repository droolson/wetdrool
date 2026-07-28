import type { ReactNode } from 'react';

export type StateTone = 'degraded' | 'empty' | 'error' | 'loading' | 'offline';

export interface StatePanelProps {
  action?: ReactNode;
  children: ReactNode;
  eyebrow?: string;
  headingLevel?: 1 | 2 | 3;
  title: string;
  tone: StateTone;
}

export function StatePanel({
  action,
  children,
  eyebrow,
  headingLevel = 2,
  title,
  tone,
}: StatePanelProps) {
  const isUrgent = tone === 'error' || tone === 'offline';
  const Heading = `h${headingLevel}` as const;

  return (
    <section
      className={`sw-state-panel sw-state-panel--${tone}`}
      aria-live={isUrgent ? 'assertive' : 'polite'}
      aria-busy={tone === 'loading' ? 'true' : undefined}
    >
      <div className="sw-state-panel__signal" aria-hidden="true">
        <span />
      </div>
      <div className="sw-state-panel__body">
        {eyebrow ? <p className="sw-eyebrow">{eyebrow}</p> : null}
        <Heading>{title}</Heading>
        <div className="sw-state-panel__copy">{children}</div>
        {action ? <div className="sw-state-panel__action">{action}</div> : null}
      </div>
    </section>
  );
}
