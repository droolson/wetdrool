/**
 * Ephemeral in-process ciphertext store for E2EE rooms (Vercel alpha).
 * Production: Cloudflare KV / Durable Objects — ciphertext only, same schema.
 */

import type { SealedEnvelope } from './e2ee-seal';

export interface RoomRecord {
  readonly roomId: string;
  readonly messages: SealedEnvelope[];
}

export interface ListMessagesOptions {
  /** Max messages to return (newest-first after slice of history). */
  readonly limit?: number;
  /** Return only messages after this messageId (exclusive), in store order. */
  readonly after?: string;
}

export interface ListMessagesResult {
  readonly messages: readonly SealedEnvelope[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly truncated: boolean;
}

const globalStore = globalThis as unknown as {
  __wetdroolRooms?: Map<string, SealedEnvelope[]>;
};

function bag(): Map<string, SealedEnvelope[]> {
  if (!globalStore.__wetdroolRooms) {
    globalStore.__wetdroolRooms = new Map();
  }
  return globalStore.__wetdroolRooms;
}

export const MAX_MESSAGES_PER_ROOM = 200;
export const DEFAULT_MESSAGE_LIMIT = 50;
export const MAX_MESSAGE_LIMIT = 100;

/** Test helper. */
export function resetRoomStoreCache(): void {
  delete globalStore.__wetdroolRooms;
}

export function getRoomStoreMeta(): {
  readonly kind: 'memory-ephemeral';
  readonly multiReplicaSafe: false;
  readonly maxMessagesPerRoom: number;
  readonly note: string;
} {
  return {
    kind: 'memory-ephemeral',
    multiReplicaSafe: false,
    maxMessagesPerRoom: MAX_MESSAGES_PER_ROOM,
    note: 'In-process ciphertext only. Lost on cold start / multi-instance. Decrypt client-side.',
  };
}

export function listMessages(
  roomId: string,
  options: ListMessagesOptions = {},
): ListMessagesResult {
  const all = bag().get(roomId) ?? [];
  const total = all.length;
  const limit = Math.min(
    Math.max(1, options.limit ?? DEFAULT_MESSAGE_LIMIT),
    MAX_MESSAGE_LIMIT,
  );

  let slice = all;
  if (options.after) {
    const idx = all.findIndex((m) => m.messageId === options.after);
    if (idx >= 0) {
      slice = all.slice(idx + 1);
    } else {
      // Unknown cursor: return latest window (client should full-refresh).
      slice = all;
    }
  }

  // Prefer newest when over limit and no after cursor (full history window).
  const truncated = slice.length > limit;
  const messages =
    options.after || slice.length <= limit ? slice.slice(0, limit) : slice.slice(-limit);

  return {
    messages,
    total,
    hasMore: options.after ? all.length > 0 && messages.length === limit : truncated,
    truncated,
  };
}

/**
 * Append ciphertext. Dedupes by messageId (idempotent client retries).
 * @returns 'appended' | 'duplicate'
 */
export function appendMessage(envelope: SealedEnvelope): 'appended' | 'duplicate' {
  const id = envelope.roomId;
  const prev = bag().get(id) ?? [];
  if (prev.some((m) => m.messageId === envelope.messageId)) {
    return 'duplicate';
  }
  const next = [...prev, envelope].slice(-MAX_MESSAGES_PER_ROOM);
  bag().set(id, next);
  return 'appended';
}

export function normalizeRoomId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(t)) return null;
  return t;
}

export function isValidMessageId(raw: string): boolean {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 128 && /^[\w.-]+$/.test(raw);
}
