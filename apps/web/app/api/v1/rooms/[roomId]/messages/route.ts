import {
  appendMessage,
  getRoomStoreMeta,
  isValidMessageId,
  listMessages,
  normalizeRoomId,
} from '@/lib/room-store';
import type { SealedEnvelope } from '@/lib/e2ee-seal';
import { SEAL_PROTOCOL } from '@/lib/e2ee-seal';
import { jsonError, jsonOk, parseLimit } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  const { roomId: raw } = await context.params;
  const roomId = normalizeRoomId(raw);
  if (!roomId) return jsonError(400, 'invalid_room', 'Invalid room id.');

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 50, 100);
  const afterRaw = url.searchParams.get('after')?.trim() ?? '';
  const after = afterRaw && isValidMessageId(afterRaw) ? afterRaw : undefined;

  const page = listMessages(roomId, { limit, ...(after !== undefined ? { after } : {}) });
  const store = getRoomStoreMeta();

  return jsonOk({
    ok: true,
    roomId,
    count: page.messages.length,
    total: page.total,
    limit,
    hasMore: page.hasMore,
    messages: page.messages,
    store,
    note: 'Ciphertext only. Decrypt client-side with room passphrase + middle-out-lite.',
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  const { roomId: raw } = await context.params;
  const roomId = normalizeRoomId(raw);
  if (!roomId) return jsonError(400, 'invalid_room', 'Invalid room id.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'invalid_json', 'JSON body required.');
  }

  const env = body as Partial<SealedEnvelope>;
  if (
    env.protocol !== SEAL_PROTOCOL ||
    env.roomId !== roomId ||
    typeof env.messageId !== 'string' ||
    !isValidMessageId(env.messageId) ||
    typeof env.ciphertextBase64 !== 'string' ||
    typeof env.ivBase64 !== 'string' ||
    typeof env.contentType !== 'string' ||
    env.compression !== 'middle-out-lite-v1'
  ) {
    return jsonError(
      400,
      'invalid_envelope',
      'Envelope failed validation (ciphertext-only schema, messageId 8–128).',
    );
  }

  // ~4MB media → base64 envelope budget
  if (env.ciphertextBase64.length > 6_000_000) {
    return jsonError(413, 'too_large', 'Envelope exceeds size budget (~4MB media).');
  }

  if (typeof env.ivBase64 === 'string' && env.ivBase64.length > 64) {
    return jsonError(400, 'invalid_iv', 'IV too large.');
  }

  const fromRaw = typeof env.from === 'string' ? env.from.trim().slice(0, 32) : '';
  const from =
    fromRaw.length > 0 ? fromRaw.replace(/[\u0000-\u001f\u007f]/g, '') || undefined : undefined;

  const sealed: SealedEnvelope = {
    protocol: SEAL_PROTOCOL,
    roomId,
    messageId: env.messageId,
    createdAt: typeof env.createdAt === 'string' ? env.createdAt : new Date().toISOString(),
    contentType: env.contentType.slice(0, 128),
    ivBase64: env.ivBase64,
    ciphertextBase64: env.ciphertextBase64,
    compression: 'middle-out-lite-v1',
    ...(from !== undefined && from.length > 0 ? { from } : {}),
  };

  const result = appendMessage(sealed);
  const store = getRoomStoreMeta();
  return jsonOk(
    {
      ok: true,
      messageId: sealed.messageId,
      duplicate: result === 'duplicate',
      store: {
        kind: store.kind,
        durableAcrossRestart: store.durableAcrossRestart,
        multiReplicaSafe: store.multiReplicaSafe,
      },
    },
    { status: result === 'duplicate' ? 200 : 201 },
  );
}
