import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { SEAL_PROTOCOL, type SealedEnvelope } from '../lib/e2ee-seal';
import {
  appendMessage,
  getRoomBag,
  getRoomStoreKind,
  getRoomStoreMeta,
  isValidMessageId,
  listMessages,
  listRooms,
  newestActivityAt,
  buildRoomShareUrl,
  normalizeRoomId,
  resetRoomStoreCache,
  sortRoomsByActivity,
  summarizeRoomIndex,
  type RoomIndexEntry,
} from '../lib/room-store';

function env(
  roomId: string,
  messageId: string,
  createdAt = new Date().toISOString(),
): SealedEnvelope {
  return {
    protocol: SEAL_PROTOCOL,
    roomId,
    messageId,
    createdAt,
    contentType: 'text/plain',
    ivBase64: 'aGk=',
    ciphertextBase64: 'Y2lwaGVy',
    compression: 'middle-out-lite-v1',
    from: 'tester',
  };
}

describe('room-store', () => {
  afterEach(() => {
    resetRoomStoreCache();
  });

  it('normalizes room ids', () => {
    expect(normalizeRoomId('Lobby')).toBe('lobby');
    expect(normalizeRoomId('a')).toBe(null);
    expect(normalizeRoomId('ok-room_1')).toBe('ok-room_1');
    expect(normalizeRoomId('../x')).toBe(null);
  });

  it('builds share URLs without embedding secrets', () => {
    expect(buildRoomShareUrl('lobby')).toBe('/rooms/lobby');
    expect(buildRoomShareUrl('lobby', 'https://wetdrool.com')).toBe('https://wetdrool.com/rooms/lobby');
    expect(buildRoomShareUrl('lobby', 'https://wetdrool.com/')).toBe('https://wetdrool.com/rooms/lobby');
    expect(buildRoomShareUrl('a/b', 'http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000/rooms/a%2Fb',
    );
  });

  it('validates message ids', () => {
    expect(isValidMessageId('12345678')).toBe(true);
    expect(isValidMessageId('short')).toBe(false);
    expect(isValidMessageId(crypto.randomUUID())).toBe(true);
  });

  it('appends, dedupes, and paginates in memory', () => {
    const room = 'test-room';
    expect(appendMessage(env(room, 'msg-00001'))).toBe('appended');
    expect(appendMessage(env(room, 'msg-00001'))).toBe('duplicate');
    expect(appendMessage(env(room, 'msg-00002'))).toBe('appended');
    expect(appendMessage(env(room, 'msg-00003'))).toBe('appended');

    const all = listMessages(room, { limit: 100 });
    expect(all.total).toBe(3);
    expect(all.messages.map((m) => m.messageId)).toEqual([
      'msg-00001',
      'msg-00002',
      'msg-00003',
    ]);
    expect(all.hasMoreOlder).toBe(false);
    expect(all.hasMoreNewer).toBe(false);

    const page = listMessages(room, { limit: 2 });
    expect(page.messages).toHaveLength(2);
    expect(page.messages.map((m) => m.messageId)).toEqual(['msg-00002', 'msg-00003']);
    expect(page.truncated).toBe(true);
    expect(page.hasMoreOlder).toBe(true);
    expect(page.hasMore).toBe(true);

    const after = listMessages(room, { after: 'msg-00001', limit: 10 });
    expect(after.messages.map((m) => m.messageId)).toEqual(['msg-00002', 'msg-00003']);
    expect(after.hasMoreNewer).toBe(false);

    expect(getRoomStoreMeta().kind).toBe('memory-ephemeral');
    expect(getRoomStoreMeta().durableAcrossRestart).toBe(false);
    expect(getRoomStoreMeta().multiReplicaSafe).toBe(false);
    expect(getRoomStoreMeta().label).toContain('ephemeral');
    expect(getRoomStoreMeta().note.toLowerCase()).toContain('cold start');
  });

  it('paginates older history with before cursor', () => {
    const room = 'hist-room';
    for (let i = 1; i <= 5; i++) {
      appendMessage(env(room, `msg-hist-${String(i).padStart(2, '0')}`));
    }

    const tail = listMessages(room, { limit: 2 });
    expect(tail.messages.map((m) => m.messageId)).toEqual(['msg-hist-04', 'msg-hist-05']);
    expect(tail.hasMoreOlder).toBe(true);

    const older = listMessages(room, { before: 'msg-hist-04', limit: 2 });
    expect(older.messages.map((m) => m.messageId)).toEqual(['msg-hist-02', 'msg-hist-03']);
    expect(older.hasMoreOlder).toBe(true);
    expect(older.hasMoreNewer).toBe(true);

    const oldest = listMessages(room, { before: 'msg-hist-02', limit: 10 });
    expect(oldest.messages.map((m) => m.messageId)).toEqual(['msg-hist-01']);
    expect(oldest.hasMoreOlder).toBe(false);
  });

  it('returns empty page for unknown after cursor (poll miss)', () => {
    const room = 'miss-room';
    appendMessage(env(room, 'msg-known1'));
    const page = listMessages(room, { after: 'msg-missing-xx', limit: 10 });
    expect(page.messages).toEqual([]);
    expect(page.total).toBe(1);
  });

  it('indexes rooms with ciphertext counts and last activity only', () => {
    appendMessage(env('alpha', 'msg-alpha1', '2026-01-01T00:00:00.000Z'));
    appendMessage(env('beta', 'msg-beta01', '2026-01-02T00:00:00.000Z'));
    appendMessage(env('beta', 'msg-beta02', '2026-01-03T12:00:00.000Z'));
    const index = listRooms();
    expect(index).toEqual([
      {
        roomId: 'alpha',
        messageCount: 1,
        lastActivityAt: '2026-01-01T00:00:00.000Z',
      },
      {
        roomId: 'beta',
        messageCount: 2,
        lastActivityAt: '2026-01-03T12:00:00.000Z',
      },
    ]);
  });

  it('newestActivityAt picks max ISO createdAt', () => {
    expect(newestActivityAt([])).toBe(null);
    expect(
      newestActivityAt([
        env('r', 'a', '2026-01-01T00:00:00.000Z'),
        env('r', 'b', '2026-02-01T00:00:00.000Z'),
        env('r', 'c', '2026-01-15T00:00:00.000Z'),
      ]),
    ).toBe('2026-02-01T00:00:00.000Z');
  });

  it('sortRoomsByActivity orders newest first', () => {
    const rows: RoomIndexEntry[] = [
      { roomId: 'old', messageCount: 1, lastActivityAt: '2026-01-01T00:00:00.000Z' },
      { roomId: 'new', messageCount: 2, lastActivityAt: '2026-03-01T00:00:00.000Z' },
      { roomId: 'mid', messageCount: 1, lastActivityAt: '2026-02-01T00:00:00.000Z' },
      { roomId: 'none', messageCount: 0, lastActivityAt: null },
    ];
    expect(sortRoomsByActivity(rows).map((r) => r.roomId)).toEqual([
      'new',
      'mid',
      'old',
      'none',
    ]);
  });

  it('listRooms is empty when bag is empty', () => {
    expect(listRooms()).toEqual([]);
  });

  it('summarizeRoomIndex totals rooms and sealed messages', () => {
    expect(summarizeRoomIndex([])).toEqual({ roomCount: 0, sealedMessageCount: 0 });
    expect(
      summarizeRoomIndex([
        { roomId: 'a', messageCount: 1, lastActivityAt: null },
        { roomId: 'b', messageCount: 3, lastActivityAt: '2026-01-01T00:00:00.000Z' },
        { roomId: 'c', messageCount: 0, lastActivityAt: null },
      ]),
    ).toEqual({ roomCount: 3, sealedMessageCount: 4 });
    // Ignores non-positive / non-finite counts when summing messages
    expect(
      summarizeRoomIndex([
        { messageCount: 2 },
        { messageCount: -1 },
        { messageCount: Number.NaN },
      ]),
    ).toEqual({ roomCount: 3, sealedMessageCount: 2 });
  });

  it('file store survives re-open', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wd-rooms-'));
    const path = join(dir, 'rooms.json');
    try {
      const envMap = { WETDROOL_ROOMS_DATA_PATH: path };
      expect(getRoomStoreKind(envMap)).toBe('file-local');
      const a = getRoomBag(envMap, { forceNew: true });
      expect(a.kind).toBe('file-local');
      expect(a.append(env('lobby', 'msg-file-01'))).toBe('appended');
      const b = getRoomBag(envMap, { forceNew: true });
      expect(b.list('lobby').map((m) => m.messageId)).toEqual(['msg-file-01']);
      expect(getRoomStoreMeta(envMap).durableAcrossRestart).toBe(true);
      expect(getRoomStoreMeta(envMap).label).toContain('file');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
