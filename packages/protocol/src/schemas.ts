import { z } from 'zod';

import {
  communityMembershipPayloadSchema,
  communityPayloadSchema,
  communityRolePayloadSchema,
  communityRuleSetPayloadSchema,
  eventPayloadSchema,
  governanceProposalPayloadSchema,
  governanceVotePayloadSchema,
} from './community-schemas.js';
import {
  mediaManifestPayloadSchema,
  postPayloadSchema,
  postRevisionPayloadSchema,
  profilePayloadSchema,
  quotePayloadSchema,
  replyPayloadSchema,
  tombstonePayloadSchema,
} from './content-schemas.js';
import {
  creatorOfferingPayloadSchema,
  subscriptionEntitlementPayloadSchema,
  tipReceiptPayloadSchema,
} from './economy-schemas.js';
import { objectIdType, proofSchema } from './schema-primitives.js';
import {
  appealPayloadSchema,
  moderationLabelPayloadSchema,
  reportPayloadSchema,
} from './safety-schemas.js';
import {
  blockEdgePayloadSchema,
  bookmarkPayloadSchema,
  delegationPayloadSchema,
  followEdgePayloadSchema,
  handleClaimPayloadSchema,
  mutePreferencePayloadSchema,
  notificationPreferencePayloadSchema,
  reactionPayloadSchema,
  repostPayloadSchema,
} from './social-schemas.js';

export * from './community-schemas.js';
export * from './content-schemas.js';
export * from './economy-schemas.js';
export * from './safety-schemas.js';
export * from './schema-primitives.js';
export * from './social-schemas.js';

export const portablePayloadSchema = z
  .discriminatedUnion('type', [
    profilePayloadSchema,
    postPayloadSchema,
    tombstonePayloadSchema,
    handleClaimPayloadSchema,
    delegationPayloadSchema,
    followEdgePayloadSchema,
    blockEdgePayloadSchema,
    mutePreferencePayloadSchema,
    postRevisionPayloadSchema,
    replyPayloadSchema,
    quotePayloadSchema,
    repostPayloadSchema,
    reactionPayloadSchema,
    bookmarkPayloadSchema,
    mediaManifestPayloadSchema,
    communityPayloadSchema,
    communityMembershipPayloadSchema,
    communityRolePayloadSchema,
    communityRuleSetPayloadSchema,
    moderationLabelPayloadSchema,
    reportPayloadSchema,
    appealPayloadSchema,
    governanceProposalPayloadSchema,
    governanceVotePayloadSchema,
    creatorOfferingPayloadSchema,
    subscriptionEntitlementPayloadSchema,
    tipReceiptPayloadSchema,
    eventPayloadSchema,
    notificationPreferencePayloadSchema,
  ])
  .superRefine((payload, context) => {
    if (!payload.author.startsWith(`wokesocialid:v1:${payload.network}:`)) {
      context.addIssue({
        code: 'custom',
        path: ['author'],
        message: 'The payload author must belong to the payload network.',
      });
    }
    if (!payload.signingKey.startsWith(`${payload.author}#`)) {
      context.addIssue({
        code: 'custom',
        path: ['signingKey'],
        message: 'The signing key must belong to the payload author.',
      });
    }
    if (payload.critical.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['critical'],
        message:
          'This v1 implementation does not recognize any critical extension pointers; refusing unsafe forward compatibility.',
      });
    }

    switch (payload.type) {
      case 'handle-claim':
      case 'follow-edge':
      case 'block-edge':
      case 'mute-preference':
      case 'reaction':
      case 'bookmark':
      case 'community':
      case 'community-membership':
      case 'community-role':
      case 'governance-vote':
      case 'creator-offering':
      case 'event':
      case 'notification-preference': {
        const replacedId = payload.content.replacement.replaces?.id;
        if (replacedId !== undefined && objectIdType(replacedId) !== payload.type) {
          context.addIssue({
            code: 'custom',
            path: ['content', 'replacement', 'replaces'],
            message: `A ${payload.type} replacement must reference the same object type.`,
          });
        }
        break;
      }
      default:
        break;
    }
  });

export const signedEnvelopeSchema = z
  .object({
    payload: portablePayloadSchema,
    proof: proofSchema,
  })
  .strict();

export type PortablePayload = z.infer<typeof portablePayloadSchema>;
export type SignedEnvelope = z.infer<typeof signedEnvelopeSchema>;
export type PortablePayloadType = PortablePayload['type'];
export type PayloadForType<Type extends PortablePayloadType> = Extract<
  PortablePayload,
  { readonly type: Type }
>;
export type ContentForType<Type extends PortablePayloadType> = PayloadForType<Type>['content'];
