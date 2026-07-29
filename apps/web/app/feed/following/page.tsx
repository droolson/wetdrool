import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink, StatePanel, StatusBadge } from '@wokesocial/ui';

import { AppPageHeader } from '@/components/app-page-header';
import { ProjectedFeedView } from '@/components/projected-feed-view';
import {
  getProjectedFeed,
  type ProjectedFeedResult,
  validateFeedCursor,
  validateFollowingViewer,
} from '@/lib/projected-feed';

export const metadata: Metadata = {
  title: 'Following feed preview',
  description:
    'Inspect the public posts selected by one WokeSocial identity’s verified follow graph.',
};

export const dynamic = 'force-dynamic';

function statusFor(
  result: ProjectedFeedResult | null,
  viewerState: ReturnType<typeof validateFollowingViewer>,
  cursorState: ReturnType<typeof validateFeedCursor>,
) {
  if (viewerState.kind === 'empty') {
    return <StatusBadge tone="neutral">Public identity required</StatusBadge>;
  }
  if (viewerState.kind === 'invalid' || cursorState.kind === 'invalid') {
    return <StatusBadge tone="degraded">Invalid request rejected</StatusBadge>;
  }
  return result?.kind === 'ready' ? (
    <StatusBadge tone="verified">Live public graph projection</StatusBadge>
  ) : (
    <StatusBadge tone="degraded">Preview safely degraded</StatusBadge>
  );
}

export default async function FollowingFeedPage({
  searchParams,
}: {
  searchParams: Promise<{
    before?: string | string[];
    viewer?: string | string[];
  }>;
}) {
  const parameters = await searchParams;
  const viewerState = validateFollowingViewer(parameters.viewer);
  const cursorState = validateFeedCursor(parameters.before);
  const result =
    viewerState.kind === 'valid' && cursorState.kind !== 'invalid'
      ? await getProjectedFeed({
          mode: 'following',
          viewer: viewerState.viewer,
          ...(cursorState.kind === 'valid' ? { cursor: cursorState.cursor } : {}),
        })
      : null;

  return (
    <div className="product-page page-shell">
      <AppPageHeader
        actions={statusFor(result, viewerState, cursorState)}
        eyebrow="Following feed preview"
        title="A public graph view, without pretending to be you."
      >
        <p>
          Enter a public protocol identity to inspect posts from identities it actively follows.
          This convenience filter is not authentication, never proves account ownership, and never
          reveals followers-only content.
        </p>
      </AppPageHeader>

      <nav className="feed-family-nav" aria-label="Feed directory">
        <Link href="/home">Home</Link>
        <Link aria-current="page" href="/feed/following">
          Following preview
        </Link>
        <Link href="/feed/chronological">Chronological</Link>
        <Link href="/feed/trending">Trending</Link>
        <Link href="/feed/media">Media</Link>
        <Link href="/feeds">All feeds</Link>
      </nav>

      <form action="/feed/following" className="search-bar" method="get">
        <label htmlFor="following-viewer">Public WokeSocial identity ID</label>
        <div>
          <input
            autoComplete="off"
            defaultValue={viewerState.viewer}
            id="following-viewer"
            name="viewer"
            placeholder="wokesocialid:v1:wokenet:v1:…"
            required
            spellCheck={false}
            type="text"
          />
          <button type="submit">Inspect public follows</button>
        </div>
        <p>
          The public identity remains in the address bar, reaches the WokeSocial web operator and
          your configured indexer, and may appear in their access logs. Never paste a private key,
          recovery secret, or passkey data.
        </p>
      </form>

      <section className="feed-contract" aria-labelledby="following-contract-title">
        <div>
          <p className="section-kicker">Public convenience contract</p>
          <h2 id="following-contract-title">Relationships filter; they do not authorize.</h2>
        </div>
        <dl>
          <div>
            <dt>Viewer scope</dt>
            <dd>One exact public WokeSocial identity ID, echoed and validated by the response.</dd>
          </div>
          <div>
            <dt>Graph</dt>
            <dd>Active verified follow edges at the indexer’s reported checkpoint.</dd>
          </div>
          <div>
            <dt>Content</dt>
            <dd>Public, finalized, non-tombstoned posts only; local safety filters apply.</dd>
          </div>
        </dl>
      </section>

      {viewerState.kind === 'empty' ? (
        <StatePanel
          eyebrow="No identity sent"
          title="Choose a public graph to inspect."
          tone="empty"
        >
          <p>No signed-in identity is inferred, and no posts are borrowed from the home feed.</p>
        </StatePanel>
      ) : viewerState.kind === 'invalid' ? (
        <StatePanel
          eyebrow="Identity not sent"
          title="That public identity is not canonical."
          tone="degraded"
        >
          <p>{viewerState.detail} No request was sent to the configured indexer.</p>
        </StatePanel>
      ) : cursorState.kind === 'invalid' ? (
        <StatePanel
          action={
            <ButtonLink
              href={`/feed/following?viewer=${encodeURIComponent(viewerState.viewer)}`}
              variant="secondary"
            >
              Return to the newest page
            </ButtonLink>
          }
          eyebrow="Cursor not sent"
          title="That feed page reference is not valid."
          tone="degraded"
        >
          <p>{cursorState.detail} No request was sent to the configured indexer.</p>
        </StatePanel>
      ) : result === null ? null : (
        <ProjectedFeedView
          baseHref="/feed/following"
          continuation={cursorState.kind === 'valid'}
          mode="following"
          result={result}
          viewer={viewerState.viewer}
        />
      )}
    </div>
  );
}
