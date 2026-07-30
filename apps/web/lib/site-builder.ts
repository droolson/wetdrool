import { canonicalizeWokeName, WokeNameError } from '@wokesocial/protocol';

import { WOKE_AI_SITE_BUILDER_MODEL, type WokeAiSiteGenerationRequest } from './woke-ai';

export const SITE_BUILDER_DRAFT_STORAGE_KEY = 'wokesocial:site-builder-draft:v1';
export const SITE_BUILDER_DRAFT_VERSION = 1 as const;
export const SITE_SUFFIX = '.woke.social';

export class SiteSubdomainError extends Error {
  override readonly name = 'SiteSubdomainError';
}

export interface SiteSubdomain {
  readonly handle: string;
  readonly label: string;
  readonly host: string;
  readonly email: string;
}

/**
 * Maps a canonical `.woke` handle onto its reserved identity bundle: the
 * `*.woke.social` DNS label and the `handle@woke.social` mail address.
 * Handles use `[a-z0-9_]` and can never contain `-`, so replacing `_` with
 * `-` is injective for the DNS label: two different handles can never claim
 * one label. Handles never start or end with `_`, so the label is a valid
 * DNS label; the mail local part uses the handle verbatim because `_` is
 * legal there. These are reserved mappings, not live services: serving a
 * site or delivering mail requires the wildcard DNS, TLS, publishing, and
 * E2EE mail services that are not deployed yet.
 */
export function deriveSiteSubdomain(handleInput: string): SiteSubdomain {
  let handle: string;
  try {
    const canonical = canonicalizeWokeName(handleInput);
    handle = canonical.handle;
  } catch (error) {
    if (error instanceof WokeNameError) {
      throw new SiteSubdomainError(error.message);
    }
    throw new SiteSubdomainError('The handle is not a canonical WokeNet handle.');
  }
  const label = handle.replaceAll('_', '-');
  return Object.freeze({
    handle,
    label,
    host: `${label}${SITE_SUFFIX}`,
    email: `${handle}@woke.social`,
  });
}

export const SITE_PRESETS = [
  {
    id: 'crypto-project',
    label: 'Crypto Project',
    featured: true,
    headline: 'A verifiable home for a Solana project.',
    description:
      'Token-aware landing page with a hero, live on-chain stats placeholders, roadmap, community proof, and documentation links. Every on-chain claim renders from verified data or shows an honest unavailable state — the builder never fabricates supply, holders, or price.',
    sections: [
      'hero',
      'token-stats',
      'roadmap',
      'community-proof',
      'docs-links',
      'disclosure-footer',
    ],
  },
  {
    id: 'personal-blog',
    label: 'Personal Blog',
    featured: false,
    headline: 'Your posts, portable and permanent.',
    description:
      'A clean reading surface that can syndicate your verified WokeSocial posts with an about section and links.',
    sections: ['hero', 'recent-posts', 'about', 'links'],
  },
  {
    id: 'work-portfolio',
    label: 'Work Portfolio',
    featured: false,
    headline: 'Show the work, keep the receipts.',
    description: 'Projects, experience, and contact routes with your `.woke` identity up front.',
    sections: ['hero', 'projects', 'experience', 'contact'],
  },
] as const;

export type SitePresetId = (typeof SITE_PRESETS)[number]['id'];

export const SITE_ACCENTS = ['plum', 'coral', 'citron', 'sky'] as const;
export type SiteAccent = (typeof SITE_ACCENTS)[number];

export interface SiteBuilderDraft {
  version: typeof SITE_BUILDER_DRAFT_VERSION;
  handle: string;
  preset: SitePresetId;
  title: string;
  tagline: string;
  prompt: string;
  accent: SiteAccent;
}

export function createEmptySiteBuilderDraft(): SiteBuilderDraft {
  return {
    version: SITE_BUILDER_DRAFT_VERSION,
    handle: '',
    preset: 'crypto-project',
    title: '',
    tagline: '',
    prompt: '',
    accent: 'plum',
  };
}

export interface SiteBuilderValidation {
  readonly valid: boolean;
  readonly errors: Partial<Record<'handle' | 'prompt' | 'tagline' | 'title', string>>;
}

export function validateSiteBuilderDraft(draft: SiteBuilderDraft): SiteBuilderValidation {
  const errors: Partial<Record<'handle' | 'prompt' | 'tagline' | 'title', string>> = {};
  if (draft.handle.trim() === '') {
    errors.handle = 'Enter the .woke handle this site belongs to.';
  } else {
    try {
      deriveSiteSubdomain(draft.handle);
    } catch (error) {
      errors.handle =
        error instanceof SiteSubdomainError
          ? error.message
          : 'The handle is not a canonical WokeNet handle.';
    }
  }
  if (draft.title.trim() === '') errors.title = 'Give the site a title.';
  if ([...draft.title].length > 80) errors.title = 'Keep the title within 80 characters.';
  if ([...draft.tagline].length > 160) errors.tagline = 'Keep the tagline within 160 characters.';
  if ([...draft.prompt].length > 2_000) {
    errors.prompt = 'Keep the builder brief within 2,000 characters.';
  }
  return { valid: Object.keys(errors).length === 0, errors };
}

interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadSiteBuilderDraft(storage: DraftStorage): SiteBuilderDraft | null {
  const raw = storage.getItem(SITE_BUILDER_DRAFT_STORAGE_KEY);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const draft = parsed as Record<string, unknown>;
    if (
      draft.version !== SITE_BUILDER_DRAFT_VERSION ||
      typeof draft.handle !== 'string' ||
      typeof draft.title !== 'string' ||
      typeof draft.tagline !== 'string' ||
      typeof draft.prompt !== 'string' ||
      !SITE_PRESETS.some((preset) => preset.id === draft.preset) ||
      !SITE_ACCENTS.includes(draft.accent as SiteAccent)
    ) {
      return null;
    }
    return {
      version: SITE_BUILDER_DRAFT_VERSION,
      handle: draft.handle,
      preset: draft.preset as SitePresetId,
      title: draft.title,
      tagline: draft.tagline,
      prompt: draft.prompt,
      accent: draft.accent as SiteAccent,
    };
  } catch {
    return null;
  }
}

export function saveSiteBuilderDraft(storage: DraftStorage, draft: SiteBuilderDraft): void {
  storage.setItem(SITE_BUILDER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function discardSiteBuilderDraft(storage: DraftStorage): void {
  storage.removeItem(SITE_BUILDER_DRAFT_STORAGE_KEY);
}

/**
 * Builds the exact generation request the Woke AI runtime will receive for
 * this draft. Deterministic and pure: the same draft always prepares the same
 * request, so a retry can never silently change what was approved.
 */
export function prepareSiteGenerationRequest(draft: SiteBuilderDraft): WokeAiSiteGenerationRequest {
  const preset = SITE_PRESETS.find((candidate) => candidate.id === draft.preset);
  if (preset === undefined) {
    throw new SiteSubdomainError('The selected preset is unknown.');
  }
  const subdomain = deriveSiteSubdomain(draft.handle);
  return Object.freeze({
    kind: 'site-generation',
    model: WOKE_AI_SITE_BUILDER_MODEL,
    preset: preset.id,
    subdomain: subdomain.host,
    brief: Object.freeze({
      title: draft.title.trim(),
      tagline: draft.tagline.trim(),
      prompt: draft.prompt.trim(),
      sections: preset.sections,
    }),
    constraints: Object.freeze({
      output: 'static-site-bundle',
      noTrackers: true,
      noExternalScripts: true,
      truthfulClaimsOnly: true,
    }),
  } as const);
}
