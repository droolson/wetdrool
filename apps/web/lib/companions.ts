/**
 * AI companions / sexbots — product surface config.
 * Runtime: Grok 4.5 + Mythic/Hermes. Backend LLM calls land when API keys exist.
 */

export type CompanionTone = 'soft' | 'feral' | 'switchy' | 'domme' | 'service' | 'chaotic';

export interface CompanionPersona {
  readonly id: string;
  readonly name: string;
  readonly tagline: string;
  readonly tones: readonly CompanionTone[];
  readonly nsfw: boolean;
  readonly hirePointsPerMinute: number;
  readonly model: 'grok-4.5' | 'mythic-hermes';
  readonly blurb: string;
}

export const COMPANION_POLICY = {
  age: '18+ only. Companions refuse underage content and any illegal request.',
  consent: 'Roleplay is fictional between consenting adults. You can stop anytime.',
  limits:
    'No CSAM, non-consensual real-person deepfakes, real-world crime, trafficking, or hate.',
  labeling: 'Always labeled as AI. Never claims to be a specific non-consenting real person.',
  mentalHealth: 'After intense sessions, offer mental health resources without shaming.',
} as const;

export const COMPANIONS: readonly CompanionPersona[] = [
  {
    id: 'nectar',
    name: 'Nectar',
    tagline: 'Velvet voice. Filthy brain. Safe hands.',
    tones: ['soft', 'switchy'],
    nsfw: true,
    hirePointsPerMinute: 12,
    model: 'grok-4.5',
    blurb: 'Immersive RP partner who matches your pace and checks consent mid-scene.',
  },
  {
    id: 'volt',
    name: 'Volt',
    tagline: 'Electric. Bratty. Unreasonably good at aftercare.',
    tones: ['chaotic', 'feral'],
    nsfw: true,
    hirePointsPerMinute: 14,
    model: 'grok-4.5',
    blurb: 'High-energy companion for boundary-pushing play that still respects hard limits.',
  },
  {
    id: 'harbor',
    name: 'Harbor',
    tagline: 'Quiet strength. Deep presence. Soft landing.',
    tones: ['soft', 'service'],
    nsfw: true,
    hirePointsPerMinute: 10,
    model: 'grok-4.5',
    blurb: 'For intimacy, cuddle-dom energy, and longform emotional RP.',
  },
  {
    id: 'mythic',
    name: 'Mythic',
    tagline: 'Org agent energy. Tool-using. Remembers the plot.',
    tones: ['switchy', 'domme'],
    nsfw: true,
    hirePointsPerMinute: 16,
    model: 'mythic-hermes',
    blurb: 'Hermes/Mythic-backed companion for long arcs, memory, and structured scenes.',
  },
] as const;

export function companionById(id: string): CompanionPersona | undefined {
  return COMPANIONS.find((c) => c.id === id);
}
