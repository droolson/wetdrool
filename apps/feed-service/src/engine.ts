import { decodeCursor, encodeCursor, FeedCursorError, requestFingerprint } from './cursor.js';
import { rankModeItems, selectModeItems } from './mode-ranking.js';
import { FEED_POLICY, FEED_POLICY_VERSION } from './policy.js';
import { algorithmForMode, type AppliedAlgorithm } from './provider.js';
import {
  getPersonalizationState,
  normalizeForMatch,
  type PersonalizationState,
  type ScoredItem,
} from './scoring.js';
import { rankRequestSchema, type FeedItem, type RankRequest } from './schemas.js';

export interface FilterCounts {
  readonly blockedAuthor: number;
  readonly mutedAuthor: number;
  readonly mutedKeyword: number;
  readonly sensitiveContent: number;
  readonly scopeMismatch: number;
}

export interface RankResponse {
  readonly canonical: false;
  readonly assurance: {
    readonly projectionSignatures: 'not-verified';
    readonly contentAuthenticity: 'not-verified';
    readonly note: string;
  };
  readonly provider: AppliedAlgorithm & {
    readonly policyVersion: typeof FEED_POLICY_VERSION;
    readonly sourceCheckpoints: readonly {
      readonly indexer: string;
      readonly checkpoint: string;
    }[];
    readonly filtering: {
      readonly localSafetyControlsApplied: true;
      readonly upstreamTombstonesApplied: boolean;
      readonly moderationProviderIds: readonly string[];
      readonly clientMustReapplySafetyControls: true;
    };
    readonly responseCreatedAt: string;
    readonly expiresAt: string;
  };
  readonly engine: {
    readonly policyVersion: typeof FEED_POLICY_VERSION;
    readonly requestedMode: RankRequest['mode'];
    readonly effectiveMode: RankRequest['mode'];
    readonly personalizationState: PersonalizationState;
    readonly behavioralPersonalization: boolean;
    readonly behavioralPersonalizationApplied: boolean;
    readonly asOf: string;
  };
  readonly page: {
    readonly returned: number;
    readonly eligible: number;
    readonly nextCursor: string | null;
    readonly filtered: FilterCounts;
  };
  readonly items: readonly RankedFeedItem[];
}

export type RankedFeedItem = ScoredItem & {
  readonly assurance: {
    readonly signedProjection: 'proxied-not-verified';
    readonly contentAuthenticity: 'not-verified';
  };
};

export { FeedCursorError };

export function rankFeed(input: unknown): RankResponse {
  const request = rankRequestSchema.parse(input);
  const personalizationState = getPersonalizationState(request.viewer);
  const effectiveMode =
    request.mode === 'recommended' &&
    (personalizationState === 'empty' || personalizationState === 'reset')
      ? 'chronological'
      : request.mode;
  const selection = selectModeItems(request);
  const filterResult = filterItems(selection.items, request);
  const ordered = rankModeItems(filterResult.items, request, effectiveMode);
  const fingerprint = requestFingerprint(request);
  const offset = cursorOffset(request, ordered, fingerprint);
  const pageItems = ordered.slice(offset, offset + request.limit);
  const nextOffset = offset + pageItems.length;
  const nextCursor =
    nextOffset < ordered.length && pageItems.length > 0
      ? encodeCursor({
          fingerprint,
          offset: nextOffset,
          previousItemId: pageItems.at(-1)?.item.id ?? '',
        })
      : null;

  return {
    canonical: false,
    assurance: {
      projectionSignatures: 'not-verified',
      contentAuthenticity: 'not-verified',
      note: 'This replaceable feed service ranks caller-provided projection summaries. It does not verify signatures, anchors, or content authenticity.',
    },
    provider: responseProvider(request, effectiveMode, ordered),
    engine: {
      policyVersion: FEED_POLICY_VERSION,
      requestedMode: request.mode,
      effectiveMode,
      personalizationState,
      behavioralPersonalization: request.viewer.behavioralPersonalization,
      behavioralPersonalizationApplied:
        effectiveMode === 'recommended' && request.viewer.behavioralPersonalization,
      asOf: request.asOf,
    },
    page: {
      returned: pageItems.length,
      eligible: ordered.length,
      nextCursor,
      filtered: {
        ...filterResult.counts,
        scopeMismatch: selection.scopeMismatch,
      },
    },
    items: pageItems.map((entry) => ({
      ...entry,
      assurance: {
        signedProjection: 'proxied-not-verified',
        contentAuthenticity: 'not-verified',
      },
    })),
  };
}

function filterItems(
  items: readonly FeedItem[],
  request: RankRequest,
): { readonly items: FeedItem[]; readonly counts: FilterCounts } {
  const blocked = new Set(request.viewer.blockedAuthorIds);
  const muted = new Set(request.viewer.mutedAuthorIds);
  const mutedKeywords = request.viewer.mutedKeywords.map(normalizeForMatch);
  const counts = {
    blockedAuthor: 0,
    mutedAuthor: 0,
    mutedKeyword: 0,
    sensitiveContent: 0,
    scopeMismatch: 0,
  };
  const eligible: FeedItem[] = [];

  for (const item of items) {
    if (blocked.has(item.authorId)) {
      counts.blockedAuthor += 1;
      continue;
    }
    if (muted.has(item.authorId)) {
      counts.mutedAuthor += 1;
      continue;
    }
    const filterableText = normalizeForMatch(
      [item.summary.excerpt ?? '', ...item.topics, ...item.summary.contentWarnings].join(' '),
    );
    if (mutedKeywords.some((keyword) => filterableText.includes(keyword))) {
      counts.mutedKeyword += 1;
      continue;
    }
    if (item.signals.sensitiveContentRisk > request.viewer.sensitiveContentThreshold) {
      counts.sensitiveContent += 1;
      continue;
    }
    eligible.push(item);
  }

  return { items: eligible, counts };
}

function cursorOffset(
  request: RankRequest,
  ranked: readonly ScoredItem[],
  fingerprint: string,
): number {
  if (request.cursor === undefined) {
    return 0;
  }
  const cursor = decodeCursor(request.cursor);
  if (cursor.fingerprint !== fingerprint) {
    throw new FeedCursorError('Cursor belongs to a different ranking request.');
  }
  const previous = ranked[cursor.offset - 1];
  if (previous === undefined || previous.item.id !== cursor.previousItemId) {
    throw new FeedCursorError('Cursor does not match the current ranked result.');
  }
  return cursor.offset;
}

function responseProvider(
  request: RankRequest,
  effectiveMode: RankRequest['mode'],
  ordered: readonly ScoredItem[],
): RankResponse['provider'] {
  const thirdParty = request.modeContext.thirdParty;
  const algorithm: AppliedAlgorithm =
    effectiveMode === 'third-party' && thirdParty !== undefined
      ? {
          providerId: thirdParty.providerId,
          endpoint: thirdParty.endpoint,
          algorithmId: thirdParty.algorithmId,
          algorithmVersion: thirdParty.algorithmVersion,
          externalOrderVerified: false,
        }
      : algorithmForMode(effectiveMode as Exclude<RankRequest['mode'], 'third-party'>);
  const sourceCheckpoints = new Map<string, { indexer: string; checkpoint: string }>();
  for (const entry of ordered) {
    const projection = entry.item.signedProjection;
    sourceCheckpoints.set(`${projection.source}\u0000${projection.sourceCheckpoint}`, {
      indexer: projection.source,
      checkpoint: projection.sourceCheckpoint,
    });
  }
  return {
    ...algorithm,
    policyVersion: FEED_POLICY_VERSION,
    sourceCheckpoints: [...sourceCheckpoints.values()].sort(
      (left, right) =>
        left.indexer.localeCompare(right.indexer) ||
        left.checkpoint.localeCompare(right.checkpoint),
    ),
    filtering: {
      localSafetyControlsApplied: true,
      upstreamTombstonesApplied: request.appliedPolicies.tombstonesApplied,
      moderationProviderIds: request.appliedPolicies.moderationProviderIds,
      clientMustReapplySafetyControls: true,
    },
    responseCreatedAt: request.asOf,
    expiresAt: new Date(Date.parse(request.asOf) + 5 * 60 * 1_000).toISOString(),
  };
}

export const publicFeedPolicy = FEED_POLICY;
