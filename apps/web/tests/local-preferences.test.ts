import { describe, expect, it } from 'vitest';

import { createEmptyComposerDraft } from '../lib/composer-draft';
import {
  LOCAL_EXPORT_FORMAT,
  createLocalDeviceExport,
  serializeLocalDeviceExport,
} from '../lib/local-export';
import {
  DEVICE_PREFERENCES_STORAGE_KEY,
  addLocalSafetyEntry,
  clearDevicePreferences,
  createDefaultDevicePreferences,
  loadDevicePreferences,
  normalizeLocalIdentifier,
  parseDevicePreferences,
  removeLocalSafetyEntry,
  saveDevicePreferences,
  shouldHideIdentity,
  type PreferenceStorage,
} from '../lib/local-preferences';

class MemoryStorage implements PreferenceStorage {
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

describe('device preferences', () => {
  it('round trips versioned preferences', () => {
    const storage = new MemoryStorage();
    const preferences = createDefaultDevicePreferences();
    preferences.privacy.hidePresence = false;

    expect(saveDevicePreferences(storage, preferences)).toBe(true);
    expect(loadDevicePreferences(storage)).toEqual(preferences);
    expect(storage.values.has(DEVICE_PREFERENCES_STORAGE_KEY)).toBe(true);
  });

  it('falls back safely for corrupt or unavailable storage', () => {
    expect(parseDevicePreferences('{broken')).toBeNull();
    expect(parseDevicePreferences(JSON.stringify({ version: 44 }))).toBeNull();

    const unavailable: PreferenceStorage = {
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
    expect(loadDevicePreferences(unavailable)).toEqual(createDefaultDevicePreferences());
    expect(saveDevicePreferences(unavailable, createDefaultDevicePreferences())).toBe(false);
    expect(clearDevicePreferences(unavailable)).toBe(false);
  });

  it('normalizes, deduplicates, applies, and removes local safety entries', () => {
    const initial = createDefaultDevicePreferences();
    const added = addLocalSafetyEntry(initial, {
      identifier: '  identity-123  ',
      mode: 'hide-from-feeds',
    });
    expect(added).not.toBeNull();
    if (added === null) {
      throw new Error('Expected a valid local safety entry.');
    }
    expect(added.hiddenIdentifiers).toEqual([
      { identifier: 'identity-123', mode: 'hide-from-feeds' },
    ]);
    expect(
      addLocalSafetyEntry(added, {
        identifier: 'identity-123',
        mode: 'hide-from-feeds',
      }),
    ).toBe(added);
    expect(shouldHideIdentity(added, 'identity-123')).toBe(true);
    expect(
      removeLocalSafetyEntry(added, {
        identifier: 'identity-123',
        mode: 'hide-from-feeds',
      }).hiddenIdentifiers,
    ).toEqual([]);
  });

  it('rejects identifiers with whitespace, controls, or unsafe length', () => {
    expect(normalizeLocalIdentifier('two words')).toBeNull();
    expect(normalizeLocalIdentifier('ab')).toBeNull();
    expect(normalizeLocalIdentifier(`identity\u0000-id`)).toBe('identity-id');
    expect(normalizeLocalIdentifier('x'.repeat(181))).toBeNull();
  });
});

describe('local export', () => {
  it('labels the exact local-only scope', () => {
    const draft = createEmptyComposerDraft();
    draft.text = 'A local draft';
    const exported = createLocalDeviceExport(
      createDefaultDevicePreferences(),
      draft,
      new Date('2026-07-28T12:00:00.000Z'),
    );

    expect(exported.format).toBe(LOCAL_EXPORT_FORMAT);
    expect(exported.exportedAt).toBe('2026-07-28T12:00:00.000Z');
    expect(exported.notice).toMatch(/not a protocol account export/u);
    expect(serializeLocalDeviceExport(exported)).toContain('"A local draft"');
  });
});
