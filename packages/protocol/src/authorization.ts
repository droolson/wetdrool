import type { PortablePayload, PortablePayloadType } from './schemas.js';
import { ProtocolValidationError } from './validation.js';

export type ExternalEnforcementCheck =
  | 'key-authorized-at-created-at'
  | 'key-not-revoked'
  | 'target-exists'
  | 'replacement-chain'
  | 'handle-availability'
  | 'delegation-root-rotation'
  | 'target-author-or-authorized-delete'
  | 'community-authority'
  | 'community-membership'
  | 'moderation-provider-policy'
  | 'proposal-eligibility-and-window'
  | 'vote-eligibility-and-weight'
  | 'offering-issuer'
  | 'payment-finality-and-intent'
  | 'payment-not-previously-consumed'
  | 'entitlement-validity'
  | 'event-capacity';

export interface ObjectAuthorizationRequirement {
  readonly signing: 'root-only' | 'root-or-delegation';
  readonly scopes: readonly string[];
  readonly externalChecks: readonly ExternalEnforcementCheck[];
}

const commonExternalChecks = [
  'key-authorized-at-created-at',
  'key-not-revoked',
] as const satisfies readonly ExternalEnforcementCheck[];

const policy = (
  scopes: readonly string[],
  externalChecks: readonly ExternalEnforcementCheck[] = [],
  signing: ObjectAuthorizationRequirement['signing'] = 'root-or-delegation',
): ObjectAuthorizationRequirement => ({
  signing,
  scopes,
  externalChecks: [...commonExternalChecks, ...externalChecks],
});

const AUTHORIZATION_REQUIREMENTS = {
  profile: policy(['profile.write'], ['replacement-chain']),
  post: policy(['content.publish']),
  tombstone: policy(['content.delete'], ['target-exists', 'target-author-or-authorized-delete']),
  'handle-claim': policy(['identity.handle'], ['handle-availability', 'replacement-chain']),
  delegation: policy(['identity.delegate'], ['delegation-root-rotation'], 'root-only'),
  'follow-edge': policy(['social.follow'], ['target-exists', 'replacement-chain']),
  'block-edge': policy(['safety.block'], ['target-exists', 'replacement-chain']),
  'mute-preference': policy(['preferences.mute'], ['replacement-chain']),
  'post-revision': policy(['content.publish'], ['target-exists', 'replacement-chain']),
  reply: policy(['content.publish'], ['target-exists']),
  quote: policy(['content.publish'], ['target-exists']),
  repost: policy(['content.publish'], ['target-exists']),
  reaction: policy(['social.react'], ['target-exists', 'replacement-chain']),
  bookmark: policy(['preferences.bookmark'], ['target-exists', 'replacement-chain']),
  'media-manifest': policy(['content.media']),
  community: policy(['community.create'], ['replacement-chain'], 'root-only'),
  'community-membership': policy(
    ['community.membership'],
    ['target-exists', 'community-authority', 'community-membership', 'replacement-chain'],
  ),
  'community-role': policy(
    ['community.admin'],
    ['target-exists', 'community-authority', 'replacement-chain'],
  ),
  'community-rule-set': policy(
    ['community.rules'],
    ['target-exists', 'community-authority', 'replacement-chain'],
  ),
  'moderation-label': policy(['moderation.label'], ['target-exists', 'moderation-provider-policy']),
  report: policy(['safety.report'], ['target-exists']),
  appeal: policy(['safety.appeal'], ['target-exists']),
  'governance-proposal': policy(
    ['governance.propose'],
    ['target-exists', 'community-membership', 'proposal-eligibility-and-window'],
  ),
  'governance-vote': policy(
    ['governance.vote'],
    ['target-exists', 'community-membership', 'vote-eligibility-and-weight', 'replacement-chain'],
  ),
  'creator-offering': policy(['payments.offer'], ['offering-issuer', 'replacement-chain']),
  'subscription-entitlement': policy(
    ['payments.entitlement'],
    [
      'target-exists',
      'offering-issuer',
      'payment-finality-and-intent',
      'payment-not-previously-consumed',
      'entitlement-validity',
    ],
  ),
  'tip-receipt': policy(
    ['payments.tip'],
    ['payment-finality-and-intent', 'payment-not-previously-consumed'],
  ),
  event: policy(['event.publish'], ['event-capacity', 'replacement-chain']),
  'notification-preference': policy(['preferences.notification'], ['replacement-chain']),
} as const satisfies Record<PortablePayloadType, ObjectAuthorizationRequirement>;

const LEGACY_COMMUNITY_AUTHORIZATION_REQUIREMENT = policy(
  ['community.create'],
  ['replacement-chain'],
);

export function authorizationRequirementFor(
  payloadOrType: PortablePayload | PortablePayloadType,
): ObjectAuthorizationRequirement {
  if (
    typeof payloadOrType !== 'string' &&
    payloadOrType.type === 'community' &&
    payloadOrType.schemaVersion === 1
  ) {
    return LEGACY_COMMUNITY_AUTHORIZATION_REQUIREMENT;
  }
  return AUTHORIZATION_REQUIREMENTS[
    typeof payloadOrType === 'string' ? payloadOrType : payloadOrType.type
  ];
}

export function assertIntrinsicObjectAuthorization(payload: PortablePayload): void {
  const requirement = authorizationRequirementFor(payload);
  if (requirement.signing === 'root-only' && !payload.signingKey.includes('#root/')) {
    throw new ProtocolValidationError(
      `${payload.type} objects must be signed by an identity root key.`,
    );
  }
}
