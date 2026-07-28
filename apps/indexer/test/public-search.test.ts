import { describe, expect, it } from 'vitest';

import {
  isIndexablePublicSearchContainsTerm,
  isValidPublicSearchTerm,
  normalizePublicSearchTerm,
  rankPublicSearchCandidates,
  type PublicSearchCandidate,
} from '../src/index.js';

describe('deterministic public search ranking', () => {
  const people: readonly PublicSearchCandidate[] = [
    {
      kind: 'person',
      identityId: 'wokesocialid:v1:wokenet:v1:genesis:program:river',
      displayName: 'River Chen',
      bio: 'Building portable social infrastructure.',
      handle: 'river',
      updatedAt: '2026-07-28T12:00:00.000Z',
    },
    {
      kind: 'person',
      identityId: 'wokesocialid:v1:wokenet:v1:genesis:program:riverside',
      displayName: 'Riverside Lab',
      bio: '',
      handle: 'riverside',
      updatedAt: '2026-07-28T13:00:00.000Z',
    },
  ];

  it('normalizes Unicode, case, and whitespace before matching', () => {
    expect(normalizePublicSearchTerm('  RIVER\u212A \u2003  LAB  ')).toBe('riverk lab');
    expect(normalizePublicSearchTerm('ÉCLAIR')).toBe('Éclair');
  });

  it('validates the fully normalized code-point length and preserves controls for rejection', () => {
    expect(normalizePublicSearchTerm('\ufb03')).toBe('ffi');
    expect(isValidPublicSearchTerm(normalizePublicSearchTerm('\ufb03'))).toBe(true);
    expect(isValidPublicSearchTerm(normalizePublicSearchTerm('ＡＢ'))).toBe(false);
    expect(isValidPublicSearchTerm(normalizePublicSearchTerm('abc\tdef'))).toBe(false);
  });

  it('ranks an exact handle ahead of newer prefix matches', () => {
    expect(rankPublicSearchCandidates('@RIVER', people, 10)).toMatchObject([
      { kind: 'person', handle: 'river', matchedBy: 'handle' },
      { kind: 'person', handle: 'riverside', matchedBy: 'handle' },
    ]);
  });

  it('uses contains matching only when PostgreSQL can extract a conservative trigram', () => {
    expect(isIndexablePublicSearchContainsTerm('river')).toBe(true);
    expect(isIndexablePublicSearchContainsTerm('@ab')).toBe(false);
    expect(isIndexablePublicSearchContainsTerm('!!!')).toBe(false);
    expect(isIndexablePublicSearchContainsTerm('🔥🔥🔥')).toBe(false);
    expect(isIndexablePublicSearchContainsTerm('ab cd')).toBe(false);

    const candidates: readonly PublicSearchCandidate[] = [
      {
        kind: 'person',
        identityId: 'prefix',
        displayName: '!!! Prefix',
        bio: '',
        handle: 'abacus',
        updatedAt: '2026-07-28T12:00:00.000Z',
      },
      {
        kind: 'person',
        identityId: 'contains',
        displayName: 'Name !!! contains',
        bio: '',
        handle: 'zab',
        updatedAt: '2026-07-28T12:00:00.000Z',
      },
    ];
    expect(rankPublicSearchCandidates('@ab', candidates, 10)).toMatchObject([
      { identityId: 'prefix', matchedBy: 'handle' },
    ]);
    expect(rankPublicSearchCandidates('!!!', candidates, 10)).toMatchObject([
      { identityId: 'prefix', matchedBy: 'display-name' },
    ]);
  });

  it('applies the caller limit after stable relevance and recency ordering', () => {
    expect(rankPublicSearchCandidates('river', people, 1)).toHaveLength(1);
    expect(rankPublicSearchCandidates('river', people, 1)[0]).toMatchObject({
      handle: 'river',
    });
  });

  it('uses code-point ordering for deterministic non-ASCII ties', () => {
    const tied: readonly PublicSearchCandidate[] = [
      {
        kind: 'person',
        identityId: '😀',
        displayName: 'Tie member',
        bio: '',
        updatedAt: '2026-07-28T12:00:00.000Z',
      },
      {
        kind: 'person',
        identityId: 'é',
        displayName: 'Tie member',
        bio: '',
        updatedAt: '2026-07-28T12:00:00.000Z',
      },
    ];
    expect(
      rankPublicSearchCandidates('tie', tied, 10).map((result) =>
        result.kind === 'person' ? result.identityId : '',
      ),
    ).toEqual(['é', '😀']);
  });

  it('does not let identifier substrings crowd out a relevant result before limiting', () => {
    const irrelevant = Array.from({ length: 250 }, (_, index): PublicSearchCandidate => ({
      kind: 'person',
      identityId: `prefix-${index}-needle`,
      displayName: '',
      bio: '',
      updatedAt: '2026-07-28T12:00:00.000Z',
    }));
    const relevant: PublicSearchCandidate = {
      kind: 'person',
      identityId: 'relevant',
      displayName: 'Needle',
      bio: '',
      updatedAt: '2026-07-28T12:00:00.000Z',
    };
    expect(rankPublicSearchCandidates('needle', [...irrelevant, relevant], 1)).toMatchObject([
      { identityId: 'relevant', matchedBy: 'display-name' },
    ]);
  });
});
