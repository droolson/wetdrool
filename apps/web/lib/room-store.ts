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
 * Ciphertext-only room index: roomId + message counts. Never returns plaintext.
 */
export function listRooms(): readonly RoomIndexEntry[] {
  const store = getRoomBag();
  return store.listRoomIds().map((roomId) => ({
    roomId,
    messageCount: store.list(roomId).length,
  }));
}

export function normalizeRoomId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(t)) return null;
  return t;
}

export function isValidMessageId(raw: string): boolean {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 128 && /^[\w.-]+$/.test(raw);
}
