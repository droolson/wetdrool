import type { AnchorHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
}

export function ButtonLink({ className = '', variant = 'primary', ...props }: ButtonLinkProps) {
  const classes = ['sw-button', `sw-button--${variant}`, className].filter(Boolean).join(' ');

  return <a className={classes} {...props} />;
}
