import { z } from 'zod';

import {
  MAX_DISPLAY_NAME_BYTES,
  MAX_INLINE_POST_BYTES,
  MAX_MEDIA_ITEMS,
  MAX_PROFILE_BIO_BYTES,
} from './constants.js';
import {
  authorLabelSchema,
  commonPayloadFields,
  contentReferenceSchema,
  languageSchema,
  limitedString,
  mediaReferenceSchema,
  objectReferenceSchema,
  positiveSequenceSchema,
  safeHttpsUrlSchema,
  typedObjectReferenceSchema,
  visibilitySchema,
} from './schema-primitives.js';

const accessibilitySchema = z
  .object({
    altTextReminderAcknowledged: z.boolean().default(false),
    transcriptReference: contentReferenceSchema.optional(),
    captionReferences: z.array(contentReferenceSchema).max(16).default([]),
  })
  .strict()
  .default({
    altTextReminderAcknowledged: false,
    captionReferences: [],
  });

const postContentFields = {
  format: z.enum(['plain', 'markdown']),
  body: limitedString(MAX_INLINE_POST_BYTES).optional(),
  bodyReference: contentReferenceSchema.optional(),
  media: z.array(mediaReferenceSchema).max(MAX_MEDIA_ITEMS).default([]),
  replyTo: objectReferenceSchema.optional(),
  quoteOf: objectReferenceSchema.optional(),
  language: languageSchema,
  contentWarnings: z.array(limitedString(160)).max(8).default([]),
  accessibility: accessibilitySchema,
  visibility: visibilitySchema,
  authorLabels: z.array(authorLabelSchema).max(16).default([]),
  editParent: objectReferenceSchema.optional(),
  replyPolicy: z.enum(['anyone', 'followers', 'mentioned', 'none']),
  quotePolicy: z.enum(['allowed', 'followers', 'none']),
};

interface PostValidationView {
  readonly body?: string | undefined;
  readonly bodyReference?:
    | {
        readonly protection?:
          | {
              readonly kind: 'public' | 'encrypted';
            }
          | undefined;
      }
    | undefined;
  readonly media: readonly {
    readonly mediaType: string;
    readonly altText?: string | undefined;
    readonly protection?:
      | {
          readonly kind: 'public' | 'encrypted';
        }
      | undefined;
  }[];
  readonly accessibility: {
    readonly altTextReminderAcknowledged: boolean;
  };
  readonly visibility: {
    readonly kind: 'public' | 'unlisted' | 'followers' | 'community' | 'restricted';
  };
}

function hasPostBodyOrMedia(content: PostValidationView): boolean {
  return (
    (content.body !== undefined && content.body.length > 0) ||
    content.bodyReference !== undefined ||
    content.media.length > 0
  );
}

function hasAccessibleImages(content: PostValidationView): boolean {
  return content.media.every(
    (media) =>
      !media.mediaType.startsWith('image/') ||
      (media.altText !== undefined && media.altText.trim().length > 0) ||
      content.accessibility.altTextReminderAcknowledged,
  );
}

function hasProtectedRestrictedContent(content: PostValidationView): boolean {
  if (content.visibility.kind === 'public' || content.visibility.kind === 'unlisted') {
    return true;
  }
  return (
    content.body === undefined &&
    (content.bodyReference === undefined ||
      content.bodyReference.protection?.kind === 'encrypted') &&
    content.media.every((media) => media.protection?.kind === 'encrypted')
  );
}

export const postContentSchema = z
  .object(postContentFields)
  .strict()
  .refine(hasPostBodyOrMedia, 'A post requires a body, body reference, or media.')
  .refine(hasAccessibleImages, 'Images require alt text or an explicit reminder acknowledgement.')
  .refine(
    hasProtectedRestrictedContent,
    'Follower, community, and restricted content must use encrypted references without inline body text.',
  );

const pronounSchema = z
  .object({
    value: limitedString(80),
    visibility: z.enum(['public', 'followers', 'private']),
  })
  .strict();

export const profileContentSchema = z
  .object({
    displayName: limitedString(MAX_DISPLAY_NAME_BYTES),
    bio: limitedString(MAX_PROFILE_BIO_BYTES).default(''),
    avatar: mediaReferenceSchema.optional(),
    banner: mediaReferenceSchema.optional(),
    pronouns: z.array(pronounSchema).max(8).default([]),
    gender: limitedString(160).optional(),
    genderVisibility: z.enum(['public', 'followers', 'private']).default('private'),
    chosenFamilyLabels: z.array(limitedString(160)).max(16).default([]),
    location: limitedString(240).optional(),
    website: safeHttpsUrlSchema.optional(),
    links: z
      .array(
        z
          .object({
            label: limitedString(80),
            url: safeHttpsUrlSchema,
          })
          .strict(),
      )
      .max(12)
      .default([]),
  })
  .strict();

export const tombstoneContentSchema = z
  .object({
    target: objectReferenceSchema,
    reason: z.enum(['author-deleted', 'superseded', 'key-compromised', 'legal-request', 'other']),
    replacement: objectReferenceSchema.optional(),
    explanation: limitedString(1_000).optional(),
  })
  .strict()
  .refine(
    (content) => content.reason !== 'superseded' || content.replacement !== undefined,
    'A superseded object must identify its replacement.',
  )
  .refine(
    (content) => content.replacement === undefined || content.replacement.id !== content.target.id,
    'A tombstone replacement must differ from its target.',
  );

export const postRevisionContentSchema = z
  .object({
    original: typedObjectReferenceSchema(['post']),
    previous: typedObjectReferenceSchema(['post', 'post-revision']),
    revision: positiveSequenceSchema.refine(
      (value) => value >= 2,
      'Post revision numbers begin at 2.',
    ),
    content: postContentSchema,
    changeSummary: limitedString(500).optional(),
  })
  .strict()
  .refine(
    (content) => content.revision !== 2 || content.previous.id === content.original.id,
    'The second revision must directly replace the original post.',
  );

export const replyContentSchema = z
  .object({
    ...postContentFields,
    replyTo: typedObjectReferenceSchema(['post', 'post-revision', 'reply', 'quote']),
  })
  .strict()
  .refine(hasPostBodyOrMedia, 'A post requires a body, body reference, or media.')
  .refine(hasAccessibleImages, 'Images require alt text or an explicit reminder acknowledgement.')
  .refine(
    hasProtectedRestrictedContent,
    'Follower, community, and restricted content must use encrypted references without inline body text.',
  );

export const quoteContentSchema = z
  .object({
    ...postContentFields,
    quoteOf: typedObjectReferenceSchema(['post', 'post-revision', 'reply', 'quote', 'repost']),
  })
  .strict()
  .refine(hasPostBodyOrMedia, 'A post requires a body, body reference, or media.')
  .refine(hasAccessibleImages, 'Images require alt text or an explicit reminder acknowledgement.')
  .refine(
    hasProtectedRestrictedContent,
    'Follower, community, and restricted content must use encrypted references without inline body text.',
  );

export const mediaManifestContentSchema = z
  .object({
    original: mediaReferenceSchema,
    variants: z
      .array(
        z
          .object({
            purpose: z.enum([
              'thumbnail',
              'responsive',
              'poster',
              'hls-master',
              'hls-segment',
              'audio',
            ]),
            reference: mediaReferenceSchema,
          })
          .strict(),
      )
      .max(64)
      .default([]),
    captions: z
      .array(
        z
          .object({
            language: languageSchema,
            kind: z.enum(['captions', 'subtitles', 'descriptions']),
            reference: contentReferenceSchema,
          })
          .strict(),
      )
      .max(32)
      .default([]),
    waveform: contentReferenceSchema.optional(),
    metadataStripped: z.boolean(),
    malwareScan: z
      .object({
        status: z.enum(['not-requested', 'pending', 'passed', 'failed']),
        scannerStatement: objectReferenceSchema.optional(),
      })
      .strict(),
    processingNotes: limitedString(1_000).optional(),
  })
  .strict()
  .superRefine((content, context) => {
    const cids = [
      content.original.cid,
      ...content.variants.map((variant) => variant.reference.cid),
    ];
    if (new Set(cids).size !== cids.length) {
      context.addIssue({
        code: 'custom',
        path: ['variants'],
        message: 'Media variants must have distinct content identifiers.',
      });
    }
    if (
      content.original.mediaType.startsWith('image/') &&
      content.original.altText === undefined &&
      content.original.caption === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['original', 'altText'],
        message: 'Image media manifests require alt text or a caption.',
      });
    }
  });

export const postPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('post'),
    content: postContentSchema,
  })
  .strict();

export const profilePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('profile'),
    content: profileContentSchema,
  })
  .strict();

export const tombstonePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('tombstone'),
    content: tombstoneContentSchema,
  })
  .strict();

export const postRevisionPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('post-revision'),
    content: postRevisionContentSchema,
  })
  .strict();

export const replyPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('reply'),
    content: replyContentSchema,
  })
  .strict();

export const quotePayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('quote'),
    content: quoteContentSchema,
  })
  .strict();

export const mediaManifestPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('media-manifest'),
    content: mediaManifestContentSchema,
  })
  .strict();

export type PostContent = z.infer<typeof postContentSchema>;
export type ProfileContent = z.infer<typeof profileContentSchema>;
export type TombstoneContent = z.infer<typeof tombstoneContentSchema>;
export type DeletionTombstoneContent = TombstoneContent;
export type PostRevisionContent = z.infer<typeof postRevisionContentSchema>;
export type ReplyContent = z.infer<typeof replyContentSchema>;
export type QuoteContent = z.infer<typeof quoteContentSchema>;
export type MediaManifestContent = z.infer<typeof mediaManifestContentSchema>;
export type PostPayload = z.infer<typeof postPayloadSchema>;
export type ProfilePayload = z.infer<typeof profilePayloadSchema>;
export type TombstonePayload = z.infer<typeof tombstonePayloadSchema>;
export type DeletionTombstonePayload = TombstonePayload;
export type PostRevisionPayload = z.infer<typeof postRevisionPayloadSchema>;
export type ReplyPayload = z.infer<typeof replyPayloadSchema>;
export type QuotePayload = z.infer<typeof quotePayloadSchema>;
export type MediaManifestPayload = z.infer<typeof mediaManifestPayloadSchema>;
