import { describe, expect, it } from 'vitest';

import {
  assertValidCommunityRuleSetTransition,
  assertValidDeletionTombstone,
  assertValidObjectTransition,
  assertValidPostRevisionTransition,
  assertValidReplacementTransition,
  buildCommunityRuleSetPayload,
  buildFollowEdgePayload,
  buildPostPayload,
  buildPostRevisionPayload,
  buildTombstonePayload,
  getObjectId,
} from '../src/index.js';
import { identity, postContent } from './fixtures.js';
import { fixedNonce, objectReference, otherIdentity } from './object-fixtures.js';

const optionsAt = (value: string) => ({
  createdAt: new Date(value),
  nonce: fixedNonce,
});

describe('immutable object transitions', () => {
  it('accepts an exact monotonically linked replacement', () => {
    const first = buildFollowEdgePayload(
      identity,
      {
        target: otherIdentity,
        state: 'active',
        replacement: { sequence: 1 },
      },
      optionsAt('2026-07-28T12:00:00.000Z'),
    );
    const second = buildFollowEdgePayload(
      identity,
      {
        target: otherIdentity,
        state: 'inactive',
        replacement: {
          sequence: 2,
          replaces: { id: getObjectId(first) },
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );

    expect(() => assertValidReplacementTransition(first, second)).not.toThrow();
    expect(() => assertValidObjectTransition(first, second)).not.toThrow();
  });

  it('rejects skipped sequences, false prior IDs, and changed edge subjects', () => {
    const first = buildFollowEdgePayload(
      identity,
      {
        target: otherIdentity,
        state: 'active',
        replacement: { sequence: 1 },
      },
      optionsAt('2026-07-28T12:00:00.000Z'),
    );
    const wrongSequence = buildFollowEdgePayload(
      identity,
      {
        target: otherIdentity,
        state: 'inactive',
        replacement: {
          sequence: 3,
          replaces: { id: getObjectId(first) },
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const wrongPrior = buildFollowEdgePayload(
      identity,
      {
        target: otherIdentity,
        state: 'inactive',
        replacement: {
          sequence: 2,
          replaces: objectReference('follow-edge'),
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const changedSubject = buildFollowEdgePayload(
      identity,
      {
        target: otherIdentity.replace(/.$/u, '3'),
        state: 'inactive',
        replacement: {
          sequence: 2,
          replaces: { id: getObjectId(first) },
        },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );

    expect(() => assertValidReplacementTransition(first, wrongSequence)).toThrow(
      /increase by exactly one/u,
    );
    expect(() => assertValidReplacementTransition(first, wrongPrior)).toThrow(
      /exact prior object ID/u,
    );
    expect(() => assertValidReplacementTransition(first, changedSubject)).toThrow(
      /cannot change their subject/u,
    );
  });

  it('validates immutable post revision lineage', () => {
    const original = buildPostPayload(identity, postContent, optionsAt('2026-07-28T12:00:00.000Z'));
    const originalReference = { id: getObjectId(original) };
    const revision = buildPostRevisionPayload(
      identity,
      {
        original: originalReference,
        previous: originalReference,
        revision: 2,
        content: { ...postContent, body: 'Corrected text.' },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const falseLineage = buildPostRevisionPayload(
      identity,
      {
        original: originalReference,
        previous: objectReference('post'),
        revision: 3,
        content: { ...postContent, body: 'Incorrect lineage.' },
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );

    expect(() => assertValidPostRevisionTransition(original, revision)).not.toThrow();
    expect(() => assertValidPostRevisionTransition(original, falseLineage)).toThrow(
      /exact prior object ID/u,
    );
  });

  it('validates deletion ownership, timing, and the exact target hash', () => {
    const target = buildPostPayload(identity, postContent, optionsAt('2026-07-28T12:00:00.000Z'));
    const tombstone = buildTombstonePayload(
      identity,
      {
        target: { id: getObjectId(target) },
        reason: 'author-deleted',
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );
    const falseTarget = buildTombstonePayload(
      identity,
      {
        target: objectReference('post'),
        reason: 'author-deleted',
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );

    expect(() => assertValidDeletionTombstone(target, tombstone)).not.toThrow();
    expect(() => assertValidDeletionTombstone(target, falseTarget)).toThrow(
      /exact target object ID/u,
    );
  });

  it('requires exact community rule-set version links', () => {
    const community = objectReference('community');
    const first = buildCommunityRuleSetPayload(
      identity,
      {
        community,
        version: 1,
        rules: [
          {
            id: 'respect',
            title: 'Respect people',
            description: 'No targeted harassment.',
            severity: 'removal',
            appealable: true,
          },
        ],
        moderationProviders: [],
      },
      optionsAt('2026-07-28T12:00:00.000Z'),
    );
    const second = buildCommunityRuleSetPayload(
      identity,
      {
        community,
        version: 2,
        previous: { id: getObjectId(first) },
        rules: [
          {
            id: 'respect',
            title: 'Respect people',
            description: 'No harassment, threats, or dehumanization.',
            severity: 'removal',
            appealable: true,
          },
        ],
        moderationProviders: [],
      },
      optionsAt('2026-07-28T12:00:01.000Z'),
    );

    expect(() => assertValidCommunityRuleSetTransition(first, second)).not.toThrow();
  });
});
