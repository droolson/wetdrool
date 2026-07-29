export const COMPOSER_DRAFT_STORAGE_KEY = 'wokesocial:composer-draft:v1';
export const COMPOSER_DRAFT_VERSION = 1 as const;
export const MAX_POST_CHARACTERS = 5_000;
export const MAX_POST_UTF8_BYTES = 10_000;

export const AUDIENCES = ['public', 'followers', 'community'] as const;
export const REPLY_PERMISSIONS = ['everyone', 'following', 'mentioned', 'nobody'] as const;
export const REMIX_PERMISSIONS = ['allow-with-credit', 'ask-first', 'disabled'] as const;
export const STORAGE_POLICIES = ['provider-default', 'ipfs', 'arweave'] as const;

export type Audience = (typeof AUDIENCES)[number];
export type ReplyPermission = (typeof REPLY_PERMISSIONS)[number];
export type RemixPermission = (typeof REMIX_PERMISSIONS)[number];
export type StoragePolicy = (typeof STORAGE_POLICIES)[number];

/**
 * Human-readable reply audiences. The persisted `following` token is retained
 * for v1 draft compatibility; semantically it means followers of the author,
 * not accounts the author follows.
 */
export const REPLY_PERMISSION_LABELS = Object.freeze({
  everyone: 'Everyone',
  following: 'Followers',
  mentioned: 'Mentioned people',
  nobody: 'No replies',
} satisfies Readonly<Record<ReplyPermission, string>>);

export interface MediaDraft {
  altText: string;
  mediaType: string;
  sourceUrl: string;
}

export interface ComposerDraft {
  audience: Audience;
  communityId: string;
  contentWarning: string;
  media: MediaDraft;
  remixPermission: RemixPermission;
  replyPermission: ReplyPermission;
  storagePolicy: StoragePolicy;
  text: string;
  version: typeof COMPOSER_DRAFT_VERSION;
}

export interface DraftStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export interface DraftValidation {
  errors: Partial<
    Record<
      'altText' | 'communityId' | 'contentWarning' | 'mediaType' | 'sourceUrl' | 'text',
      string
    >
  >;
  valid: boolean;
}

const MAX_CONTENT_WARNING_CHARACTERS = 160;
const MAX_ALT_TEXT_CHARACTERS = 1_000;
const MAX_MEDIA_TYPE_CHARACTERS = 120;
const MAX_SOURCE_URL_CHARACTERS = 2_000;
const MAX_COMMUNITY_ID_CHARACTERS = 180;

export function createEmptyComposerDraft(): ComposerDraft {
  return {
    audience: 'public',
    communityId: '',
    contentWarning: '',
    media: {
      altText: '',
      mediaType: '',
      sourceUrl: '',
    },
    remixPermission: 'allow-with-credit',
    replyPermission: 'everyone',
    storagePolicy: 'provider-default',
    text: '',
    version: COMPOSER_DRAFT_VERSION,
  };
}

/**
 * Keeps preview content in the plain-text domain. React escapes the returned
 * string when it is rendered as a text child; these removals also prevent
 * invisible direction overrides and terminal-style control characters.
 */
export function normalizePreviewText(value: string): string {
  return [...value.replace(/\r\n?/gu, '\n')]
    .filter((character) => !isDisallowedPreviewControl(character))
    .join('')
    .replace(/[\u202A-\u202E\u2066-\u2069]/gu, '');
}

function isDisallowedPreviewControl(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    ((codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) ||
      codePoint === 0x7f)
  );
}

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function unicodeCharacterCount(value: string): number {
  return [...value].length;
}

export function validateComposerDraft(draft: ComposerDraft): DraftValidation {
  const errors: DraftValidation['errors'] = {};
  const normalizedText = normalizePreviewText(draft.text);
  const text = normalizedText.trim();
  const warning = normalizePreviewText(draft.contentWarning).trim();
  const sourceUrl = draft.media.sourceUrl.trim();
  const mediaType = draft.media.mediaType.trim();
  const altText = normalizePreviewText(draft.media.altText).trim();

  if (text.length === 0) {
    errors.text = 'Write something before publication can be prepared.';
  } else if (unicodeCharacterCount(normalizedText) > MAX_POST_CHARACTERS) {
    errors.text = `Keep the post to ${MAX_POST_CHARACTERS.toLocaleString('en')} characters or fewer.`;
  } else if (utf8ByteLength(normalizedText) > MAX_POST_UTF8_BYTES) {
    errors.text = `Keep the post to ${MAX_POST_UTF8_BYTES.toLocaleString('en')} UTF-8 bytes or fewer.`;
  }

  if (warning.length > MAX_CONTENT_WARNING_CHARACTERS) {
    errors.contentWarning = `Keep the content warning to ${MAX_CONTENT_WARNING_CHARACTERS} characters or fewer.`;
  }

  if (draft.audience === 'community' && draft.communityId.trim().length === 0) {
    errors.communityId = 'Choose a community when the audience is community-only.';
  }

  if (sourceUrl.length > 0) {
    if (sourceUrl.length > MAX_SOURCE_URL_CHARACTERS) {
      errors.sourceUrl = `Keep the media reference to ${MAX_SOURCE_URL_CHARACTERS.toLocaleString('en')} characters or fewer.`;
    } else if (!isAllowedMediaUrl(sourceUrl)) {
      errors.sourceUrl =
        'Use a credential-free https:// or ipfs:// reference without query or fragment data.';
    }
    if (mediaType.length === 0) {
      errors.mediaType = 'Add the media type, such as image/jpeg.';
    } else if (
      mediaType.length > MAX_MEDIA_TYPE_CHARACTERS ||
      !/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/iu.test(mediaType)
    ) {
      errors.mediaType = 'Enter a valid media type, such as image/jpeg.';
    }
    if (altText.length === 0) {
      errors.altText = 'Describe the media for people who cannot see or hear it.';
    } else if (altText.length > MAX_ALT_TEXT_CHARACTERS) {
      errors.altText = `Keep alt text to ${MAX_ALT_TEXT_CHARACTERS.toLocaleString('en')} characters or fewer.`;
    }
  } else if (mediaType.length > 0 || altText.length > 0) {
    errors.sourceUrl = 'Add a media reference or clear its metadata.';
  }

  return {
    errors,
    valid: Object.keys(errors).length === 0,
  };
}

export function serializeComposerDraft(draft: ComposerDraft): string {
  return JSON.stringify(normalizeDraft(draft));
}

export function parseComposerDraft(serialized: string): ComposerDraft | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!isRecord(value) || value.version !== COMPOSER_DRAFT_VERSION) {
      return null;
    }

    const media = value.media;
    if (
      !isOneOf(value.audience, AUDIENCES) ||
      !isBoundedString(value.communityId, MAX_COMMUNITY_ID_CHARACTERS) ||
      !isBoundedString(value.contentWarning, MAX_CONTENT_WARNING_CHARACTERS) ||
      !isRecord(media) ||
      !isBoundedString(media.altText, MAX_ALT_TEXT_CHARACTERS) ||
      !isBoundedString(media.mediaType, MAX_MEDIA_TYPE_CHARACTERS) ||
      !isBoundedString(media.sourceUrl, MAX_SOURCE_URL_CHARACTERS) ||
      !isOneOf(value.remixPermission, REMIX_PERMISSIONS) ||
      !isOneOf(value.replyPermission, REPLY_PERMISSIONS) ||
      !isOneOf(value.storagePolicy, STORAGE_POLICIES) ||
      !isBoundedPostText(value.text)
    ) {
      return null;
    }

    return normalizeDraft({
      audience: value.audience,
      communityId: value.communityId,
      contentWarning: value.contentWarning,
      media: {
        altText: media.altText,
        mediaType: media.mediaType,
        sourceUrl: media.sourceUrl,
      },
      remixPermission: value.remixPermission,
      replyPermission: value.replyPermission,
      storagePolicy: value.storagePolicy,
      text: value.text,
      version: COMPOSER_DRAFT_VERSION,
    });
  } catch {
    return null;
  }
}

export function loadComposerDraft(storage: DraftStorage): ComposerDraft | null {
  try {
    const value = storage.getItem(COMPOSER_DRAFT_STORAGE_KEY);
    return value === null ? null : parseComposerDraft(value);
  } catch {
    return null;
  }
}

export function saveComposerDraft(storage: DraftStorage, draft: ComposerDraft): boolean {
  try {
    const serialized = serializeComposerDraft(draft);
    storage.setItem(COMPOSER_DRAFT_STORAGE_KEY, serialized);
    return storage.getItem(COMPOSER_DRAFT_STORAGE_KEY) === serialized;
  } catch {
    return false;
  }
}

export function discardComposerDraft(storage: DraftStorage): boolean {
  try {
    storage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
    return storage.getItem(COMPOSER_DRAFT_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

/**
 * Removes only the exact serialized draft selected by a caller that already
 * holds the browser publication lock. This comparison is not itself an atomic
 * mutex; it prevents cleanup from knowingly deleting a changed draft.
 */
export function discardExactComposerDraft(
  storage: DraftStorage,
  expectedSerialized: string | null,
): boolean {
  try {
    if (storage.getItem(COMPOSER_DRAFT_STORAGE_KEY) !== expectedSerialized) {
      return false;
    }
    if (expectedSerialized === null) return true;
    storage.removeItem(COMPOSER_DRAFT_STORAGE_KEY);
    return storage.getItem(COMPOSER_DRAFT_STORAGE_KEY) === null;
  } catch {
    return false;
  }
}

function normalizeDraft(draft: ComposerDraft): ComposerDraft {
  return {
    ...draft,
    communityId: normalizePreviewText(draft.communityId),
    contentWarning: normalizePreviewText(draft.contentWarning),
    media: {
      altText: normalizePreviewText(draft.media.altText),
      mediaType: normalizePreviewText(draft.media.mediaType),
      sourceUrl: normalizePreviewText(draft.media.sourceUrl),
    },
    text: normalizePreviewText(draft.text),
    version: COMPOSER_DRAFT_VERSION,
  };
}

function isAllowedMediaUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hasSafeSharedParts =
      url.username === '' &&
      url.password === '' &&
      url.hostname.length > 0 &&
      url.search === '' &&
      url.hash === '';

    if (!hasSafeSharedParts) {
      return false;
    }

    if (url.protocol === 'https:') {
      return true;
    }

    return url.protocol === 'ipfs:' && url.port === '';
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBoundedString(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string' && value.length <= maximumLength;
}

function isBoundedPostText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    unicodeCharacterCount(value) <= MAX_POST_CHARACTERS &&
    utf8ByteLength(value) <= MAX_POST_UTF8_BYTES
  );
}

function isOneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
): value is T[number] {
  return typeof value === 'string' && allowed.includes(value);
}
