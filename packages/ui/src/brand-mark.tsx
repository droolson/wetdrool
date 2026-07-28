import type { HTMLAttributes } from 'react';

export interface BrandMarkProps extends HTMLAttributes<HTMLSpanElement> {
  compact?: boolean;
}

export function BrandMark({ className = '', compact = false, ...props }: BrandMarkProps) {
  const classes = ['sw-brand', compact ? 'sw-brand--compact' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...props}>
      <span className="sw-brand__symbol" aria-hidden="true">
        <span className="sw-brand__spark" />
      </span>
      <span className="sw-brand__wordmark">
        <span>Socially</span>
        <strong>Woke</strong>
      </span>
    </span>
  );
}
