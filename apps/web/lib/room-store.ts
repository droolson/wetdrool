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
  readonly after?: string;
}

export interface ListMessagesResult {
  readonly messages: readonly SealedEnvelope[];
  readonly total: number;
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
}

interface RoomsSnapshot {
  readonly version: 1;
  readonly rooms: Readonly<Record<string, readonly SealedEnvelope[]>>;
}

export const MAX_MESSAGES_PER_ROOM = 200;
export const DEFAULT_MESSAGE_LIMIT = 50;
export const MAX_MESSAGE_LIMIT = 100;

interface RoomBag {
  readonly kind: RoomStoreKind;
  list(roomId: string): SealedEnvelope[];
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
    note: durable
      ? 'File-backed ciphertext store on one node. Survives restarts; not multi-replica. Decrypt client-side.'
      : 'In-process ciphertext only. Lost on cold start / multi-instance. Set WETDROOL_ROOMS_DATA_PATH for single-node durability. Decrypt client-side.',
  };
}

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

  let slice = all;
  if (options.after) {
    const idx = all.findIndex((m) => m.messageId === options.after);
    if (idx >= 0) {
      slice = all.slice(idx + 1);
    } else {
      slice = all;
    }
  }

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
 */
export function appendMessage(envelope: SealedEnvelope): 'appended' | 'duplicate' {
  return getRoomBag().append(envelope);
}

export function normalizeRoomId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(t)) return null;
  return t;
}

export function isValidMessageId(raw: string): boolean {
  return typeof raw === 'string' && raw.length >= 8 && raw.length <= 128 && /^[\w.-]+$/.test(raw);
}
