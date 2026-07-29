import { describe, expect, it } from 'vitest';

import {
  COMPOSER_DRAFT_STORAGE_KEY,
  REPLY_PERMISSION_LABELS,
  createEmptyComposerDraft,
  discardComposerDraft,
  discardExactComposerDraft,
  loadComposerDraft,
  normalizePreviewText,
  parseComposerDraft,
  saveComposerDraft,
  serializeComposerDraft,
  unicodeCharacterCount,
  utf8ByteLength,
  validateComposerDraft,
  type DraftStorage,
} from '../lib/composer-draft';

class MemoryStorage implements DraftStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

describe('composer draft validation', () => {
  it('labels the legacy following token as the author’s followers', () => {
    expect(REPLY_PERMISSION_LABELS).toEqual({
      everyone: 'Everyone',
      following: 'Followers',
      mentioned: 'Mentioned people',
      nobody: 'No replies',
    });
  });

  it('requires meaningful text', () => {
    const result = validateComposerDraft(createEmptyComposerDraft());

    expect(result.valid).toBe(false);
    expect(result.errors.text).toMatch(/Write something/u);
  });

  it('requires a valid, described media reference', () => {
    const draft = createEmptyComposerDraft();
    draft.text = 'A post with an image.';
    draft.media.sourceUrl = 'javascript:alert(1)';
    draft.media.mediaType = 'not a media type';

    const result = validateComposerDraft(draft);

    expect(result.valid).toBe(false);
    expect(result.errors.sourceUrl).toMatch(/https/u);
    expect(result.errors.mediaType).toMatch(/valid media type/u);
    expect(result.errors.altText).toMatch(/Describe/u);
  });

  it('accepts a complete plain-text draft', () => {
    const draft = createEmptyComposerDraft();
    draft.text = 'A thoughtful update.';
    draft.contentWarning = 'Discussion of grief';
    draft.media = {
      altText: 'A lavender sky above a quiet city street.',
      mediaType: 'image/jpeg',
      sourceUrl: 'ipfs://bafy-example',
    };

    expect(validateComposerDraft(draft)).toEqual({ errors: {}, valid: true });
  });

  it('enforces the protocol UTF-8 byte limit independently of character count', () => {
    const validDraft = createEmptyComposerDraft();
    validDraft.text = '💜'.repeat(2_500);

    expect(unicodeCharacterCount(validDraft.text)).toBe(2_500);
    expect(utf8ByteLength(validDraft.text)).toBe(10_000);
    expect(validateComposerDraft(validDraft)).toEqual({ errors: {}, valid: true });

    const oversizedDraft = createEmptyComposerDraft();
    oversizedDraft.text = `${validDraft.text}💜`;

    expect(validateComposerDraft(oversizedDraft).errors.text).toMatch(/UTF-8 bytes/u);
  });

  it('rejects media references with credentials or tracking components', () => {
    for (const sourceUrl of [
      'https://alice:secret@media.example/image.jpg',
      'https://media.example/image.jpg?viewer=alice',
      'https://media.example/image.jpg#viewer',
      'ipfs://bafy-example/image.jpg?viewer=alice',
      'ipfs:bafy-example',
    ]) {
      const draft = createEmptyComposerDraft();
      draft.text = 'A post with externally referenced media.';
      draft.media = {
        altText: 'A violet square.',
        mediaType: 'image/jpeg',
        sourceUrl,
      };

      expect(validateComposerDraft(draft).errors.sourceUrl, sourceUrl).toMatch(/credential-free/u);
    }

    const safeDraft = createEmptyComposerDraft();
    safeDraft.text = 'A safe external reference.';
    safeDraft.media = {
      altText: 'A violet square.',
      mediaType: 'image/jpeg',
      sourceUrl: 'https://media.example/image.jpg',
    };
    expect(validateComposerDraft(safeDraft)).toEqual({ errors: {}, valid: true });
  });

  it('requires a community identifier for a community audience', () => {
    const draft = createEmptyComposerDraft();
    draft.text = 'For my neighbors.';
    draft.audience = 'community';

    expect(validateComposerDraft(draft).errors.communityId).toMatch(/Choose a community/u);
  });
});

describe('composer draft storage', () => {
  it('round trips a versioned draft', () => {
    const storage = new MemoryStorage();
    const draft = createEmptyComposerDraft();
    draft.text = 'Saved on this device.';

    expect(saveComposerDraft(storage, draft)).toBe(true);
    expect(loadComposerDraft(storage)).toEqual(draft);
    expect(storage.values.has(COMPOSER_DRAFT_STORAGE_KEY)).toBe(true);
  });

  it('rejects corrupt, unknown-version, and oversized data', () => {
    expect(parseComposerDraft('{not json')).toBeNull();
    expect(parseComposerDraft(JSON.stringify({ version: 99 }))).toBeNull();

    const draft = createEmptyComposerDraft();
    const raw = JSON.parse(serializeComposerDraft(draft)) as Record<string, unknown>;
    raw.text = 'x'.repeat(5_001);
    expect(parseComposerDraft(JSON.stringify(raw))).toBeNull();

    raw.text = '💜'.repeat(2_501);
    expect(parseComposerDraft(JSON.stringify(raw))).toBeNull();
  });

  it('discards only the namespaced draft', () => {
    const storage = new MemoryStorage();
    storage.values.set(
      COMPOSER_DRAFT_STORAGE_KEY,
      serializeComposerDraft(createEmptyComposerDraft()),
    );
    storage.values.set('another-app', 'keep me');

    expect(discardComposerDraft(storage)).toBe(true);
    expect(storage.values.get(COMPOSER_DRAFT_STORAGE_KEY)).toBeUndefined();
    expect(storage.values.get('another-app')).toBe('keep me');
  });

  it('refuses to discard a draft that changed after selection', () => {
    const storage = new MemoryStorage();
    storage.values.set(COMPOSER_DRAFT_STORAGE_KEY, '{"version":1,"text":"new"}');

    expect(discardExactComposerDraft(storage, '{"version":1,"text":"previous"}')).toBe(false);
    expect(storage.getItem(COMPOSER_DRAFT_STORAGE_KEY)).toBe('{"version":1,"text":"new"}');
    expect(discardExactComposerDraft(storage, '{"version":1,"text":"new"}')).toBe(true);
  });

  it('rejects silent draft writes and removals', () => {
    const draft = createEmptyComposerDraft();
    draft.text = 'Must be read back exactly.';
    const silentWrite: DraftStorage = {
      getItem() {
        return null;
      },
      removeItem() {
        // Intentionally ignore the requested removal.
      },
      setItem() {
        // Intentionally ignore the requested write.
      },
    };
    expect(saveComposerDraft(silentWrite, draft)).toBe(false);

    const serialized = serializeComposerDraft(draft);
    const silentRemove: DraftStorage = {
      getItem() {
        return serialized;
      },
      removeItem() {
        // Intentionally ignore the requested removal.
      },
      setItem() {
        // Intentionally ignore the requested write.
      },
    };
    expect(discardComposerDraft(silentRemove)).toBe(false);
    expect(discardExactComposerDraft(silentRemove, serialized)).toBe(false);
  });

  it('fails closed when browser storage is unavailable', () => {
    const unavailable: DraftStorage = {
      getItem() {
        throw new Error('blocked');
      },
      removeItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    };

    expect(loadComposerDraft(unavailable)).toBeNull();
    expect(saveComposerDraft(unavailable, createEmptyComposerDraft())).toBe(false);
    expect(discardComposerDraft(unavailable)).toBe(false);
  });
});

describe('plain-text preview normalization', () => {
  it('removes invisible controls while preserving markup as text', () => {
    expect(normalizePreviewText('<img src=x onerror=alert(1)>\u202E\u0000')).toBe(
      '<img src=x onerror=alert(1)>',
    );
  });
});
