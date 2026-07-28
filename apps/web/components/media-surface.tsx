import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from './app-page-header';

export interface MediaSurfaceProps {
  cards: readonly {
    copy: string;
    eyebrow: string;
    title: string;
    tone: 'coral' | 'neutral' | 'plum' | 'sky';
  }[];
  detail: string;
  eyebrow: string;
  format: string;
  title: string;
}

export function MediaSurface({ cards, detail, eyebrow, format, title }: MediaSurfaceProps) {
  return (
    <div className="media-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Media pipeline unavailable</StatusBadge>}
        eyebrow={eyebrow}
        title={title}
      >
        <p>{detail}</p>
      </AppPageHeader>

      <section className="media-stage" aria-labelledby="media-stage-title">
        <div className="media-stage__frame" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <div>
          <p className="section-kicker">{format}</p>
          <h2 id="media-stage-title">Nothing is autoplaying behind this message.</h2>
          <p>
            The page needs a verified manifest, accessible media metadata, a hash-checked gateway,
            and explicit playback consent before it can show a remote asset.
          </p>
          <nav aria-label="Media destinations">
            <Link href="/stories">Stories</Link>
            <Link href="/video">Video</Link>
            <Link href="/feed/media">Media feed</Link>
          </nav>
        </div>
      </section>

      <StatePanel
        action={
          <ButtonLink href="/settings/storage" variant="secondary">
            Review storage boundaries
          </ButtonLink>
        }
        eyebrow="No verified media"
        title="No stock clip is standing in for the network."
        tone="empty"
      >
        <p>
          Provider-backed media remains empty until retrieval, integrity, accessibility, consent,
          and safety-label checks are integrated.
        </p>
      </StatePanel>

      <section className="product-card-grid" aria-label={`${eyebrow} commitments`}>
        {cards.map((card) => (
          <InfoCard eyebrow={card.eyebrow} key={card.title} title={card.title} tone={card.tone}>
            <p>{card.copy}</p>
          </InfoCard>
        ))}
      </section>
    </div>
  );
}
