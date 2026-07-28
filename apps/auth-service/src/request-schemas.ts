import { z } from 'zod';

import { decodeBase64Url } from './security.js';

const base64urlSchema = z
  .string()
  .min(1)
  .max(100_000)
  .regex(/^[A-Za-z0-9_-]+$/u);
const credentialIdSchema = base64urlSchema
  .max(1_364)
  .refine(
    (value) => decodeBase64Url(value, 1_023) !== undefined,
    'Credential ID must be canonical base64url of at most 1023 bytes.',
  );
const transportSchema = z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb']);
const attachmentSchema = z.enum(['cross-platform', 'platform']);
const clientExtensionResultsSchema = z.record(z.string(), z.unknown());

export const ceremonyIdSchema = z.string().regex(/^cer_[A-Za-z0-9_-]{22}$/u);
export const accountIdSchema = z.string().regex(/^acct_[A-Za-z0-9_-]{22}$/u);
export const credentialIdParamSchema = credentialIdSchema;

export const registrationResponseSchema = z
  .object({
    id: credentialIdSchema,
    rawId: credentialIdSchema,
    type: z.literal('public-key'),
    authenticatorAttachment: attachmentSchema.optional(),
    clientExtensionResults: clientExtensionResultsSchema,
    response: z
      .object({
        clientDataJSON: base64urlSchema,
        attestationObject: base64urlSchema,
        authenticatorData: base64urlSchema.optional(),
        transports: z.array(transportSchema).max(16).optional(),
        publicKeyAlgorithm: z.number().int().optional(),
        publicKey: base64urlSchema.optional(),
      })
      .strict(),
  })
  .strict()
  .refine((response) => response.id === response.rawId, 'Credential ID and raw ID must match.');

export const authenticationResponseSchema = z
  .object({
    id: credentialIdSchema,
    rawId: credentialIdSchema,
    type: z.literal('public-key'),
    authenticatorAttachment: attachmentSchema.optional(),
    clientExtensionResults: clientExtensionResultsSchema,
    response: z
      .object({
        clientDataJSON: base64urlSchema,
        authenticatorData: base64urlSchema,
        signature: base64urlSchema,
        userHandle: base64urlSchema.max(128).optional(),
      })
      .strict(),
  })
  .strict()
  .refine((response) => response.id === response.rawId, 'Credential ID and raw ID must match.');

export const registrationVerificationSchema = z
  .object({
    accountId: accountIdSchema,
    ceremonyId: ceremonyIdSchema,
    response: registrationResponseSchema,
  })
  .strict();

export const additionalRegistrationVerificationSchema = z
  .object({
    ceremonyId: ceremonyIdSchema,
    response: registrationResponseSchema,
  })
  .strict();

export const authenticationVerificationSchema = z
  .object({
    ceremonyId: ceremonyIdSchema,
    response: authenticationResponseSchema,
  })
  .strict();

export const emptyBodySchema = z.object({}).strict();
export const bundleBodySchema = z.object({ bundle: z.unknown() }).strict();
