import { getE2eeCapabilityReport } from '@/lib/e2ee-status';
import { getRoomStoreMeta } from '@/lib/room-store';
import { jsonError, jsonOk } from '@/lib/product-api';

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
    },
    note: 'Passphrase never leaves the browser for room content. Server stores sealed envelopes only.',
  });
}

export function POST(): Response {
  return jsonError(405, 'method_not_allowed', 'Use GET for E2EE capability report.');
}
