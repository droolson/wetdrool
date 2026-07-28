import { z } from 'zod';

import { MAX_DESCRIPTION_BYTES, MAX_RECIPIENT_SPLITS } from './constants.js';
import {
  commonPayloadFields,
  identityIdSchema,
  limitedString,
  nonEmptyLimitedString,
  positiveTokenAmountSchema,
  replacementSchema,
  solanaPublicKeySchema,
  timeWindowSchema,
  transactionSignatureSchema,
  typedObjectReferenceSchema,
  unsigned64Schema,
} from './schema-primitives.js';

export const paymentAssetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('woke') }).strict(),
  z
    .object({
      kind: z.literal('spl'),
      mint: solanaPublicKeySchema,
      decimals: z.number().int().min(0).max(18),
      tokenProgram: z.enum(['spl-token', 'spl-token-2022']),
    })
    .strict(),
]);

export const recipientSplitSchema = z
  .object({
    recipient: identityIdSchema,
    basisPoints: z.number().int().positive().max(10_000),
  })
  .strict();

const recipientSplitsSchema = z
  .array(recipientSplitSchema)
  .min(1)
  .max(MAX_RECIPIENT_SPLITS)
  .superRefine((splits, context) => {
    if (new Set(splits.map((split) => split.recipient)).size !== splits.length) {
      context.addIssue({ code: 'custom', message: 'Payment recipients must be unique.' });
    }
    if (splits.reduce((sum, split) => sum + split.basisPoints, 0) !== 10_000) {
      context.addIssue({
        code: 'custom',
        message: 'Recipient splits must total exactly 10,000 basis points.',
      });
    }
  });

const billingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('one-time') }).strict(),
  z
    .object({
      kind: z.literal('recurring'),
      interval: z.enum(['week', 'month', 'year']),
    })
    .strict(),
]);

export const creatorOfferingContentSchema = z
  .object({
    offeringKind: z.enum([
      'subscription',
      'community-membership',
      'event-ticket',
      'digital-access',
    ]),
    title: nonEmptyLimitedString(200),
    description: limitedString(MAX_DESCRIPTION_BYTES).default(''),
    price: z
      .object({
        asset: paymentAssetSchema,
        amount: positiveTokenAmountSchema,
      })
      .strict(),
    billing: billingSchema,
    recipientSplits: recipientSplitsSchema,
    benefits: z.array(nonEmptyLimitedString(500)).max(32).default([]),
    fulfillment: typedObjectReferenceSchema(['community', 'event']).optional(),
    availability: timeWindowSchema,
    capacity: z.number().int().positive().max(1_000_000_000).optional(),
    refundPolicy: z
      .object({
        kind: z.enum(['none', 'creator-reviewed', 'until-start']),
        summary: nonEmptyLimitedString(1_000),
      })
      .strict(),
    state: z.enum(['active', 'paused', 'retired']),
    replacement: replacementSchema,
  })
  .strict()
  .refine(
    (content) =>
      content.offeringKind !== 'community-membership' ||
      content.fulfillment?.id.includes(':community:') === true,
    'Community memberships must fulfill a community object.',
  )
  .refine(
    (content) =>
      content.offeringKind !== 'event-ticket' ||
      content.fulfillment?.id.includes(':event:') === true,
    'Event tickets must fulfill an event object.',
  );

const paymentProofSchema = z
  .object({
    transactionSignature: transactionSignatureSchema,
    finalizedSlot: unsigned64Schema,
    asset: paymentAssetSchema,
    amount: positiveTokenAmountSchema,
  })
  .strict();

export const subscriptionEntitlementContentSchema = z
  .object({
    offering: typedObjectReferenceSchema(['creator-offering']),
    beneficiary: identityIdSchema,
    payment: paymentProofSchema,
    validity: timeWindowSchema,
    state: z.enum(['active', 'expired', 'refunded', 'revoked']),
    priorEntitlement: typedObjectReferenceSchema(['subscription-entitlement']).optional(),
    revocationReason: limitedString(1_000).optional(),
  })
  .strict()
  .refine(
    (content) =>
      (content.state !== 'refunded' && content.state !== 'revoked') ||
      content.revocationReason !== undefined,
    'Refunded or revoked entitlements require a reason.',
  );

export const tipReceiptContentSchema = z
  .object({
    payer: identityIdSchema,
    recipient: identityIdSchema,
    payment: paymentProofSchema,
    recipientSplits: recipientSplitsSchema,
    paymentIntent: z.string().regex(/^u[A-Za-z0-9_-]{43}$/u),
    memo: limitedString(500).optional(),
  })
  .strict()
  .refine(
    (content) =>
      content.recipientSplits.some((split) => split.recipient === content.recipient) &&
      content.payer !== content.recipient,
    'A tip recipient must receive a split and differ from the payer.',
  );

export const creatorOfferingPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('creator-offering'),
    content: creatorOfferingContentSchema,
  })
  .strict()
  .refine(
    (payload) =>
      payload.content.recipientSplits.some((split) => split.recipient === payload.author),
    'The offering author must receive a declared payment split.',
  );

export const subscriptionEntitlementPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('subscription-entitlement'),
    content: subscriptionEntitlementContentSchema,
  })
  .strict();

export const tipReceiptPayloadSchema = z
  .object({
    ...commonPayloadFields,
    type: z.literal('tip-receipt'),
    content: tipReceiptContentSchema,
  })
  .strict()
  .refine(
    (payload) => payload.content.payer === payload.author,
    'A tip receipt must be payer-signed.',
  );

export type PaymentAsset = z.infer<typeof paymentAssetSchema>;
export type RecipientSplit = z.infer<typeof recipientSplitSchema>;
export type CreatorOfferingContent = z.infer<typeof creatorOfferingContentSchema>;
export type SubscriptionEntitlementContent = z.infer<typeof subscriptionEntitlementContentSchema>;
export type TipReceiptContent = z.infer<typeof tipReceiptContentSchema>;
export type CreatorOfferingPayload = z.infer<typeof creatorOfferingPayloadSchema>;
export type SubscriptionEntitlementPayload = z.infer<typeof subscriptionEntitlementPayloadSchema>;
export type TipReceiptPayload = z.infer<typeof tipReceiptPayloadSchema>;
