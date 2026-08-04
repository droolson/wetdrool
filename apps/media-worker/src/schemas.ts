import {
  contentReferenceSchema,
  digestSchema,
  languageSchema,
  mediaManifestContentSchema,
  mediaReferenceSchema,
  nonEmptyLimitedString,
} from '@wetdrool/protocol';
import { z } from 'zod';

export const maximumUploadBytes = 100_000_000;
export const maximumChunkBytes = 8_000_000;

const storagePolicySchema = z
  .object({
    permanence: z
      .enum(['deletion-compatible', 'provider-dependent', 'permanent'])
      .default('deletion-compatible'),
    consentId: z.string().trim().min(8).max(200).optional(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.permanence === 'permanent' && policy.consentId === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['consentId'],
        message: 'Permanent storage requires an explicit consent identifier.',
      });
    }
  });

export const uploadIdSchema = z.uuid();

const trimmedLimitedString = (maximumUtf8Bytes: number) =>
  z
    .string()
    .transform((value) => value.trim().normalize('NFC'))
    .pipe(nonEmptyLimitedString(maximumUtf8Bytes));

export const uploadCreateSchema = z
  .object({
    declaredMediaType: z.string().trim().toLowerCase().min(3).max(100),
    totalBytes: z.number().int().positive().max(maximumUploadBytes),
    sha256: digestSchema,
    processingMode: z.enum(['managed', 'preprocessed']).default('managed'),
    metadataStripped: z.literal(true).optional(),
    altText: trimmedLimitedString(2_000).optional(),
    caption: trimmedLimitedString(4_000).optional(),
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
    storagePolicy: storagePolicySchema.default({ permanence: 'deletion-compatible' }),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.processingMode === 'preprocessed' && input.metadataStripped !== true) {
      context.addIssue({
        code: 'custom',
        path: ['metadataStripped'],
        message: 'Preprocessed publication requires an explicit metadata-stripped assertion.',
      });
    }
    if (
      input.declaredMediaType.startsWith('image/') &&
      input.altText === undefined &&
      input.caption === undefined
    ) {
      context.addIssue({
        code: 'custom',
        path: ['altText'],
        message: 'Images require alt text or a caption.',
      });
    }
  });

export const scannerResultSchema = z
  .object({
    status: z.enum(['passed', 'failed']),
    scanner: trimmedLimitedString(160),
    scannerVersion: trimmedLimitedString(160),
    checkedAt: z.iso.datetime(),
    detail: trimmedLimitedString(1_000).optional(),
  })
  .strict();

const storageReceiptSchema = z
  .object({
    cid: mediaReferenceSchema.shape.cid,
    provider: trimmedLimitedString(160),
    providerVersion: trimmedLimitedString(160),
    locator: trimmedLimitedString(2_048),
    byteLength: z.number().int().nonnegative().max(2_000_000_000),
    publishedAt: z.iso.datetime(),
    policy: storagePolicySchema,
    verified: z.literal(true),
    transactionId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/u)
      .optional(),
    contentSha256: digestSchema.optional(),
    uploader: trimmedLimitedString(160).optional(),
    uploaderVersion: trimmedLimitedString(160).optional(),
    confirmation: z.literal('confirmed').optional(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const permanentFields = [
      receipt.transactionId,
      receipt.contentSha256,
      receipt.uploader,
      receipt.uploaderVersion,
      receipt.confirmation,
    ];
    const provided = permanentFields.filter((value) => value !== undefined).length;
    if (provided !== 0 && provided !== permanentFields.length) {
      context.addIssue({
        code: 'custom',
        path: ['transactionId'],
        message: 'Permanent-provider receipt evidence must be complete.',
      });
    }
  });

const artifactPublicationSchema = z
  .object({
    cid: mediaReferenceSchema.shape.cid,
    digest: mediaReferenceSchema.shape.digest,
    bytes: mediaReferenceSchema.shape.bytes,
    mediaType: mediaReferenceSchema.shape.mediaType,
    receipts: z.array(storageReceiptSchema).min(1).max(16),
    failures: z
      .array(
        z
          .object({
            provider: trimmedLimitedString(160),
            message: z.literal('Provider publication failed.'),
          })
          .strict(),
      )
      .max(16),
    replication: z.enum(['satisfied', 'degraded']),
  })
  .strict()
  .superRefine((publication, context) => {
    if (
      (publication.failures.length === 0 && publication.replication !== 'satisfied') ||
      (publication.failures.length > 0 && publication.replication !== 'degraded')
    ) {
      context.addIssue({
        code: 'custom',
        path: ['replication'],
        message: 'Replication state does not match provider failures.',
      });
    }
    if (
      publication.receipts.some(
        (receipt) => receipt.cid !== publication.cid || receipt.byteLength !== publication.bytes,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['receipts'],
        message: 'Storage receipts do not match their artifact publication.',
      });
    }
  });

export const publicationResultSchema = z
  .object({
    uploadId: uploadIdSchema,
    unsigned: z.literal(true),
    clientMustSign: z.literal(true),
    source: z
      .object({
        sha256: digestSchema,
        bytes: z.number().int().positive().max(maximumUploadBytes),
        declaredMediaType: z.string().trim().toLowerCase().min(3).max(100),
        detectedMediaType: z.string().trim().toLowerCase().min(3).max(100),
      })
      .strict(),
    scan: scannerResultSchema,
    manifestContent: mediaManifestContentSchema,
    publications: z.array(artifactPublicationSchema).min(1).max(70),
  })
  .strict()
  .superRefine((result, context) => {
    const publications = new Map(
      result.publications.map((publication) => [publication.cid, publication]),
    );
    if (publications.size !== result.publications.length) {
      context.addIssue({
        code: 'custom',
        path: ['publications'],
        message: 'Artifact publications must have distinct content identifiers.',
      });
    }
    const references = [
      result.manifestContent.original,
      ...result.manifestContent.variants.map((variant) => variant.reference),
      ...(result.manifestContent.waveform === undefined ? [] : [result.manifestContent.waveform]),
    ];
    if (
      references.some((reference) => {
        const publication = publications.get(reference.cid);
        return (
          publication === undefined ||
          publication.digest !== reference.digest ||
          publication.bytes !== reference.bytes ||
          publication.mediaType !== reference.mediaType
        );
      })
    ) {
      context.addIssue({
        code: 'custom',
        path: ['manifestContent'],
        message: 'Manifest references do not match artifact publications.',
      });
    }
  });

export const uploadOffsetSchema = z.coerce.number().int().nonnegative().max(maximumUploadBytes);
export const chunkDigestSchema = digestSchema;
export const protocolManifestContentSchema = mediaManifestContentSchema;

export type UploadCreateInput = z.infer<typeof uploadCreateSchema>;
