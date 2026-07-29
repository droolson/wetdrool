import { createHash } from 'node:crypto';

import {
  identityIdSchema,
  networkIdSchema,
  objectIdSchema,
  timestampSchema,
} from '@wokesocial/protocol';
import { z } from 'zod';

import type { FeedCursor, PostProjection } from './models.js';

export const MAX_FEED_CURSOR_LENGTH = 512;
export const OPEN_INDEXER_FEED_RECIPE = 'wokenet-open-indexer-feed-v1';

const FEED_CURSOR_SCOPE_DOMAIN = 'wokesocial:indexer:feed-cursor-scope:v3';

const feedCursorScopeSchema = z.discriminatedUnion('mode', [
  z
    .object({
      networkId: networkIdSchema,
      mode: z.literal('chronological'),
      viewerIdentityId: z.null(),
    })
    .strict(),
  z
    .object({
      networkId: networkIdSchema,
      mode: z.literal('following'),
      viewerIdentityId: identityIdSchema,
    })
    .strict(),
]);

const feedCursorPayloadSchema = z
  .object({
    v: z.literal(3),
    recipe: z.literal(OPEN_INDEXER_FEED_RECIPE),
    scope: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    createdAt: timestampSchema,
    objectId: objectIdSchema,
  })
  .strict();

export type FeedCursorScope = z.infer<typeof feedCursorScopeSchema>;

export function encodeFeedCursor(
  post: Pick<PostProjection, 'createdAt' | 'objectId'>,
  scope: FeedCursorScope,
): string {
  return Buffer.from(
    JSON.stringify({
      v: 3,
      recipe: OPEN_INDEXER_FEED_RECIPE,
      scope: feedCursorScopeDigest(scope),
      createdAt: post.createdAt,
      objectId: post.objectId,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeFeedCursor(value: string, scope: FeedCursorScope): FeedCursor {
  if (
    value.length === 0 ||
    value.length > MAX_FEED_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw invalidCursor();
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64url');
  } catch {
    throw invalidCursor();
  }
  if (decoded.toString('base64url') !== value || decoded.byteLength > 384) {
    throw invalidCursor();
  }
  let candidate: unknown;
  try {
    candidate = JSON.parse(decoded.toString('utf8')) as unknown;
  } catch {
    throw invalidCursor();
  }
  const parsed = feedCursorPayloadSchema.safeParse(candidate);
  if (!parsed.success) {
    throw invalidCursor();
  }
  if (parsed.data.scope !== feedCursorScopeDigest(scope)) {
    throw invalidCursor();
  }
  return {
    createdAt: parsed.data.createdAt,
    objectId: parsed.data.objectId,
  };
}

function feedCursorScopeDigest(scope: FeedCursorScope): string {
  const parsed = feedCursorScopeSchema.safeParse(scope);
  if (!parsed.success) {
    throw invalidCursor();
  }
  return createHash('sha256')
    .update(FEED_CURSOR_SCOPE_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(
      JSON.stringify([parsed.data.networkId, parsed.data.mode, parsed.data.viewerIdentityId]),
      'utf8',
    )
    .digest('base64url');
}

function invalidCursor(): Error {
  return new Error('Feed cursor is invalid.');
}
