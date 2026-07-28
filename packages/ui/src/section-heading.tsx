import type { ReactNode } from 'react';

export interface SectionHeadingProps {
  align?: 'left' | 'center';
  description?: ReactNode;
  eyebrow?: string;
  level?: 1 | 2;
  title: ReactNode;
}

export function SectionHeading({
  align = 'left',
  description,
  eyebrow,
  level = 2,
  title,
}: SectionHeadingProps) {
  const Heading = level === 1 ? 'h1' : 'h2';

  return (
    <header className={`wokesocial-section-heading wokesocial-section-heading--${align}`}>
      {eyebrow ? <p className="wokesocial-eyebrow">{eyebrow}</p> : null}
      <Heading>{title}</Heading>
      {description ? (
        <div className="wokesocial-section-heading__description">{description}</div>
      ) : null}
    </header>
  );
}
