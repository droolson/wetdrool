import { objectIdSchema, timestampSchema } from '@wokesocial/protocol';
import { z } from 'zod';

import type { FeedCursor, PostProjection } from './models.js';

export const MAX_FEED_CURSOR_LENGTH = 512;

const feedCursorPayloadSchema = z
  .object({
    v: z.literal(1),
    createdAt: timestampSchema,
    objectId: objectIdSchema,
  })
  .strict();

export function encodeFeedCursor(post: Pick<PostProjection, 'createdAt' | 'objectId'>): string {
  return Buffer.from(
    JSON.stringify({
      v: 1,
      createdAt: post.createdAt,
      objectId: post.objectId,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeFeedCursor(value: string): FeedCursor {
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
  return {
    createdAt: parsed.data.createdAt,
    objectId: parsed.data.objectId,
  };
}

function invalidCursor(): Error {
  return new Error('Feed cursor is invalid.');
}
