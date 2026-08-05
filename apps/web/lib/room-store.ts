/**
 * Ciphertext store for E2EE rooms.
 * Default: in-process memory (Vercel alpha).
 * Optional single-node durability: WETDROOL_ROOMS_DATA_PATH (absolute JSON path).
 * Production target: Cloudflare KV / Durable Objects — ciphertext only, same schema.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import type { SealedEnvelope } from './e2ee-seal';

export interface RoomRecord {
  readonly roomId: string;
  readonly messages: SealedEnvelope[];
}

export interface ListMessagesOptions {
  readonly limit?: number;
  /** Exclusive cursor: return messages after this messageId (newer / poll). */
  readonly after?: string;
  /** Exclusive cursor: return messages before this messageId (older / history). */
  readonly before?: string;
}

export interface ListMessagesResult {
  readonly messages: readonly SealedEnvelope[];
  readonly total: number;
  /** True when more older history exists than this page (use `before` with first id). */
  readonly hasMoreOlder: boolean;
  /** True when more newer messages exist than this page (use `after` with last id). */
  readonly hasMoreNewer: boolean;
  /** @deprecated Prefer hasMoreOlder / hasMoreNewer. Kept for existing clients. */
  readonly hasMore: boolean;
  readonly truncated: boolean;
}

export type RoomStoreKind = 'memory-ephemeral' | 'file-local';

export interface RoomStoreMeta {
  readonly kind: RoomStoreKind;
  readonly multiReplicaSafe: false;
  readonly durableAcrossRestart: boolean;
  readonly maxMessagesPerRoom: number;
  readonly note: string;
  /** Short badge label for UI (ephemeral vs single-node file). */
  readonly label: string;
}

interface RoomsSnapshot {
  readonly version: 1;
  readonly rooms: Readonly<Record<string, readonly SealedEnvelope[]>>;
}

export const MAX_MESSAGES_PER_ROOM = 200;
export const DEFAULT_MESSAGE_LIMIT = 50;
export const MAX_MESSAGE_LIMIT = 100;

export interface RoomIndexEntry {
  readonly roomId: string;
  readonly messageCount: number;
  /**
   * ISO timestamp of the newest sealed envelope's `createdAt`, when present.
   * Ciphertext metadata only — never plaintext.
   */
  readonly lastActivityAt: string | null;
}

interface RoomBag {
  readonly kind: RoomStoreKind;
  list(roomId: string): SealedEnvelope[];
  listRoomIds(): readonly string[];
  append(envelope: SealedEnvelope): 'appended' | 'duplicate';
}

const g = globalThis as unknown as {
  __wetdroolRoomBag?: RoomBag;
  __wetdroolRooms?: Map<string, SealedEnvelope[]>;
};

function resolveDataPath(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  const raw = env.WETDROOL_ROOMS_DATA_PATH?.trim();
  if (!raw) return null;
  if (!raw.startsWith('/') && !/^[A-Za-z]:[\\/]/.test(raw)) return null;
  return raw;
}

/** Newest `createdAt` among sealed messages (string compare works for ISO-8601). */
export function newestActivityAt(messages: readonly SealedEnvelope[]): string | null {
  let best: string | null = null;
  for (const m of messages) {
    const at = m.createdAt;
    if (typeof at !== 'string' || at.length === 0) continue;
    if (best === null || at > best) best = at;
  }
  return best;
}

class MemoryRoomBag implements RoomBag {
  readonly kind = 'memory-ephemeral' as const;
  private readonly bag = new Map<string, SealedEnvelope[]>();

  list(roomId: string): SealedEnvelope[] {
    return this.bag.get(roomId) ?? [];
  }

  listRoomIds(): readonly string[] {
    return [...this.bag.keys()].sort((a, b) => a.localeCompare(b));
  }

  append(envelope: SealedEnvelope): 'appended' | 'duplicate' {
    const id = envelope.roomId;
    const prev = this.bag.get(id) ?? [];
    if (prev.some((m) => m.messageId === envelope.messageId)) return 'duplicate';
    const next = [...prev, envelope].slice(-MAX_MESSAGES_PER_ROOM);
    this.bag.set(id, next);
    return 'appended';
  }
}

class FileRoomBag implements RoomBag {
  readonly kind = 'file-local' as const;
  private readonly bag = new Map<string, SealedEnvelope[]>();
  private loaded = false;

  constructor(private readonly path: string) {}

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loaded = true;
    try {
      if (!existsSync(this.path)) return;
      const raw = readFileSync(this.path, 'utf8');
      const parsed = JSON.parse(raw) as Partial<RoomsSnapshot>;
      if (parsed.version !== 1 || !parsed.rooms || typeof parsed.rooms !== 'object') return;
      for (const [roomId, messages] of Object.entries(parsed.rooms)) {
        if (!Array.isArray(messages)) continue;
        const sealed = messages.filter(
          (m): m is SealedEnvelope =>
            Boolean(m) &&
            typeof m === 'object' &&
            typeof (m as SealedEnvelope).messageId === 'string' &&
            typeof (m as SealedEnvelope).ciphertextBase64 === 'string',
        );
        this.bag.set(roomId, sealed.slice(-MAX_MESSAGES_PER_ROOM));
      }
    } catch {
      // Corrupt file: start empty rather than crash chat.
    }
  }

  private persist(): void {
    const rooms: Record<string, readonly SealedEnvelope[]> = {};
    for (const [id, messages] of this.bag.entries()) {
      rooms[id] = messages;
    }
    const snapshot: RoomsSnapshot = { version: 1, rooms };
    const dir = dirname(this.path);
    mkdirSync(dir, { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(snapshot), 'utf8');
    renameSync(tmp, this.path);
  }

  list(roomId: string): SealedEnvelope[] {
    this.ensureLoaded();
    return this.bag.get(roomId) ?? [];
  }

  listRoomIds(): readonly string[] {
    this.ensureLoaded();
    return [...this.bag.keys()].sort((a, b) => a.localeCompare(b));
  }

  append(envelope: SealedEnvelope): 'appended' | 'duplicate' {
    this.ensureLoaded();
    const id = envelope.roomId;
    const prev = this.bag.get(id) ?? [];
    if (prev.some((m) => m.messageId === envelope.messageId)) return 'duplicate';
    const next = [...prev, envelope].slice(-MAX_MESSAGES_PER_ROOM);
    this.bag.set(id, next);
    this.persist();
    return 'appended';
  }
}

export function getRoomBag(
  env: Readonly<Record<string, string | undefined>> = process.env,
  options?: { readonly forceNew?: boolean },
): RoomBag {
  if (!options?.forceNew && g.__wetdroolRoomBag && env === process.env) {
    return g.__wetdroolRoomBag;
  }
  const path = resolveDataPath(env);
  const store: RoomBag = path ? new FileRoomBag(path) : new MemoryRoomBag();
  if (!options?.forceNew && env === process.env) {
    g.__wetdroolRoomBag = store;
  }
  return store;
}

export function resetRoomStoreCache(): void {
  delete g.__wetdroolRoomBag;
  delete g.__wetdroolRooms;
}

export function getRoomStoreKind(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RoomStoreKind {
  return resolveDataPath(env) ? 'file-local' : 'memory-ephemeral';
}

export function getRoomStoreMeta(
  env: Readonly<Record<string, string | undefined>> = process.env,
): RoomStoreMeta {
  const kind = getRoomStoreKind(env);
  const durable = kind === 'file-local';
  return {
    kind,
    multiReplicaSafe: false,
    durableAcrossRestart: durable,
    maxMessagesPerRoom: MAX_MESSAGES_PER_ROOM,
    label: durable ? 'file · restart-durable · single node' : 'memory · ephemeral · not multi-replica',
    note: durable
      ? 'File-backed ciphertext on one node. Survives process restarts; not multi-replica safe. Decrypt only in the browser with the room key.'
      : 'In-process ciphertext only — lost on cold start, deploy, or multi-instance routing. Set WETDROOL_ROOMS_DATA_PATH (absolute path) for single-node file durability. Decrypt only in the browser.',
  };
}

/**
 * List sealed envelopes for a room (oldest → newest within the returned page).
 *
 * - No cursor: last `limit` messages (tail).
 * - `after`: messages strictly after that id (poll / live).
 * - `before`: messages strictly before that id (load older history).
 * - If both `after` and `before` are set, `after` wins.
 */
export function listMessages(
  roomId: string,
  options: ListMessagesOptions = {},
): ListMessagesResult {
  const all = getRoomBag().list(roomId);
  const total = all.length;
  const limit = Math.min(
    Math.max(1, options.limit ?? DEFAULT_MESSAGE_LIMIT),
    MAX_MESSAGE_LIMIT,
  );

  if (options.after) {
    const idx = all.findIndex((m) => m.messageId === options.after);
    // Unknown cursor: return empty page (poll clients should full-reload).
    const newer = idx >= 0 ? all.slice(idx + 1) : [];
    const messages = newer.slice(0, limit);
    const hasMoreNewer = newer.length > limit;
    return {
      messages,
      total,
      hasMoreOlder: false,
      hasMoreNewer,
      hasMore: hasMoreNewer,
      truncated: hasMoreNewer,
    };
  }

  if (options.before) {
    const idx = all.findIndex((m) => m.messageId === options.before);
    const older = idx > 0 ? all.slice(0, idx) : idx === 0 ? [] : all;
    const truncated = older.length > limit;
    const messages = truncated ? older.slice(-limit) : older;
    const hasMoreOlder = truncated;
    const firstId = messages[0]?.messageId;
    const firstIdx = firstId ? all.findIndex((m) => m.messageId === firstId) : -1;
    const hasMoreOlderStrict = firstIdx > 0 || truncated;
    return {
      messages,
      total,
      hasMoreOlder: hasMoreOlderStrict,
      hasMoreNewer: true,
      hasMore: hasMoreOlderStrict,
      truncated,
    };
  }

  // Default: newest page (tail).
  const truncated = all.length > limit;
  const messages = truncated ? all.slice(-limit) : all;
  const hasMoreOlder = truncated;
  return {
    messages,
    total,
    hasMoreOlder,
    hasMoreNewer: false,
    hasMore: hasMoreOlder,
    truncated,
  };
}

/**
 * Append ciphertext. Dedupes by messageId (idempotent client retries).
 */
export function appendMessage(envelope: SealedEnvelope): 'appended' | 'duplicate' {
  return getRoomBag().append(envelope);
}

/**
 * Ciphertext-only room index: roomId, counts, last activity. Never returns plaintext.
 * Sorted by roomId ascending (stable); callers may re-sort by lastActivityAt.
 */
export function listRooms(): readonly RoomIndexEntry[] {
  const store = getRoomBag();
  return store.listRoomIds().map((roomId) => {
    const messages = store.list(roomId);
    return {
      roomId,
      messageCount: messages.length,
      lastActivityAt: newestActivityAt(messages),
    };
  });
}

/**
 * Sort index entries by last activity (newest first). Rooms without activity stay last.
 * Pure helper for index UI — does not touch the bag.
 */
export function sortRoomsByActivity(
  rooms: readonly RoomIndexEntry[],
): readonly RoomIndexEntry[] {
  return [...rooms].sort((a, b) => {
    const at = a.lastActivityAt ?? '';
    const bt = b.lastActivityAt ?? '';
    if (at === bt) return a.roomId.localeCompare(b.roomId);
    if (!at) return 1;
    if (!bt) return -1;
    return bt.localeCompare(at);
  });
}

export interface RoomIndexTotals {
  readonly roomCount: number;
  /** Sum of sealed envelope counts across rooms (ciphertext metadata only). */
  readonly sealedMessageCount: number;
}

/**
 * Aggregate ciphertext-only index stats for headers and a11y status.
 * Pure — does not touch the bag; never includes plaintext.
 */
export function summarizeRoomIndex(
  rooms: readonly Pick<RoomIndexEntry, 'messageCount'>[],
): RoomIndexTotals {
  let sealedMessageCount = 0;
  for (const room of rooms) {
    const n = room.messageCount;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) {
      sealedMessageCount += Math.floor(n);
    }
  }
  return {
    roomCount: rooms.length,
    sealedMessageCount,
  };
}

/**
 * Pure: serialize ciphertext-only room index metadata for client download.
 * Emits roomId + messageCount + lastActivityAt only — never ciphertext or plaintext.
 * Unknown / non-finite counts become 0; missing activity is null.
 */
export function exportRoomsIndexJson(
  rooms: readonly Pick<RoomIndexEntry, 'roomId' | 'messageCount' | 'lastActivityAt'>[],
): string {
  const rows = rooms.map((room) => {
    const rawCount = room.messageCount;
    const messageCount =
      typeof rawCount === 'number' && Number.isFinite(rawCount) && rawCount > 0
        ? Math.floor(rawCount)
        : 0;
    const at = room.lastActivityAt;
    const lastActivityAt = typeof at === 'string' && at.length > 0 ? at : null;
    return {
      roomId: typeof room.roomId === 'string' ? room.roomId : '',
      messageCount,
      lastActivityAt,
    };
  });
  return `${JSON.stringify(rows, null, 2)}\n`;
}

export function normalizeRoomId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(t)) return null;
  return t;
}

export function isValidMessageId(raw: string): boolean {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 128 && /^[\w.-]+$/.test(raw);
}

/**
 * Path or absolute URL for sharing a room (no passphrase — share key out of band).
 * Uses encodeURIComponent on the room id segment.
 */
export function buildRoomShareUrl(roomId: string, origin?: string | null): string {
  const id = roomId.trim();
  const path = `/rooms/${encodeURIComponent(id)}`;
  if (!origin) return path;
  const base = origin.replace(/\/+$/, '');
  return `${base}${path}`;
}


/**
 * Screen-reader copy for poll-arriving messages.
 * Returns null when count is not a positive safe integer (skip announcement).
 */
export function formatNewMessagesAnnouncement(count: number): string | null {
  if (!Number.isSafeInteger(count) || count < 1) {
    return null;
  }
  if (count === 1) {
    return '1 new message';
  }
  return `${count} new messages`;
}
