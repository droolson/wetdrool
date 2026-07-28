import type { PublicSearchCandidate, PublicSearchMatch, PublicSearchResult } from './models.js';

interface RankedCandidate {
  readonly candidate: PublicSearchCandidate;
  readonly matchedBy: PublicSearchMatch;
  readonly score: number;
  readonly stableId: string;
  readonly updatedAt: string;
}

export function normalizePublicSearchTerm(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/\p{Z}+/gu, ' ')
    .replace(/^ +| +$/gu, '')
    .replace(/[A-Z]/gu, (character) => character.toLowerCase());
}

export function isValidPublicSearchTerm(value: string): boolean {
  const length = [...value].length;
  return length >= 3 && length <= 120 && !/\p{Cc}/u.test(value);
}

/**
 * PostgreSQL pg_trgm can fall back to a full index scan when a LIKE pattern
 * has no extractable trigram. Requiring one conservative ASCII alphanumeric
 * run keeps contains matching indexed across database locale differences.
 * Other valid terms retain exact/prefix matching through B-tree indexes.
 */
export function isIndexablePublicSearchContainsTerm(value: string): boolean {
  return /[a-z0-9]{3}/u.test(normalizePublicSearchTerm(value));
}

export function comparePublicSearchText(left: string, right: string): number {
  const leftCodePoints = [...left].map((value) => value.codePointAt(0) ?? 0);
  const rightCodePoints = [...right].map((value) => value.codePointAt(0) ?? 0);
  const sharedLength = Math.min(leftCodePoints.length, rightCodePoints.length);
  for (let index = 0; index < sharedLength; index += 1) {
    const difference = (leftCodePoints[index] ?? 0) - (rightCodePoints[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return leftCodePoints.length - rightCodePoints.length;
}

export function rankPublicSearchCandidates(
  term: string,
  candidates: readonly PublicSearchCandidate[],
  limit: number,
): readonly PublicSearchResult[] {
  const normalizedTerm = normalizePublicSearchTerm(term);
  if (!isValidPublicSearchTerm(normalizedTerm) || limit <= 0) return [];
  const handleTerm = normalizedTerm.startsWith('@') ? normalizedTerm.slice(1) : normalizedTerm;
  const containsIsIndexable = isIndexablePublicSearchContainsTerm(normalizedTerm);

  return candidates
    .map((candidate): RankedCandidate | undefined =>
      rankCandidate(normalizedTerm, handleTerm, containsIsIndexable, candidate),
    )
    .filter((candidate): candidate is RankedCandidate => candidate !== undefined)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      const recency = comparePublicSearchText(right.updatedAt, left.updatedAt);
      return recency === 0 ? comparePublicSearchText(left.stableId, right.stableId) : recency;
    })
    .slice(0, limit)
    .map(({ candidate, matchedBy }) => ({ ...candidate, matchedBy }));
}

function rankCandidate(
  term: string,
  handleTerm: string,
  containsIsIndexable: boolean,
  candidate: PublicSearchCandidate,
): RankedCandidate | undefined {
  switch (candidate.kind) {
    case 'person': {
      const identityId = normalizePublicSearchTerm(candidate.identityId);
      const handle =
        candidate.handle === undefined ? undefined : normalizePublicSearchTerm(candidate.handle);
      const displayName = normalizePublicSearchTerm(candidate.displayName);
      const bio = normalizePublicSearchTerm(candidate.bio);
      const rank = bestRank([
        exactOrPrefix(identityId, term, 'exact-identifier', 1_000, 780),
        handle === undefined
          ? undefined
          : exactPrefixOrContains(handle, handleTerm, 'handle', 980, 900, 820, containsIsIndexable),
        exactPrefixOrContains(
          displayName,
          term,
          'display-name',
          880,
          800,
          720,
          containsIsIndexable,
        ),
        exactPrefixOrContains(bio, term, 'profile-bio', 520, 520, 520, containsIsIndexable),
      ]);
      return rank === undefined
        ? undefined
        : {
            candidate,
            ...rank,
            stableId: candidate.identityId,
            updatedAt: candidate.updatedAt,
          };
    }
    case 'post': {
      const objectId = normalizePublicSearchTerm(candidate.entry.post.objectId);
      const body = normalizePublicSearchTerm(
        candidate.entry.post.content.body ?? candidate.entry.post.content.bodyReference?.cid ?? '',
      );
      const rank = bestRank([
        exactOrPrefix(objectId, term, 'exact-identifier', 1_000, 780),
        exactPrefixOrContains(body, term, 'post-body', 760, 700, 640, containsIsIndexable),
      ]);
      return rank === undefined
        ? undefined
        : {
            candidate,
            ...rank,
            stableId: candidate.entry.post.objectId,
            updatedAt: candidate.entry.post.createdAt,
          };
    }
  }
}

function exactOrPrefix(
  value: string,
  term: string,
  matchedBy: PublicSearchMatch,
  exactScore: number,
  prefixScore: number,
): Pick<RankedCandidate, 'matchedBy' | 'score'> | undefined {
  if (value === term) return { matchedBy, score: exactScore };
  return value.startsWith(term) ? { matchedBy, score: prefixScore } : undefined;
}

function exactPrefixOrContains(
  value: string,
  term: string,
  matchedBy: PublicSearchMatch,
  exactScore: number,
  prefixScore: number,
  containsScore: number,
  allowContains = true,
): Pick<RankedCandidate, 'matchedBy' | 'score'> | undefined {
  if (!term) return undefined;
  if (value === term) return { matchedBy, score: exactScore };
  if (value.startsWith(term)) return { matchedBy, score: prefixScore };
  return allowContains && value.includes(term) ? { matchedBy, score: containsScore } : undefined;
}

function bestRank(
  candidates: readonly (Pick<RankedCandidate, 'matchedBy' | 'score'> | undefined)[],
): Pick<RankedCandidate, 'matchedBy' | 'score'> | undefined {
  return candidates
    .filter(
      (candidate): candidate is Pick<RankedCandidate, 'matchedBy' | 'score'> =>
        candidate !== undefined,
    )
    .sort((left, right) => right.score - left.score)[0];
}
