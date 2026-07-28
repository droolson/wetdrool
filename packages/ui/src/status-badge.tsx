import type { HTMLAttributes } from 'react';

export type StatusTone = 'degraded' | 'neutral' | 'pending' | 'unavailable' | 'verified';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
}

export function StatusBadge({
  children,
  className = '',
  tone = 'neutral',
  ...props
}: StatusBadgeProps) {
  const classes = ['wokesocial-status', `wokesocial-status--${tone}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...props}>
      <span className="wokesocial-status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}
