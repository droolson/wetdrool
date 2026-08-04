import type { HTMLAttributes } from 'react';

export interface BrandMarkProps extends HTMLAttributes<HTMLSpanElement> {
  compact?: boolean;
}

/**
 * Canonical WetDrool mark: spectral eye-in-heart droplet + wordmark.
 * Assets live at /brand/* on the web app (public/).
 */
export function BrandMark({ className = '', compact = false, ...props }: BrandMarkProps) {
  const classes = ['wetdrool-brand', compact ? 'wetdrool-brand--compact' : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <span className={classes} {...props}>
      <span className="wetdrool-brand__symbol" aria-hidden="true">
        {/* eslint-disable-next-line @next/next/no-img-element -- package has no Next Image */}
        <img
          className="wetdrool-brand__mark"
          src="/brand/wetdrool-mark.svg"
          alt=""
          width={34}
          height={34}
        />
      </span>
      {compact ? null : (
        <span className="wetdrool-brand__wordmark">
          <strong>WetDrool</strong>
        </span>
      )}
    </span>
  );
}
