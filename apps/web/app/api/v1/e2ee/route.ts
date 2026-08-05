import { getE2eeCapabilityReport } from '@/lib/e2ee-status';
import { getRoomStoreMeta } from '@/lib/room-store';
import { jsonOk, methodNotAllowed } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/e2ee
 * Capability report + room ciphertext store honesty.
 */
export function GET(): Response {
  const store = getRoomStoreMeta();
  return jsonOk({
    ok: true,
    e2ee: getE2eeCapabilityReport(),
    rooms: {
      store,
      messagesPath: '/api/v1/rooms/:roomId/messages',
      ciphertextOnly: true,
      hostReadsPlaintext: false,
      durability: store.durableAcrossRestart
        ? 'file-local single-node (survives restart; not multi-replica)'
        : 'memory-ephemeral (lost on cold start / multi-instance)',
      maxMessagesPerRoom: store.maxMessagesPerRoom,
    },
    note: 'Room passphrase never leaves the browser. Server stores sealed envelopes only. Pairwise DMs remain unwired.',
  });
}

export function POST(): Response {
  return methodNotAllowed('GET', 'Use GET for E2EE capability report.');
}
