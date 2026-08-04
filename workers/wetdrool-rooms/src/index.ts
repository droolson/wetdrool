/**
 * Ciphertext-only room relay on Cloudflare Workers + optional KV.
 * Does not decrypt. Mirrors Vercel /api/v1/rooms schema for edge multi-region.
 */

export interface Env {
  readonly ROOMS?: KVNamespace;
  readonly MAX_MESSAGES?: string;
}

interface SealedEnvelope {
  readonly protocol: string;
  readonly roomId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly contentType: string;
  readonly ivBase64: string;
  readonly ciphertextBase64: string;
  readonly compression: string;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...CORS,
    },
  });
}

function normalizeRoomId(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(t)) return null;
  return t;
}

async function readRoom(env: Env, roomId: string): Promise<SealedEnvelope[]> {
  if (!env.ROOMS) return [];
  const raw = await env.ROOMS.get(`room:${roomId}`, 'json');
  return Array.isArray(raw) ? (raw as SealedEnvelope[]) : [];
}

async function writeRoom(env: Env, roomId: string, messages: SealedEnvelope[]): Promise<void> {
  if (!env.ROOMS) throw new Error('KV not bound');
  const max = Number(env.MAX_MESSAGES ?? 200);
  await env.ROOMS.put(`room:${roomId}`, JSON.stringify(messages.slice(-max)));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);
    if (url.pathname === '/healthz') {
      return json({ ok: true, service: 'wetdrool-rooms', kv: Boolean(env.ROOMS) });
    }

    const match = url.pathname.match(/^\/v1\/rooms\/([^/]+)\/messages\/?$/);
    if (!match) {
      return json({ ok: false, error: { code: 'not_found', message: 'Use /v1/rooms/:id/messages' } }, 404);
    }

    const roomId = normalizeRoomId(decodeURIComponent(match[1]!));
    if (!roomId) {
      return json({ ok: false, error: { code: 'invalid_room', message: 'Invalid room id' } }, 400);
    }

    if (!env.ROOMS) {
      return json(
        {
          ok: false,
          error: {
            code: 'kv_unbound',
            message: 'Bind ROOMS KV namespace. Until then use Vercel /api/v1/rooms on wetdrool.com.',
          },
        },
        503,
      );
    }

    if (request.method === 'GET') {
      const messages = await readRoom(env, roomId);
      return json({
        ok: true,
        roomId,
        count: messages.length,
        messages,
        note: 'Ciphertext only. Decrypt with client passphrase + middle-out-lite.',
      });
    }

    if (request.method === 'POST') {
      let body: SealedEnvelope;
      try {
        body = (await request.json()) as SealedEnvelope;
      } catch {
        return json({ ok: false, error: { code: 'invalid_json', message: 'JSON required' } }, 400);
      }
      if (
        body.protocol !== 'wetdrool.e2ee.middle-out.v1' ||
        body.roomId !== roomId ||
        body.compression !== 'middle-out-lite-v1' ||
        typeof body.ciphertextBase64 !== 'string' ||
        typeof body.ivBase64 !== 'string'
      ) {
        return json({ ok: false, error: { code: 'invalid_envelope', message: 'Bad envelope' } }, 400);
      }
      if (body.ciphertextBase64.length > 2_000_000) {
        return json({ ok: false, error: { code: 'too_large', message: 'Envelope too large' } }, 413);
      }
      const prev = await readRoom(env, roomId);
      const next = [
        ...prev,
        {
          protocol: body.protocol,
          roomId,
          messageId: body.messageId || crypto.randomUUID(),
          createdAt: body.createdAt || new Date().toISOString(),
          contentType: String(body.contentType || 'application/octet-stream').slice(0, 128),
          ivBase64: body.ivBase64,
          ciphertextBase64: body.ciphertextBase64,
          compression: 'middle-out-lite-v1' as const,
        },
      ];
      await writeRoom(env, roomId, next);
      return json({ ok: true, messageId: next[next.length - 1]!.messageId }, 201);
    }

    return json({ ok: false, error: { code: 'method', message: 'GET or POST' } }, 405);
  },
};
