import { createIndexerClient, type IndexedPost } from '@wokesocial/indexer-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { MobileRuntimeConfig } from './runtime-config';
import type { MobileDeploymentState } from './use-deployment';

interface FeedBase {
  readonly posts: readonly IndexedPost[];
}

export type MobileChronologicalFeedState =
  | (FeedBase & { readonly detail: string; readonly kind: 'blocked' | 'degraded' })
  | (FeedBase & { readonly kind: 'loading' })
  | (FeedBase & {
      readonly checkpointSlot: number;
      readonly endpoint: string;
      readonly kind: 'ready';
      readonly nextCursor: string | null;
    });

export interface MobileChronologicalFeed {
  readonly loadMore: () => void;
  readonly refresh: () => void;
  readonly state: MobileChronologicalFeedState;
}

function blocked(detail: string): MobileChronologicalFeedState {
  return { detail, kind: 'blocked', posts: [] };
}

export function useChronologicalFeed(
  config: MobileRuntimeConfig,
  deployment: MobileDeploymentState,
): MobileChronologicalFeed {
  const requestSequence = useRef(0);
  const [state, setState] = useState<MobileChronologicalFeedState>(() =>
    blocked('Waiting for the configured Solana deployment to be verified.'),
  );

  const canRead =
    deployment.kind === 'verified' && config.deployment !== null && config.indexerUrl !== null;

  const run = useCallback(
    (cursor: string | null, previousPosts: readonly IndexedPost[]): void => {
      if (
        deployment.kind !== 'verified' ||
        config.deployment === null ||
        config.indexerUrl === null
      ) {
        setState(
          blocked(
            config.indexerUrl === null
              ? 'No compatible open indexer is configured for this mobile build.'
              : 'The Solana deployment must verify before its projected feed can be accepted.',
          ),
        );
        return;
      }
      const configuredDeployment = config.deployment;
      const configuredIndexerUrl = config.indexerUrl;

      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;
      setState({ kind: 'loading', posts: previousPosts });
      const client = createIndexerClient({
        baseUrl: configuredIndexerUrl,
        deadlineMs: 8_000,
        fetch: globalThis.fetch,
      });
      void client.chronological(cursor === null ? {} : { cursor }).then((result) => {
        if (requestSequence.current !== sequence) return;
        if (result.kind === 'degraded') {
          setState({
            detail: result.detail,
            kind: 'degraded',
            posts: previousPosts,
          });
          return;
        }
        if (result.value.network !== configuredDeployment.id) {
          setState({
            detail:
              'The indexer returned a different WokeNet Solana deployment. No feed data was accepted.',
            kind: 'degraded',
            posts: previousPosts,
          });
          return;
        }
        const incoming = result.value.entries.map(({ post }) => post);
        const priorIds = new Set(previousPosts.map(({ id }) => id));
        if (incoming.some(({ id }) => priorIds.has(id))) {
          setState({
            detail:
              'The indexer repeated a post across cursor pages. Pagination stopped without accepting the duplicate.',
            kind: 'degraded',
            posts: previousPosts,
          });
          return;
        }
        const checkpointSlot = result.value.meta.checkpointSlot;
        if (checkpointSlot === null) {
          setState({
            detail: 'The indexer omitted the finalized checkpoint required for this feed.',
            kind: 'degraded',
            posts: previousPosts,
          });
          return;
        }
        setState({
          checkpointSlot,
          endpoint: result.endpoint,
          kind: 'ready',
          nextCursor: result.value.nextCursor,
          posts: [...previousPosts, ...incoming],
        });
      });
    },
    [config.deployment, config.indexerUrl, deployment.kind],
  );

  useEffect(() => {
    if (!canRead) {
      requestSequence.current += 1;
      setState(
        blocked(
          config.indexerUrl === null
            ? 'No compatible open indexer is configured for this mobile build.'
            : 'The Solana deployment must verify before its projected feed can be accepted.',
        ),
      );
      return;
    }
    run(null, []);
    return () => {
      requestSequence.current += 1;
    };
  }, [canRead, config.indexerUrl, run]);

  const refresh = useCallback(() => {
    run(null, []);
  }, [run]);

  const loadMore = useCallback(() => {
    if (state.kind === 'ready' && state.nextCursor !== null) {
      run(state.nextCursor, state.posts);
    }
  }, [run, state]);

  return { loadMore, refresh, state };
}
