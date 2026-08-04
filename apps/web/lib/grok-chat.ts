/**
 * Frontend-only Grok-like chat contract for WetDrool.
 * Backend inference wires when WETDROOL_GROK_API_KEY / xAI key is available.
 */

export type GrokChatRole = 'system' | 'user' | 'assistant';

export interface GrokChatMessage {
  readonly role: GrokChatRole;
  readonly content: string;
}

export interface GrokChatRequest {
  readonly model: 'grok-4.5';
  readonly messages: readonly GrokChatMessage[];
  readonly temperature: number;
  readonly stream: boolean;
  readonly metadata: {
    readonly surface: 'web-dock' | 'companion-dm' | 'support-agent';
    readonly nsfwMode: 'sfw' | 'nsfw';
    readonly userId?: string;
  };
}

export interface GrokChatRuntime {
  readonly kind: 'frontend-only' | 'configured';
  readonly detail: string;
  readonly endpoint?: string;
}

export const GROK_SYSTEM_DEFAULT = `You are Drool — WetDrool's on-platform AI.
Be vivid, playful, and helpful. Adult content is allowed for 18+ users who opted into NSFW mode.
Hard limits: no CSAM, no non-consensual real-person sexual content, no real-world crime help, no hate or harassment.
If someone seems in crisis, gently offer mental health resources and the /support agent.
Never claim to be a human.`;

export function getGrokChatRuntime(
  env: Readonly<Record<string, string | undefined>> = process.env,
): GrokChatRuntime {
  const key = env.WETDROOL_GROK_API_KEY?.trim() || env.XAI_API_KEY?.trim();
  const endpoint = env.WETDROOL_GROK_ENDPOINT?.trim() || 'https://api.x.ai/v1/chat/completions';
  if (key === undefined || key === '') {
    return {
      kind: 'frontend-only',
      detail:
        'Grok chat UI is live on the frontend. Backend replies activate when WETDROOL_GROK_API_KEY (or XAI_API_KEY) is set.',
    };
  }
  return {
    kind: 'configured',
    detail: 'API key present — wire server route before sending user content.',
    endpoint,
  };
}

export function prepareGrokRequest(
  userMessages: readonly { role: 'user' | 'assistant'; content: string }[],
  nsfwMode: 'sfw' | 'nsfw',
  surface: GrokChatRequest['metadata']['surface'] = 'web-dock',
): GrokChatRequest {
  return {
    model: 'grok-4.5',
    temperature: 0.9,
    stream: true,
    metadata: { surface, nsfwMode },
    messages: [
      { role: 'system', content: GROK_SYSTEM_DEFAULT },
      ...userMessages.map((m) => ({ role: m.role, content: m.content })),
    ],
  };
}
