export const PROTOCOL_NAME = 'wokesocial' as const;
export const PROTOCOL_VERSION = '1.0' as const;
export const SCHEMA_VERSION = 1 as const;
/** Current schema version for newly created profile objects. */
export const PROFILE_SCHEMA_VERSION = 2 as const;
/** Current schema version for newly created community objects. */
export const COMMUNITY_SCHEMA_VERSION = 2 as const;
export const SIGNATURE_DOMAIN = 'woke.social/protocol/signed-object' as const;

export const MAX_INLINE_POST_BYTES = 10_000;
export const MAX_PROFILE_BIO_BYTES = 2_000;
export const MAX_DISPLAY_NAME_BYTES = 160;
export const MAX_MEDIA_ITEMS = 10;
export const MAX_EXTENSIONS = 32;
export const MAX_CRITICAL_POINTERS = 32;
export const MAX_EXTENSION_BYTES = 32_768;
export const MAX_TEXT_BYTES = 10_000;
export const MAX_DESCRIPTION_BYTES = 4_000;
export const MAX_RULES = 128;
export const MAX_ROLES = 64;
export const MAX_RECIPIENT_SPLITS = 32;
export const MAX_EVIDENCE_ITEMS = 32;
export const MAX_NOTIFICATION_CATEGORIES = 32;
export const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;

export const PORTABLE_OBJECT_TYPES = [
  'profile',
  'post',
  'tombstone',
  'handle-claim',
  'delegation',
  'follow-edge',
  'block-edge',
  'mute-preference',
  'post-revision',
  'reply',
  'quote',
  'repost',
  'reaction',
  'bookmark',
  'media-manifest',
  'community',
  'community-membership',
  'community-role',
  'community-rule-set',
  'moderation-label',
  'report',
  'appeal',
  'governance-proposal',
  'governance-vote',
  'creator-offering',
  'subscription-entitlement',
  'tip-receipt',
  'event',
  'notification-preference',
] as const;

export type PortableObjectType = (typeof PORTABLE_OBJECT_TYPES)[number];
