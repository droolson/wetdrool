import Link from 'next/link';
import { StatusBadge } from '@socially-woke/ui';

import type { IndexedPost, VerificationState } from '@/lib/indexer';
import { abbreviate, formatUtcDate, verificationLabel } from '@/lib/presentation';

function toneFor(state: VerificationState) {
  switch (state) {
    case 'verified':
      return 'verified' as const;
    case 'pending':
      return 'pending' as const;
    case 'invalid':
      return 'unavailable' as const;
  }
}

export interface PostCardProps {
  post: IndexedPost;
  prominent?: boolean;
}

export function PostCard({ post, prominent = false }: PostCardProps) {
  const proof = post.verification;

  return (
    <article className={`post-card ${prominent ? 'post-card--prominent' : ''}`}>
      <header className="post-card__header">
        <div className="post-card__identity">
          <span className="post-card__avatar" aria-hidden="true">
            {post.author.displayName.slice(0, 1).toLocaleUpperCase()}
          </span>
          <div>
            <p className="post-card__name">{post.author.displayName}</p>
            <p className="post-card__handle">
              {post.author.handle === null ? 'Handle not claimed' : `@${post.author.handle}`}
            </p>
          </div>
        </div>
        <StatusBadge tone={toneFor(proof.state)}>{verificationLabel(proof.state)}</StatusBadge>
      </header>

      {post.body === null ? (
        <p className="post-card__body">
          This post’s text is stored in a separate content-addressed object that this view has not
          retrieved.
        </p>
      ) : (
        <p className="post-card__body">{post.body}</p>
      )}

      <div className="post-card__meta">
        <time dateTime={post.createdAt}>{formatUtcDate(post.createdAt)}</time>
        {post.language ? <span>Language: {post.language}</span> : null}
      </div>

      <details className="proof-details">
        <summary>Verification details</summary>
        <dl>
          <div>
            <dt>Content hash</dt>
            <dd title={proof.contentHash}>
              <code>{abbreviate(proof.contentHash)}</code>
            </dd>
          </div>
          <div>
            <dt>Manifest</dt>
            <dd title={proof.manifestUri}>
              <code>{abbreviate(proof.manifestUri)}</code>
            </dd>
          </div>
          {post.bodyReference === null ? null : (
            <div>
              <dt>Body reference</dt>
              <dd title={post.bodyReference.cid}>
                <code>{abbreviate(`ipfs://${post.bodyReference.cid}`)}</code>
              </dd>
            </div>
          )}
          <div>
            <dt>Signature</dt>
            <dd>{proof.signatureValid ? 'Valid' : 'Not valid'}</dd>
          </div>
          <div>
            <dt>Hash match</dt>
            <dd>{proof.contentHashValid ? 'Valid' : 'Not valid'}</dd>
          </div>
          <div>
            <dt>Woke Network anchor</dt>
            <dd>
              {proof.anchor
                ? `Slot ${proof.anchor.slot.toLocaleString('en')} · ${proof.anchor.finality}`
                : 'Not available'}
            </dd>
          </div>
        </dl>
      </details>

      {!prominent ? (
        <footer className="post-card__footer">
          <Link href={`/post/${encodeURIComponent(post.id)}`}>
            Open verified post
            <span aria-hidden="true"> ↗</span>
          </Link>
          <span>Interactions require SDK wiring</span>
        </footer>
      ) : null}
    </article>
  );
}
