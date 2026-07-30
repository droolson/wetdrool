import { describe, expect, it } from 'vitest';

import {
  createEmptySiteBuilderDraft,
  deriveSiteSubdomain,
  discardSiteBuilderDraft,
  loadSiteBuilderDraft,
  prepareSiteGenerationRequest,
  saveSiteBuilderDraft,
  SITE_BUILDER_DRAFT_STORAGE_KEY,
  SITE_PRESETS,
  SiteSubdomainError,
  validateSiteBuilderDraft,
} from '../lib/site-builder';

class MemoryStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

describe('deriveSiteSubdomain', () => {
  it('maps canonical handles onto an injective identity bundle', () => {
    expect(deriveSiteSubdomain('alexbtc420')).toEqual({
      handle: 'alexbtc420',
      label: 'alexbtc420',
      host: 'alexbtc420.woke.social',
      email: 'alexbtc420@woke.social',
    });
    expect(deriveSiteSubdomain('anon_7n044tsjxrfm5e23')).toEqual({
      handle: 'anon_7n044tsjxrfm5e23',
      label: 'anon-7n044tsjxrfm5e23',
      host: 'anon-7n044tsjxrfm5e23.woke.social',
      email: 'anon_7n044tsjxrfm5e23@woke.social',
    });
    // Handles never contain '-', so the underscore mapping cannot collide.
    expect(deriveSiteSubdomain('a_b').label).toBe('a-b');
    expect(deriveSiteSubdomain('river_chen.woke').handle).toBe('river_chen');
    // ASCII case folds to the canonical lowercase handle instead of failing.
    expect(deriveSiteSubdomain('River').label).toBe('river');
  });

  it('rejects invalid input instead of repairing it', () => {
    for (const input of ['', 'a', 'a__b', 'péter', 'has space', '-abc']) {
      expect(() => deriveSiteSubdomain(input)).toThrowError(SiteSubdomainError);
    }
  });
});

describe('site builder drafts', () => {
  it('validates handle, title, and bounded lengths', () => {
    const draft = createEmptySiteBuilderDraft();
    expect(validateSiteBuilderDraft(draft).valid).toBe(false);
    draft.handle = 'alexbtc420';
    draft.title = 'Woke Protocol';
    expect(validateSiteBuilderDraft(draft)).toEqual({ valid: true, errors: {} });
    draft.tagline = 'x'.repeat(161);
    expect(validateSiteBuilderDraft(draft).errors.tagline).toBeDefined();
  });

  it('round-trips through storage and rejects tampered payloads', () => {
    const storage = new MemoryStorage();
    const draft = createEmptySiteBuilderDraft();
    draft.handle = 'alexbtc420';
    draft.title = 'Woke Protocol';
    draft.preset = 'crypto-project';
    saveSiteBuilderDraft(storage, draft);
    expect(loadSiteBuilderDraft(storage)).toEqual(draft);

    storage.setItem(
      SITE_BUILDER_DRAFT_STORAGE_KEY,
      JSON.stringify({ ...draft, preset: 'not-a-preset' }),
    );
    expect(loadSiteBuilderDraft(storage)).toBeNull();
    storage.setItem(SITE_BUILDER_DRAFT_STORAGE_KEY, 'not json');
    expect(loadSiteBuilderDraft(storage)).toBeNull();

    discardSiteBuilderDraft(storage);
    expect(loadSiteBuilderDraft(storage)).toBeNull();
  });
});

describe('prepareSiteGenerationRequest', () => {
  it('prepares one deterministic request bound to the exact subdomain and preset', () => {
    const draft = createEmptySiteBuilderDraft();
    draft.handle = 'anon_7n044tsjxrfm5e23';
    draft.title = '  Woke Protocol  ';
    draft.tagline = 'Portable identity.';
    draft.prompt = 'Solana project with a Q4 roadmap.';
    const request = prepareSiteGenerationRequest(draft);
    expect(request).toEqual({
      kind: 'site-generation',
      model: 'qwen3-coder-next',
      preset: 'crypto-project',
      subdomain: 'anon-7n044tsjxrfm5e23.woke.social',
      brief: {
        title: 'Woke Protocol',
        tagline: 'Portable identity.',
        prompt: 'Solana project with a Q4 roadmap.',
        sections: SITE_PRESETS[0].sections,
      },
      constraints: {
        output: 'static-site-bundle',
        noTrackers: true,
        noExternalScripts: true,
        truthfulClaimsOnly: true,
      },
    });
    expect(prepareSiteGenerationRequest(draft)).toEqual(request);
    expect(Object.isFrozen(request)).toBe(true);
  });

  it('features the Crypto Project preset with the richest section set', () => {
    const crypto = SITE_PRESETS.find((preset) => preset.id === 'crypto-project');
    expect(crypto?.featured).toBe(true);
    for (const preset of SITE_PRESETS) {
      if (preset.id !== 'crypto-project') {
        expect(preset.featured).toBe(false);
        expect(preset.sections.length).toBeLessThan(crypto?.sections.length ?? 0);
      }
    }
  });
});
