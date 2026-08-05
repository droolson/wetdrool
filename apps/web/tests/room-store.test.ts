import { describe, expect, it, afterEach } from 'vitest';

import { SEAL_PROTOCOL, type SealedEnvelope } from '../lib/e2ee-seal';
import {
  appendMessage,
  getRoomStoreMeta,
  isValidMessageId,
  listMessages,
  normalizeRoomId,
  resetRoomStoreCache,
} from '../lib/room-store';

function env(roomId: string, messageId: string): SealedEnvelope {
  return {
    protocol: SEAL_PROTOCOL,
    roomId,
    messageId,
    createdAt: new Date().toISOString(),
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

  it('validates message ids', () => {
    expect(isValidMessageId('12345678')).toBe(true);
    expect(isValidMessageId('short')).toBe(false);
    expect(isValidMessageId(crypto.randomUUID())).toBe(true);
  });

  it('appends, dedupes, and paginates', () => {
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

    const page = listMessages(room, { limit: 2 });
    expect(page.messages).toHaveLength(2);
    expect(page.truncated).toBe(true);

    const after = listMessages(room, { after: 'msg-00001', limit: 10 });
    expect(after.messages.map((m) => m.messageId)).toEqual(['msg-00002', 'msg-00003']);

    expect(getRoomStoreMeta().kind).toBe('memory-ephemeral');
    expect(getRoomStoreMeta().multiReplicaSafe).toBe(false);
  });
});
