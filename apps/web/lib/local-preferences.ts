export const DEVICE_PREFERENCES_STORAGE_KEY = 'wokesocial:device-preferences:v1';
export const DEVICE_PREFERENCES_VERSION = 1 as const;

export type LocalSafetyMode = 'hide-from-feeds' | 'mute-live-signals';

export interface LocalSafetyEntry {
  identifier: string;
  mode: LocalSafetyMode;
}

export interface DevicePreferences {
  hiddenIdentifiers: LocalSafetyEntry[];
  privacy: {
    disableReadReceipts: boolean;
    hidePresence: boolean;
    limitDiscovery: boolean;
  };
  safety: {
    blurSensitiveMedia: boolean;
    collapseUnknownReplies: boolean;
    reduceLiveMotion: boolean;
  };
  version: typeof DEVICE_PREFERENCES_VERSION;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

const MAX_LOCAL_ENTRIES = 250;
const MAX_IDENTIFIER_LENGTH = 180;
const MODES: readonly LocalSafetyMode[] = ['hide-from-feeds', 'mute-live-signals'];

export function createDefaultDevicePreferences(): DevicePreferences {
  return {
    hiddenIdentifiers: [],
    privacy: {
      disableReadReceipts: true,
      hidePresence: true,
      limitDiscovery: true,
    },
    safety: {
      blurSensitiveMedia: true,
      collapseUnknownReplies: true,
      reduceLiveMotion: false,
    },
    version: DEVICE_PREFERENCES_VERSION,
  };
}

export function parseDevicePreferences(serialized: string): DevicePreferences | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (
      !isRecord(value) ||
      value.version !== DEVICE_PREFERENCES_VERSION ||
      !isPrivacyPreferences(value.privacy) ||
      !isSafetyPreferences(value.safety) ||
      !Array.isArray(value.hiddenIdentifiers) ||
      value.hiddenIdentifiers.length > MAX_LOCAL_ENTRIES
    ) {
      return null;
    }

    const hiddenIdentifiers: LocalSafetyEntry[] = [];
    for (const item of value.hiddenIdentifiers) {
      if (!isRecord(item) || !isMode(item.mode)) {
        return null;
      }
      const identifier = normalizeLocalIdentifier(item.identifier);
      if (!identifier) {
        return null;
      }
      if (
        !hiddenIdentifiers.some(
          (existing) => existing.identifier === identifier && existing.mode === item.mode,
        )
      ) {
        hiddenIdentifiers.push({ identifier, mode: item.mode });
      }
    }

    return {
      hiddenIdentifiers,
      privacy: {
        disableReadReceipts: value.privacy.disableReadReceipts,
        hidePresence: value.privacy.hidePresence,
        limitDiscovery: value.privacy.limitDiscovery,
      },
      safety: {
        blurSensitiveMedia: value.safety.blurSensitiveMedia,
        collapseUnknownReplies: value.safety.collapseUnknownReplies,
        reduceLiveMotion: value.safety.reduceLiveMotion,
      },
      version: DEVICE_PREFERENCES_VERSION,
    };
  } catch {
    return null;
  }
}

export function loadDevicePreferences(storage: PreferenceStorage): DevicePreferences {
  try {
    const stored = storage.getItem(DEVICE_PREFERENCES_STORAGE_KEY);
    return stored === null
      ? createDefaultDevicePreferences()
      : (parseDevicePreferences(stored) ?? createDefaultDevicePreferences());
  } catch {
    return createDefaultDevicePreferences();
  }
}

export function saveDevicePreferences(
  storage: PreferenceStorage,
  preferences: DevicePreferences,
): boolean {
  try {
    storage.setItem(DEVICE_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function clearDevicePreferences(storage: PreferenceStorage): boolean {
  try {
    storage.removeItem(DEVICE_PREFERENCES_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function normalizeLocalIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value
    .trim()
    .split('')
    .filter((character) => !isAsciiControl(character))
    .join('')
    .replace(/[\u202A-\u202E\u2066-\u2069]/gu, '');
  if (
    normalized.length < 3 ||
    normalized.length > MAX_IDENTIFIER_LENGTH ||
    /\s/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function isAsciiControl(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
}

export function addLocalSafetyEntry(
  preferences: DevicePreferences,
  entry: LocalSafetyEntry,
): DevicePreferences | null {
  const identifier = normalizeLocalIdentifier(entry.identifier);
  if (!identifier || !isMode(entry.mode)) {
    return null;
  }
  if (
    preferences.hiddenIdentifiers.some(
      (existing) => existing.identifier === identifier && existing.mode === entry.mode,
    )
  ) {
    return preferences;
  }
  if (preferences.hiddenIdentifiers.length >= MAX_LOCAL_ENTRIES) {
    return null;
  }
  return {
    ...preferences,
    hiddenIdentifiers: [...preferences.hiddenIdentifiers, { identifier, mode: entry.mode }],
  };
}

export function removeLocalSafetyEntry(
  preferences: DevicePreferences,
  entry: LocalSafetyEntry,
): DevicePreferences {
  return {
    ...preferences,
    hiddenIdentifiers: preferences.hiddenIdentifiers.filter(
      (existing) => existing.identifier !== entry.identifier || existing.mode !== entry.mode,
    ),
  };
}

export function shouldHideIdentity(preferences: DevicePreferences, identityId: string): boolean {
  return preferences.hiddenIdentifiers.some(
    (entry) => entry.mode === 'hide-from-feeds' && entry.identifier === identityId,
  );
}

function isMode(value: unknown): value is LocalSafetyMode {
  return typeof value === 'string' && MODES.includes(value as LocalSafetyMode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPrivacyPreferences(value: unknown): value is DevicePreferences['privacy'] {
  return (
    isRecord(value) &&
    typeof value.disableReadReceipts === 'boolean' &&
    typeof value.hidePresence === 'boolean' &&
    typeof value.limitDiscovery === 'boolean'
  );
}

function isSafetyPreferences(value: unknown): value is DevicePreferences['safety'] {
  return (
    isRecord(value) &&
    typeof value.blurSensitiveMedia === 'boolean' &&
    typeof value.collapseUnknownReplies === 'boolean' &&
    typeof value.reduceLiveMotion === 'boolean'
  );
}
