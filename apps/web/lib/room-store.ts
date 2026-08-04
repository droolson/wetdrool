/**
 * Ephemeral in-process ciphertext store for E2EE rooms (Vercel alpha).
 * Production: Cloudflare KV / Durable Objects — ciphertext only, same schema.
 */

import type { SealedEnvelope } from './e2ee-seal';

export interface RoomRecord {
  readonly roomId: string;
  readonly messages: SealedEnvelope[];
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

const MAX_MESSAGES = 200;

export function listMessages(roomId: string): readonly SealedEnvelope[] {
  return bag().get(roomId) ?? [];
}

export function appendMessage(envelope: SealedEnvelope): void {
  const id = envelope.roomId;
  const prev = bag().get(id) ?? [];
  const next = [...prev, envelope].slice(-MAX_MESSAGES);
  bag().set(id, next);
}

export function normalizeRoomId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(t)) return null;
  return t;
}
