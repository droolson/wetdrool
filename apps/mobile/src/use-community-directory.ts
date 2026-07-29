import { createCommunityClient, type PublicVerifiedCommunity } from '@wokesocial/indexer-client';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { MobileRuntimeConfig } from './runtime-config';
import type { MobileDeploymentState } from './use-deployment';

interface DirectoryBase {
  readonly communities: readonly PublicVerifiedCommunity[];
}

export type MobileCommunityDirectoryState =
  | (DirectoryBase & { readonly detail: string; readonly kind: 'blocked' | 'degraded' })
  | (DirectoryBase & { readonly kind: 'loading' })
  | (DirectoryBase & {
      readonly checkpointSlot: number;
      readonly endpoint: string;
      readonly kind: 'ready';
      readonly nextCursor: string | null;
    });

export interface MobileCommunityDirectory {
  readonly loadMore: () => void;
  readonly refresh: () => void;
  readonly state: MobileCommunityDirectoryState;
}

function blocked(detail: string): MobileCommunityDirectoryState {
  return { communities: [], detail, kind: 'blocked' };
}

export function useCommunityDirectory(
  config: MobileRuntimeConfig,
  deployment: MobileDeploymentState,
): MobileCommunityDirectory {
  const requestSequence = useRef(0);
  const [state, setState] = useState<MobileCommunityDirectoryState>(() =>
    blocked('Waiting for the configured Solana deployment to be verified.'),
  );
  const canRead =
    deployment.kind === 'verified' && config.deployment !== null && config.indexerUrl !== null;

  const run = useCallback(
    (cursor: string | null, previous: readonly PublicVerifiedCommunity[]): void => {
      if (
        deployment.kind !== 'verified' ||
        config.deployment === null ||
        config.indexerUrl === null
      ) {
        setState(
          blocked(
            config.indexerUrl === null
              ? 'No compatible open indexer is configured for this mobile build.'
              : 'The Solana deployment must verify before communities can be accepted.',
          ),
        );
        return;
      }
      const configuredDeployment = config.deployment;
      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;
      setState({ communities: previous, kind: 'loading' });
      const client = createCommunityClient({
        baseUrl: config.indexerUrl,
        deadlineMs: 8_000,
        fetch: globalThis.fetch,
      });
      void client
        .directory({
          network: configuredDeployment.id,
          limit: 20,
          ...(cursor === null ? {} : { cursor }),
        })
        .then((result) => {
          if (requestSequence.current !== sequence) return;
          if (result.kind === 'degraded') {
            setState({ communities: previous, detail: result.detail, kind: 'degraded' });
            return;
          }
          const incoming = result.value.communities;
          const priorAddresses = new Set(previous.map(({ communityAddress }) => communityAddress));
          if (incoming.some(({ communityAddress }) => priorAddresses.has(communityAddress))) {
            setState({
              communities: previous,
              detail:
                'The indexer repeated a community across cursor pages. Pagination stopped without accepting the duplicate.',
              kind: 'degraded',
            });
            return;
          }
          const checkpointSlot = result.value.meta.checkpointSlot;
          if (checkpointSlot === null) {
            setState({
              communities: previous,
              detail: 'The indexer omitted the finalized checkpoint required for discovery.',
              kind: 'degraded',
            });
            return;
          }
          setState({
            checkpointSlot,
            communities: [...previous, ...incoming],
            endpoint: result.endpoint,
            kind: 'ready',
            nextCursor: result.value.nextCursor,
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
            : 'The Solana deployment must verify before communities can be accepted.',
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
      run(state.nextCursor, state.communities);
    }
  }, [run, state]);

  return { loadMore, refresh, state };
}
