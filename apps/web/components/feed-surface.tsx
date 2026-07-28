import Link from 'next/link';
import { ButtonLink, InfoCard, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from './app-page-header';

export interface FeedSurfaceProps {
  contract: readonly { label: string; value: string }[];
  detail: string;
  eyebrow: string;
  principles: readonly {
    copy: string;
    eyebrow: string;
    title: string;
    tone: 'coral' | 'neutral' | 'plum' | 'sky';
  }[];
  title: string;
}

export function FeedSurface({ contract, detail, eyebrow, principles, title }: FeedSurfaceProps) {
  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={<StatusBadge tone="degraded">Dedicated endpoint unavailable</StatusBadge>}
        eyebrow={eyebrow}
        title={title}
      >
        <p>{detail}</p>
      </AppPageHeader>

      <nav className="feed-family-nav" aria-label="Feed directory">
        <Link href="/home">Connected home</Link>
        <Link href="/feed/following">Following</Link>
        <Link href="/feed/chronological">Chronological</Link>
        <Link href="/feed/trending">Trending</Link>
        <Link href="/feed/media">Media</Link>
        <Link href="/feeds">All feeds</Link>
      </nav>

      <section className="feed-contract" aria-labelledby="feed-contract-title">
        <div>
          <p className="section-kicker">Required response contract</p>
          <h2 id="feed-contract-title">A feed needs provenance before personality.</h2>
        </div>
        <dl>
          {contract.map((item) => (
            <div key={item.label}>
              <dt>{item.label}</dt>
              <dd>{item.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <StatePanel
        action={
          <ButtonLink href="/settings/providers" variant="secondary">
            Review provider settings
          </ButtonLink>
        }
        eyebrow="No compatible response"
        title="No posts were substituted from the home feed."
        tone="empty"
      >
        <p>
          This route remains separate so a future provider cannot silently relabel one ranking
          recipe as another. Until its typed response is verified, the result is intentionally
          empty.
        </p>
      </StatePanel>

      <section className="product-card-grid" aria-label={`${eyebrow} feed commitments`}>
        {principles.map((item) => (
          <InfoCard eyebrow={item.eyebrow} key={item.title} title={item.title} tone={item.tone}>
            <p>{item.copy}</p>
          </InfoCard>
        ))}
      </section>
    </div>
  );
}
