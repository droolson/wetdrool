/** Browser-safe room identifiers and ciphertext-index presentation helpers. */

export interface RoomIndexEntry {
  readonly roomId: string;
  readonly messageCount: number;
  readonly lastActivityAt?: string | null;
}

export interface RoomIndexTotals {
  readonly roomCount: number;
  readonly sealedMessageCount: number;
}

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
  return { roomCount: rooms.length, sealedMessageCount };
}

export function exportRoomsIndexJson(rooms: readonly RoomIndexEntry[]): string {
  const rows = rooms.map((room) => ({
    roomId: room.roomId,
    messageCount:
      Number.isFinite(room.messageCount) && room.messageCount > 0
        ? Math.floor(room.messageCount)
        : 0,
    lastActivityAt:
      typeof room.lastActivityAt === 'string' && room.lastActivityAt.trim().length > 0
        ? room.lastActivityAt
        : null,
  }));
  return `${JSON.stringify(rows, null, 2)}\n`;
}

export function normalizeRoomId(raw: string): string | null {
  const value = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{1,62}$/.test(value) ? value : null;
}

/** Share link never includes a passphrase; room keys remain out of band. */
export function buildRoomShareUrl(roomId: string, origin?: string | null): string {
  const path = `/rooms/${encodeURIComponent(roomId.trim())}`;
  return origin ? `${origin.replace(/\/+$/, '')}${path}` : path;
}

export function formatNewMessagesAnnouncement(count: number): string | null {
  if (!Number.isSafeInteger(count) || count < 1) return null;
  return count === 1 ? '1 new message' : `${count} new messages`;
}
