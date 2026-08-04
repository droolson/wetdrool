import { ButtonLink, StatePanel, StatusBadge } from '@wetdrool/ui';

import type { ProjectedFeedMode, ProjectedFeedResult } from '@/lib/projected-feed';
import { formatUtcDate } from '@/lib/presentation';

import { FeedPostList } from './feed-post-list';

export interface ProjectedFeedViewProps {
  baseHref: string;
  continuation: boolean;
  mode: ProjectedFeedMode;
  result: ProjectedFeedResult;
  viewer?: string;
}

function nextPageHref(baseHref: string, cursor: string, viewer: string | undefined): string {
  const query = new URLSearchParams({ before: cursor });
  if (viewer !== undefined) query.set('viewer', viewer);
  return `${baseHref}?${query.toString()}`;
}

export function ProjectedFeedView({
  baseHref,
  continuation,
  mode,
  result,
  viewer,
}: ProjectedFeedViewProps) {
  if (result.kind === 'degraded') {
    return (
      <StatePanel
        action={
          <ButtonLink href="/settings/providers" variant="secondary">
            Review provider setup
          </ButtonLink>
        }
        eyebrow="No projected feed accepted"
        title={
          result.reason === 'unconfigured'
            ? 'Connect an indexer to load this feed.'
            : 'This feed is safely degraded.'
        }
        tone="degraded"
      >
        <p>{result.detail}</p>
      </StatePanel>
    );
  }

  const posts = result.value.entries.map(({ post }) => post);

  return (
    <>
      <section className="indexer-receipt" aria-labelledby={`${mode}-receipt-title`}>
        <div>
          <StatusBadge tone="verified">Typed projection accepted</StatusBadge>
          <h2 id={`${mode}-receipt-title`}>{result.value.meta.source}</h2>
        </div>
        <dl>
          <div>
            <dt>Provider</dt>
            <dd>{result.endpoint}</dd>
          </div>
          <div>
            <dt>Indexed</dt>
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
          <div>
            <dt>Recipe</dt>
            <dd>
              <code>{result.value.recipe}</code>
            </dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd title={result.value.network}>
              <code>{result.value.network}</code>
            </dd>
          </div>
          <div>
            <dt>Canonical state</dt>
            <dd>No · replaceable projection</dd>
          </div>
        </dl>
        <p>
          Every returned post carries the indexer’s signature, content-hash, and finalized-anchor
          claims. Independent browser-side proof verification remains a separate SDK milestone.
        </p>
      </section>

      {posts.length === 0 ? (
        <StatePanel
          action={
            continuation ? (
              <ButtonLink
                href={
                  viewer === undefined
                    ? baseHref
                    : `${baseHref}?viewer=${encodeURIComponent(viewer)}`
                }
                variant="secondary"
              >
                Return to the newest page
              </ButtonLink>
            ) : undefined
          }
          eyebrow="Accepted empty response"
          title={
            continuation
              ? 'No older posts remain in this projection.'
              : 'The indexer returned no posts for this feed.'
          }
          tone="empty"
        >
          <p>No sample, recommended, or cross-feed posts were inserted.</p>
        </StatePanel>
      ) : (
        <section className="feed-list" aria-labelledby={`${mode}-feed-title`}>
          <div className="feed-list__heading">
            <h2 id={`${mode}-feed-title`}>
              {mode === 'chronological'
                ? 'Latest in strict time order'
                : 'Public posts from followed identities'}
            </h2>
            <span>{posts.length.toLocaleString('en')} returned</span>
          </div>
          <FeedPostList posts={posts} />
          <nav className="feed-pagination" aria-label={`${mode} feed pages`}>
            {continuation ? (
              <ButtonLink
                href={
                  viewer === undefined
                    ? baseHref
                    : `${baseHref}?viewer=${encodeURIComponent(viewer)}`
                }
                variant="quiet"
              >
                Newest page
              </ButtonLink>
            ) : (
              <span>Newest page</span>
            )}
            {result.value.nextCursor === null ? (
              <span>End of the currently indexed feed</span>
            ) : (
              <ButtonLink
                href={nextPageHref(baseHref, result.value.nextCursor, viewer)}
                rel="next"
                variant="secondary"
              >
                Load older posts
              </ButtonLink>
            )}
          </nav>
        </section>
      )}
    </>
  );
}
