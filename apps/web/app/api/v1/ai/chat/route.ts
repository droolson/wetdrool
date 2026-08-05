import { prepareGrokRequest } from '@/lib/grok-chat';
import { jsonError, jsonOk, methodNotAllowed } from '@/lib/product-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ChatBody {
  readonly messages?: readonly { role?: string; content?: string }[];
  readonly nsfwMode?: string;
}

export async function POST(request: Request): Promise<Response> {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return jsonError(400, 'invalid_json', 'Body must be JSON.');
  }

  const nsfwMode = body.nsfwMode === 'nsfw' ? 'nsfw' : 'sfw';
  const messages = (body.messages ?? [])
    .filter(
      (m): m is { role: 'user' | 'assistant'; content: string } =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim() !== '' &&
        m.content.length <= 4000,
    )
    .slice(-20);

  if (messages.length === 0) {
    return jsonError(400, 'empty_messages', 'Provide at least one user/assistant message.');
  }

  const prepared = prepareGrokRequest(messages, nsfwMode, 'web-dock');
  const apiKey =
    process.env.WETDROOL_GROK_API_KEY?.trim() || process.env.XAI_API_KEY?.trim() || '';
  const endpoint =
    process.env.WETDROOL_GROK_ENDPOINT?.trim() || 'https://api.x.ai/v1/chat/completions';

  if (apiKey === '') {
    return jsonOk(
      {
        ok: false,
        kind: 'unavailable',
        detail:
          'No xAI key configured (WETDROOL_GROK_API_KEY or XAI_API_KEY). Message stayed on server without inference.',
        prepared: {
          model: prepared.model,
          messageCount: prepared.messages.length,
        },
      },
      { status: 503 },
    );
  }

  try {
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: prepared.model,
        messages: prepared.messages,
        temperature: prepared.temperature,
        stream: false,
        max_tokens: 800,
      }),
      signal: AbortSignal.timeout(45_000),
    });

    if (!upstream.ok) {
      return jsonError(
        502,
        'upstream_error',
        `xAI provider returned ${upstream.status}. No secret material is included.`,
      );
    }

    const payload = (await upstream.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = payload.choices?.[0]?.message?.content?.trim() ?? '';
    if (text === '') {
      return jsonError(502, 'empty_completion', 'Provider returned an empty completion.');
    }

    return jsonOk({
      ok: true,
      kind: 'assistant',
      text,
      model: prepared.model,
      provider: 'xai',
    });
  } catch {
    return jsonError(504, 'upstream_timeout', 'xAI request failed or timed out.');
  }
}

export function GET(): Response {
  return methodNotAllowed('POST', 'Use POST for AI chat completions.');
}
