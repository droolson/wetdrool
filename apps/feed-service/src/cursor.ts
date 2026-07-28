import { createHash } from 'node:crypto';

import type { RankRequest } from './schemas.js';

interface CursorPayload {
  readonly version: 1;
  readonly fingerprint: string;
  readonly offset: number;
  readonly previousItemId: string;
}

export class FeedCursorError extends Error {
  public readonly code = 'invalid-cursor';

  public constructor(message: string) {
    super(message);
    this.name = 'FeedCursorError';
  }
}

export function requestFingerprint(request: RankRequest): string {
  const fingerprintInput = {
    mode: request.mode,
    modeContext: request.modeContext,
    appliedPolicies: request.appliedPolicies,
    asOf: request.asOf,
    viewer: request.viewer,
    items: request.items,
  };
  return createHash('sha256').update(stableJson(fingerprintInput)).digest('base64url');
}

export function encodeCursor(payload: Omit<CursorPayload, 'version'>): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      fingerprint: payload.fingerprint,
      offset: payload.offset,
      previousItemId: payload.previousItemId,
    } satisfies CursorPayload),
  ).toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      typeof decoded !== 'object' ||
      decoded === null ||
      !('version' in decoded) ||
      decoded.version !== 1 ||
      !('fingerprint' in decoded) ||
      typeof decoded.fingerprint !== 'string' ||
      decoded.fingerprint.length !== 43 ||
      !('offset' in decoded) ||
      typeof decoded.offset !== 'number' ||
      !Number.isInteger(decoded.offset) ||
      decoded.offset < 1 ||
      decoded.offset > 500 ||
      !('previousItemId' in decoded) ||
      typeof decoded.previousItemId !== 'string' ||
      decoded.previousItemId.length < 1 ||
      decoded.previousItemId.length > 256
    ) {
      throw new FeedCursorError('Cursor structure is invalid.');
    }
    return decoded as CursorPayload;
  } catch (error) {
    if (error instanceof FeedCursorError) {
      throw error;
    }
    throw new FeedCursorError('Cursor is not valid base64url JSON.');
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableJson(entry)).join(',')}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}
