import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ButtonLink, StatePanel, StatusBadge } from '@wokesocial/ui';

import { PostCard } from '@/components/post-card';
import { getPostById } from '@/lib/indexer';
import { formatUtcDate } from '@/lib/presentation';

export const metadata: Metadata = {
  title: 'Post detail',
  description: 'Inspect a post and the verification metadata reported by the configured indexer.',
};

export const dynamic = 'force-dynamic';

export default async function PostDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getPostById(decodeRouteSegment(id));

  if (result.kind === 'not-found') {
    notFound();
  }

  if (result.kind === 'degraded') {
    return (
      <div className="page-shell narrow-shell">
        <StatePanel
          action={
            <ButtonLink href="/home" variant="secondary">
              Back to the feed
            </ButtonLink>
          }
          eyebrow="Post unavailable"
          headingLevel={1}
          title="No unverified placeholder was substituted."
          tone="degraded"
        >
          <p>{result.detail}</p>
        </StatePanel>
      </div>
    );
  }

  return (
    <article className="post-detail page-shell">
      <header className="post-detail__header">
        <div>
          <p className="section-kicker">Post detail</p>
          <h1>A verified protocol object</h1>
        </div>
        <StatusBadge tone="neutral">From {result.endpoint}</StatusBadge>
      </header>

      <PostCard post={result.value.post} prominent />

      <aside className="post-detail__receipt" aria-labelledby="receipt-title">
        <div>
          <p className="section-kicker">Indexer receipt</p>
          <h2 id="receipt-title">{result.value.meta.source}</h2>
        </div>
        <dl>
          <div>
            <dt>Response indexed</dt>
            <dd>{formatUtcDate(result.value.meta.indexedAt)}</dd>
          </div>
          <div>
            <dt>Checkpoint</dt>
            <dd>
              {result.value.meta.checkpointSlot === null
                ? 'Not reported'
                : `Slot ${result.value.meta.checkpointSlot.toLocaleString('en')}`}
            </dd>
          </div>
        </dl>
        <p>
          The foundation validates this HTTP shape and reports the indexer’s proof fields. It does
          not claim independent browser-side signature validation before the protocol SDK is
          integrated.
        </p>
      </aside>
    </article>
  );
}

function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
