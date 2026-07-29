import { createHash } from 'node:crypto';

import { networkIdSchema, solanaPublicKeySchema } from '@wokesocial/protocol';
import { z } from 'zod';

import type { CommunityDirectoryCursor } from './models.js';

export const COMMUNITY_DIRECTORY_RECIPE = 'community-directory-v1' as const;
export const MAX_COMMUNITY_CURSOR_LENGTH = 512;
export const SOLANA_U64_MAX = 18_446_744_073_709_551_615n;

const COMMUNITY_CURSOR_SCOPE_DOMAIN = 'wokenet:indexer:community-directory-cursor-scope:v1';

const cursorPayloadSchema = z
  .object({
    v: z.literal(1),
    recipe: z.literal(COMMUNITY_DIRECTORY_RECIPE),
    scope: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
    createdSlot: z
      .string()
      .regex(/^(?:0|[1-9][0-9]*)$/u)
      .max(20)
      .refine((value) => BigInt(value) <= SOLANA_U64_MAX),
    communityAddress: solanaPublicKeySchema,
  })
  .strict();

export function encodeCommunityDirectoryCursor(
  cursor: CommunityDirectoryCursor,
  networkId: string,
): string {
  const network = networkIdSchema.parse(networkId);
  if (cursor.createdSlot < 0n || cursor.createdSlot > SOLANA_U64_MAX) {
    throw invalidCursor();
  }
  const communityAddress = solanaPublicKeySchema.safeParse(cursor.communityAddress);
  if (!communityAddress.success) {
    throw invalidCursor();
  }
  return Buffer.from(
    JSON.stringify({
      v: 1,
      recipe: COMMUNITY_DIRECTORY_RECIPE,
      scope: scopeDigest(network),
      createdSlot: cursor.createdSlot.toString(),
      communityAddress: communityAddress.data,
    }),
    'utf8',
  ).toString('base64url');
}

export function decodeCommunityDirectoryCursor(
  value: string,
  networkId: string,
): CommunityDirectoryCursor {
  const network = networkIdSchema.parse(networkId);
  if (
    value.length === 0 ||
    value.length > MAX_COMMUNITY_CURSOR_LENGTH ||
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
  const parsed = cursorPayloadSchema.safeParse(candidate);
  if (!parsed.success || parsed.data.scope !== scopeDigest(network)) {
    throw invalidCursor();
  }
  return {
    createdSlot: BigInt(parsed.data.createdSlot),
    communityAddress: parsed.data.communityAddress,
  };
}

function scopeDigest(networkId: string): string {
  return createHash('sha256')
    .update(COMMUNITY_CURSOR_SCOPE_DOMAIN, 'utf8')
    .update('\0', 'utf8')
    .update(JSON.stringify([COMMUNITY_DIRECTORY_RECIPE, networkId]), 'utf8')
    .digest('base64url');
}

function invalidCursor(): Error {
  return new Error('Community directory cursor is invalid.');
}
