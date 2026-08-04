/**
 * Drool AI runtime boundary for the web app.
 *
 * Nothing here performs inference. This module prepares the exact typed
 * contract the self-hosted Drool AI runtime will serve, and it fails closed:
 * when no runtime endpoint is configured, every surface must render an honest
 * unavailable state instead of fabricated model output.
 */

type Environment = Readonly<Record<string, string | undefined>>;

export const DROOL_AI_MODELS = [
  {
    id: 'grok-4.5',
    label: 'Grok 4.5',
    role: 'Primary platform + companions',
    detail: 'Default WetDrool chat and immersive companion RP via xAI.',
    status: 'frontend-ready',
  },
  {
    id: 'drool-kairos',
    label: 'Drool Kairos',
    role: 'Balanced default assistant',
    detail: 'Everyday chat, drafting, editing, and analysis at medium cost.',
    status: 'planned',
  },
  {
    id: 'drool-athena',
    label: 'Drool Athena',
    role: 'Highest reasoning',
    detail: 'Difficult research, planning, and multi-source analysis.',
    status: 'planned',
  },
  {
    id: 'drool-hermes',
    label: 'Drool Hermes',
    role: 'Fast agent work',
    detail: 'Routing, extraction, and bounded background agents.',
    status: 'planned',
  },
  {
    id: 'qwen3-coder-next',
    label: 'Qwen3 Coder Next',
    role: 'Site-builder code generation',
    detail:
      'Self-hosted open-model candidate that powers website generation. Subject to the AI-platform evaluation gates before any hosted claim.',
    status: 'planned',
  },
] as const;

export type DroolAiModelId = (typeof DROOL_AI_MODELS)[number]['id'];

export const DROOL_AI_CHAT_DEFAULT_MODEL: DroolAiModelId = 'grok-4.5';
export const DROOL_AI_SITE_BUILDER_MODEL: DroolAiModelId = 'qwen3-coder-next';

export type DroolAiRuntimeConfig =
  | { readonly detail: string; readonly kind: 'unavailable' }
  | {
      readonly defaultModel: DroolAiModelId;
      readonly endpoint: string;
      readonly kind: 'configured';
    };

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);

/**
 * Reads the self-hosted inference endpoint. Absent configuration is the
 * normal pre-release state and disables generation everywhere; a configured
 * endpoint must be credential-free and either loopback HTTP or HTTPS.
 */
export function getDroolAiRuntimeConfig(
  environment: Environment = process.env,
): DroolAiRuntimeConfig {
  const raw = environment.WETDROOL_AI_INFERENCE_URL?.trim() ||
    environment.WETDROOL_GROK_ENDPOINT?.trim() ||
    environment.WOKESOCIAL_AI_INFERENCE_URL?.trim();
  if (raw === undefined || raw === '') {
    return {
      detail:
        'No self-hosted Drool AI runtime is configured. Generation and chat stay disabled; nothing is sent to a third-party model provider.',
      kind: 'unavailable',
    };
  }
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    return { detail: 'The configured Drool AI endpoint is not a valid URL.', kind: 'unavailable' };
  }
  const loopback = LOOPBACK_HOSTS.has(endpoint.hostname.toLowerCase());
  if (
    (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && loopback)) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    return {
      detail:
        'The configured Drool AI endpoint must be credential-free and use loopback HTTP or HTTPS.',
      kind: 'unavailable',
    };
  }
  const model = environment.WETDROOL_AI_DEFAULT_MODEL?.trim();
  const defaultModel =
    model !== undefined && DROOL_AI_MODELS.some((candidate) => candidate.id === model)
      ? (model as DroolAiModelId)
      : DROOL_AI_CHAT_DEFAULT_MODEL;
  return { defaultModel, endpoint: endpoint.toString(), kind: 'configured' };
}

/**
 * The exact chat request the runtime will accept. Prepared and displayed
 * today; transmitted only once a configured runtime exists.
 */
export interface DroolAiChatRequest {
  readonly kind: 'chat';
  readonly model: DroolAiModelId;
  readonly messages: readonly { readonly role: 'user' | 'assistant'; readonly text: string }[];
  readonly safety: {
    readonly platformPolicy: 'wetdrool-community-rules';
    readonly refuseFinancialAdvice: true;
  };
}

export interface DroolAiSiteGenerationRequest {
  readonly kind: 'site-generation';
  readonly model: DroolAiModelId;
  readonly preset: string;
  readonly subdomain: string;
  readonly brief: {
    readonly title: string;
    readonly tagline: string;
    readonly prompt: string;
    readonly sections: readonly string[];
  };
  readonly constraints: {
    readonly output: 'static-site-bundle';
    readonly noTrackers: true;
    readonly noExternalScripts: true;
    readonly truthfulClaimsOnly: true;
  };
}

export function prepareChatRequest(
  model: DroolAiModelId,
  messages: DroolAiChatRequest['messages'],
): DroolAiChatRequest {
  return Object.freeze({
    kind: 'chat',
    model,
    messages,
    safety: Object.freeze({
      platformPolicy: 'wetdrool-community-rules',
      refuseFinancialAdvice: true,
    }),
  });
}
