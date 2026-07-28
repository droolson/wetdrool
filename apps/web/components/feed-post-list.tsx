'use client';

import { useState } from 'react';

import type { IndexedPost } from '@/lib/indexer';
import { loadDevicePreferences, shouldHideIdentity } from '@/lib/local-preferences';

import { ClientReady } from './client-ready';
import { PostCard } from './post-card';

export function FeedPostList({ posts }: { posts: IndexedPost[] }) {
  return (
    <ClientReady
      fallback={posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    >
      <HydratedFeedPostList posts={posts} />
    </ClientReady>
  );
}

function HydratedFeedPostList({ posts }: { posts: IndexedPost[] }) {
  const [preferences] = useState(() => loadDevicePreferences(window.localStorage));
  const visible = posts.filter((post) => !shouldHideIdentity(preferences, post.author.identityId));
  const hiddenCount = posts.length - visible.length;

  return (
    <>
      {hiddenCount > 0 ? (
        <p className="local-filter-notice" role="status">
          {hiddenCount.toLocaleString('en')} indexed {hiddenCount === 1 ? 'post is' : 'posts are'}{' '}
          hidden by this device’s local safety list.
        </p>
      ) : null}
      {visible.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
    </>
  );
}
