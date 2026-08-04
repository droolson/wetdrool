import { appendMessage, listMessages, normalizeRoomId } from '@/lib/room-store';
import type { SealedEnvelope } from '@/lib/e2ee-seal';
import { SEAL_PROTOCOL } from '@/lib/e2ee-seal';
import { jsonError, jsonOk } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ roomId: string }> },
): Promise<Response> {
  const { roomId: raw } = await context.params;
  const roomId = normalizeRoomId(raw);
  if (!roomId) return jsonError(400, 'invalid_room', 'Invalid room id.');
  const messages = listMessages(roomId);
  return jsonOk({
    ok: true,
    roomId,
    count: messages.length,
    messages,
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
    typeof env.ciphertextBase64 !== 'string' ||
    typeof env.ivBase64 !== 'string' ||
    typeof env.contentType !== 'string' ||
    env.compression !== 'middle-out-lite-v1'
  ) {
    return jsonError(400, 'invalid_envelope', 'Envelope failed validation (ciphertext-only schema).');
  }

  if (env.ciphertextBase64.length > 2_000_000) {
    return jsonError(413, 'too_large', 'Envelope exceeds size budget.');
  }

  const sealed: SealedEnvelope = {
    protocol: SEAL_PROTOCOL,
    roomId,
    messageId: env.messageId,
    createdAt: typeof env.createdAt === 'string' ? env.createdAt : new Date().toISOString(),
    contentType: env.contentType.slice(0, 128),
    ivBase64: env.ivBase64,
    ciphertextBase64: env.ciphertextBase64,
    compression: 'middle-out-lite-v1',
  };

  appendMessage(sealed);
  return jsonOk({ ok: true, messageId: sealed.messageId }, { status: 201 });
}
