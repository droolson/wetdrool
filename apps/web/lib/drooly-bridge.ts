/**
 * WetDrool ↔ DROOLY.AI integration boundary.
 *
 * Products stay separate origins and sessions. Integration means typed links,
 * shared safety rails language, and optional inference endpoint config — never
 * shared wallet cookies or adult-feed bleed into drooly.ai.
 */

export const DROOLY_AI_ORIGIN = 'https://drooly.ai';
export const DROOLY_AI_CHAT_PATH = '/chat';
export const WETDROOL_ORIGIN = 'https://wetdrool.com';

export type AiSurfaceId = 'wetdrool-dock' | 'wetdrool-companion' | 'drooly-ai-chat';

export interface AiIntegrationLink {
  readonly id: AiSurfaceId;
  readonly label: string;
  readonly href: string;
  readonly sameProduct: boolean;
  readonly adultContext: boolean;
  readonly detail: string;
}

export interface AiIntegrationReport {
  readonly surfaces: readonly AiIntegrationLink[];
  readonly privateByDefault: true;
  readonly crossOriginSessionSharing: false;
  readonly notes: readonly string[];
}

export function getAiIntegrationReport(): AiIntegrationReport {
  return {
    privateByDefault: true,
    crossOriginSessionSharing: false,
    surfaces: [
      {
        id: 'wetdrool-dock',
        label: 'Drool (in-app)',
        href: '#drool-ai',
        sameProduct: true,
        adultContext: true,
        detail:
          'WetDrool dock: NSFW-aware system prompt when the user opted into 18+ mode; stays on-device until a server route is wired.',
      },
      {
        id: 'wetdrool-companion',
        label: 'Companions',
        href: '/companions',
        sameProduct: true,
        adultContext: true,
        detail: 'Companion RP surfaces inherit the same hard limits (CSAM, non-consent, real-world crime).',
      },
      {
        id: 'drooly-ai-chat',
        label: 'DROOLY.AI',
        href: `${DROOLY_AI_ORIGIN}${DROOLY_AI_CHAT_PATH}`,
        sameProduct: false,
        adultContext: false,
        detail:
          'Sibling intelligence product. Separate origin, branding, and session. Open in a new context — do not pass WetDrool NSFW state or private vault material.',
      },
    ],
    notes: [
      'Never forward encrypted message plaintext or age/consent records to DROOLY.AI.',
      'Never treat DROOLY.AI holder gates ($DROOLY) as WetDrool age proof or login.',
      'Inference URLs for WetDrool use WETDROOL_AI_INFERENCE_URL / WETDROOL_GROK_*; Drooly production uses its own Vercel secrets.',
    ],
  };
}
