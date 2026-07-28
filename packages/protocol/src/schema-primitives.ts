import bs58 from 'bs58';
import { z } from 'zod';

import {
  MAX_CRITICAL_POINTERS,
  MAX_EXTENSION_BYTES,
  MAX_EXTENSIONS,
  MAX_SEQUENCE,
  PROTOCOL_NAME,
  PROTOCOL_VERSION,
  SCHEMA_VERSION,
} from './constants.js';
import {
  assertCanonicalInput,
  hasExactMillisecondTimestamp,
  hasMaximumUtf8Bytes,
  isAbsoluteHttpsUrl,
} from './validation.js';

const base58Pattern = '[1-9A-HJ-NP-Za-km-z]+';
const networkPattern = new RegExp(`^woke:v1:${base58Pattern}:${base58Pattern}$`, 'u');
const identityPattern = new RegExp(
  `^swid:v1:woke:v1:${base58Pattern}:${base58Pattern}:${base58Pattern}$`,
  'u',
);
const keyPattern = new RegExp(
  `^swid:v1:woke:v1:${base58Pattern}:${base58Pattern}:${base58Pattern}#(?:root|delegation)/${base58Pattern}$`,
  'u',
);
const objectIdPattern = /^swobj:v1:[a-z][a-z0-9-]{1,31}:u[A-Za-z0-9_-]{43}$/u;
const digestPattern = /^u[A-Za-z0-9_-]{43}$/u;
const signaturePattern = /^u[A-Za-z0-9_-]{86}$/u;
const noncePattern = /^u[A-Za-z0-9_-]{22}$/u;
const cidPattern = /^b[a-z2-7]{20,120}$/u;
const languagePattern = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u;
const jsonPointerPattern = /^(?:|\/(?:[^~/]|~0|~1)*)$/u;
const extensionNamePattern =
  /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,62}(?:\.[a-z0-9-]+)*$/u;
const mediaTypePattern = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u;
const tokenAmountPattern = /^(?:0|[1-9]\d{0,38})$/u;
const handlePattern = /^[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$/u;
const scopePattern = /^[a-z][a-z0-9.-]{1,63}$/u;
const rolePattern = /^[a-z][a-z0-9-]{1,31}$/u;
const transactionPattern = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/u;
const U64_MAX = 18_446_744_073_709_551_615n;
const U128_MAX = 340_282_366_920_938_463_463_374_607_431_768_211_455n;

function isExactBase58Bytes(value: string, expectedBytes: number): boolean {
  const maximumEncodedLength = expectedBytes === 32 ? 44 : expectedBytes === 64 ? 88 : 128;
  if (value.length > maximumEncodedLength) {
    return false;
  }
  try {
    return bs58.decode(value).byteLength === expectedBytes;
  } catch {
    return false;
  }
}

function hasExactNetworkKeys(value: string): boolean {
  const [, , genesis, program] = value.split(':');
  return (
    genesis !== undefined &&
    program !== undefined &&
    isExactBase58Bytes(genesis, 32) &&
    isExactBase58Bytes(program, 32)
  );
}

function hasExactIdentityKeys(value: string): boolean {
  const [, , , , genesis, program, identity] = value.split(':');
  return (
    genesis !== undefined &&
    program !== undefined &&
    identity !== undefined &&
    isExactBase58Bytes(genesis, 32) &&
    isExactBase58Bytes(program, 32) &&
    isExactBase58Bytes(identity, 32)
  );
}

function hasExactSigningKey(value: string): boolean {
  const [identity, fragment] = value.split('#');
  const publicKey = fragment?.split('/')[1];
  return (
    identity !== undefined &&
    publicKey !== undefined &&
    hasExactIdentityKeys(identity) &&
    isExactBase58Bytes(publicKey, 32)
  );
}

export const networkIdSchema = z
  .string()
  .max(97)
  .regex(networkPattern)
  .refine(hasExactNetworkKeys, 'Network genesis hash and program ID must each decode to 32 bytes.');
export const identityIdSchema = z
  .string()
  .max(150)
  .regex(identityPattern)
  .refine(
    hasExactIdentityKeys,
    'Network genesis hash, program ID, and identity address must each decode to 32 bytes.',
  );
export const signingKeyIdSchema = z
  .string()
  .max(220)
  .regex(keyPattern)
  .refine(hasExactSigningKey, 'Signing keys and identity segments must each decode to 32 bytes.');
export const objectIdSchema = z.string().regex(objectIdPattern);
export const digestSchema = z.string().regex(digestPattern);
export const signatureSchema = z.string().regex(signaturePattern);
export const nonceSchema = z.string().regex(noncePattern);
export const cidSchema = z.string().regex(cidPattern);
export const timestampSchema = z
  .string()
  .refine(hasExactMillisecondTimestamp, 'Timestamp must use exact UTC milliseconds.');
export const languageSchema = z.string().regex(languagePattern);
export const safeHttpsUrlSchema = z
  .string()
  .max(2_048)
  .refine(isAbsoluteHttpsUrl, 'Expected an absolute credential-free HTTPS URL.');
export const sequenceSchema = z.number().int().nonnegative().max(MAX_SEQUENCE);
export const positiveSequenceSchema = z.number().int().positive().max(MAX_SEQUENCE);
export const tokenAmountSchema = z
  .string()
  .regex(tokenAmountPattern)
  .refine((value) => BigInt(value) <= U128_MAX, 'Token amount exceeds unsigned 128-bit range.');
export const positiveTokenAmountSchema = tokenAmountSchema.refine(
  (value) => value !== '0',
  'Token amounts must be positive.',
);
export const handleSchema = z.string().regex(handlePattern);
export const authorizationScopeSchema = z.string().regex(scopePattern);
export const communityRoleNameSchema = z.string().regex(rolePattern);
export const unsigned64Schema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,20})$/u)
  .refine((value) => BigInt(value) <= U64_MAX, 'Value exceeds unsigned 64-bit range.');
export const transactionSignatureSchema = z
  .string()
  .regex(transactionPattern)
  .refine(
    (value) => isExactBase58Bytes(value, 64),
    'Woke Network transaction signatures must decode to exactly 64 bytes.',
  );
export const solanaPublicKeySchema = z
  .string()
  .max(44)
  .regex(new RegExp(`^${base58Pattern}$`, 'u'))
  .refine(
    (value) => isExactBase58Bytes(value, 32),
    'Woke Network public keys must decode to exactly 32 bytes.',
  );

export const limitedString = (maximumBytes: number) =>
  z
    .string()
    .refine(
      (value) => hasMaximumUtf8Bytes(value, maximumBytes),
      `Value exceeds ${maximumBytes} UTF-8 bytes.`,
    );

export const nonEmptyLimitedString = (maximumBytes: number) =>
  limitedString(maximumBytes).refine((value) => value.trim().length > 0, 'Value cannot be blank.');

export const visibilitySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('public') }).strict(),
  z.object({ kind: z.literal('unlisted') }).strict(),
  z.object({ kind: z.literal('followers') }).strict(),
  z
    .object({
      kind: z.literal('community'),
      communityId: objectIdSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('restricted'),
      policyId: objectIdSchema,
    })
    .strict(),
]);

export const objectReferenceSchema = z
  .object({
    id: objectIdSchema,
    cid: cidSchema.optional(),
  })
  .strict();

export function objectIdType(objectId: string): string | undefined {
  return objectId.split(':')[2];
}

export function typedObjectReferenceSchema(
  allowedTypes: readonly string[],
): z.ZodType<z.infer<typeof objectReferenceSchema>> {
  return objectReferenceSchema.refine(
    (reference) => {
      const type = objectIdType(reference.id);
      return type !== undefined && allowedTypes.includes(type);
    },
    `Expected an object reference of type: ${allowedTypes.join(', ')}.`,
  );
}

export const publicContentProtectionSchema = z.object({ kind: z.literal('public') }).strict();

export const encryptedContentProtectionSchema = z
  .object({
    kind: z.literal('encrypted'),
    encryptionFormat: nonEmptyLimitedString(128),
    keyEnvelope: objectReferenceSchema,
    accessPolicy: objectReferenceSchema,
  })
  .strict();

export const contentProtectionSchema = z.discriminatedUnion('kind', [
  publicContentProtectionSchema,
  encryptedContentProtectionSchema,
]);

export const contentReferenceSchema = z
  .object({
    cid: cidSchema,
    digest: digestSchema,
    bytes: z.number().int().nonnegative().max(100_000_000),
    mediaType: z.string().regex(mediaTypePattern),
    protection: contentProtectionSchema.optional(),
  })
  .strict();

export const mediaReferenceSchema = z
  .object({
    cid: cidSchema,
    digest: digestSchema,
    bytes: z.number().int().nonnegative().max(2_000_000_000),
    mediaType: z.string().regex(mediaTypePattern),
    altText: limitedString(2_000).optional(),
    caption: limitedString(4_000).optional(),
    width: z.number().int().positive().max(32_768).optional(),
    height: z.number().int().positive().max(32_768).optional(),
    durationMilliseconds: z.number().int().positive().max(86_400_000).optional(),
    protection: contentProtectionSchema.optional(),
  })
  .strict();

export const authorLabelSchema = z
  .object({
    code: z.string().regex(/^[a-z][a-z0-9.-]{1,63}$/u),
    severity: z.enum(['info', 'notice', 'warning']),
  })
  .strict();

export const replacementSchema = z
  .object({
    sequence: positiveSequenceSchema,
    replaces: objectReferenceSchema.optional(),
  })
  .strict()
  .refine(
    (replacement) => replacement.sequence === 1 || replacement.replaces !== undefined,
    'Replacement sequences after 1 must identify the object they replace.',
  )
  .refine(
    (replacement) => replacement.sequence !== 1 || replacement.replaces === undefined,
    'The first sequence cannot replace an earlier object.',
  );

export const timeWindowSchema = z
  .object({
    startsAt: timestampSchema,
    endsAt: timestampSchema.optional(),
  })
  .strict()
  .refine(
    (window) => window.endsAt === undefined || window.startsAt < window.endsAt,
    'A time window must end after it starts.',
  );

const criticalSchema = z
  .array(z.string().regex(jsonPointerPattern))
  .max(MAX_CRITICAL_POINTERS)
  .refine((values) => new Set(values).size === values.length, 'Critical pointers must be unique.')
  .default([]);

const extensionsSchema = z
  .record(z.string().regex(extensionNamePattern), z.unknown())
  .superRefine((extensions, context) => {
    let isCanonicalJson = true;
    try {
      assertCanonicalInput(extensions);
    } catch (error) {
      isCanonicalJson = false;
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Extensions must contain canonical JSON.',
      });
    }
    if (Object.keys(extensions).length > MAX_EXTENSIONS) {
      context.addIssue({
        code: 'custom',
        message: `At most ${MAX_EXTENSIONS} extensions are allowed.`,
      });
    }
    if (
      isCanonicalJson &&
      new TextEncoder().encode(JSON.stringify(extensions)).byteLength > MAX_EXTENSION_BYTES
    ) {
      context.addIssue({
        code: 'custom',
        message: `Extensions exceed ${MAX_EXTENSION_BYTES} UTF-8 bytes.`,
      });
    }
  })
  .default({});

export const commonPayloadFields = {
  protocol: z.literal(PROTOCOL_NAME),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  schemaVersion: z.literal(SCHEMA_VERSION),
  network: networkIdSchema,
  author: identityIdSchema,
  signingKey: signingKeyIdSchema,
  createdAt: timestampSchema,
  nonce: nonceSchema,
  critical: criticalSchema,
  extensions: extensionsSchema,
};

export const proofSchema = z
  .object({
    algorithm: z.literal('Ed25519'),
    keyId: signingKeyIdSchema,
    payloadHash: digestSchema,
    signature: signatureSchema,
  })
  .strict();

export type NetworkId = z.infer<typeof networkIdSchema>;
export type IdentityId = z.infer<typeof identityIdSchema>;
export type SigningKeyId = z.infer<typeof signingKeyIdSchema>;
export type ObjectId = z.infer<typeof objectIdSchema>;
export type ObjectReference = z.infer<typeof objectReferenceSchema>;
export type ContentReference = z.infer<typeof contentReferenceSchema>;
export type MediaReference = z.infer<typeof mediaReferenceSchema>;
export type Visibility = z.infer<typeof visibilitySchema>;
export type Replacement = z.infer<typeof replacementSchema>;
export type TimeWindow = z.infer<typeof timeWindowSchema>;
