import type { HTMLAttributes } from 'react';

export interface BrandMarkProps extends HTMLAttributes<HTMLSpanElement> {
  compact?: boolean;
}

export function BrandMark({ className = '', compact = false, ...props }: BrandMarkProps) {
  const classes = ['wokesocial-brand', compact ? 'wokesocial-brand--compact' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...props}>
      <span className="wokesocial-brand__symbol" aria-hidden="true">
        <span className="wokesocial-brand__spark" />
      </span>
      <span className="wokesocial-brand__wordmark">
        <strong>WokeSocial</strong>
      </span>
    </span>
  );
}
