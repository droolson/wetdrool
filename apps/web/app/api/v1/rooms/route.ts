import { getRoomStoreMeta, listRooms } from '@/lib/room-store';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/rooms
 * Ciphertext-only room index for this node (roomId + messageCount).
 * No plaintext, no global directory, not multi-replica.
 */
export function GET(): Response {
  const rooms = listRooms();
  const store = getRoomStoreMeta();
  return jsonOk({
    ok: true,
    count: rooms.length,
    rooms,
    store: {
      kind: store.kind,
      multiReplicaSafe: store.multiReplicaSafe,
      durableAcrossRestart: store.durableAcrossRestart,
      maxMessagesPerRoom: store.maxMessagesPerRoom,
      label: store.label,
      note: store.note,
    },
    note: 'Local ciphertext bags only. Empty when no messages landed on this process/file. Not multi-replica. Decrypt client-side.',
  });
}

export function POST(): Response {
  return jsonError(
    405,
    'method_not_allowed',
    'Use GET for room index. Create rooms by posting sealed messages to /api/v1/rooms/:id/messages.',
  );
}
