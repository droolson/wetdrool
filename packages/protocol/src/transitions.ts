import { getObjectId } from './identifiers.js';
import {
  portablePayloadSchema,
  type CommunityMembershipPayload,
  type CommunityRuleSetPayload,
  type ModerationLabelPayload,
  type PortablePayload,
  type PostRevisionPayload,
  type Replacement,
  type SubscriptionEntitlementPayload,
  type TombstonePayload,
} from './schemas.js';
import { ProtocolValidationError } from './validation.js';

function replacementFor(payload: PortablePayload): Replacement | undefined {
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
    case 'notification-preference':
      return payload.content.replacement;
    case 'profile':
    case 'post':
    case 'tombstone':
    case 'delegation':
    case 'post-revision':
    case 'reply':
    case 'quote':
    case 'repost':
    case 'media-manifest':
    case 'community-rule-set':
    case 'moderation-label':
    case 'report':
    case 'appeal':
    case 'governance-proposal':
    case 'subscription-entitlement':
    case 'tip-receipt':
      return undefined;
  }
}

function transitionSubject(payload: PortablePayload): string | undefined {
  switch (payload.type) {
    case 'handle-claim':
      return `${JSON.stringify(payload.content.namespace)}:${payload.content.handle}`;
    case 'follow-edge':
    case 'block-edge':
      return payload.content.target;
    case 'mute-preference':
      return JSON.stringify(payload.content.target);
    case 'reaction':
      return `${payload.content.target.id}:${JSON.stringify(payload.content.reaction)}`;
    case 'bookmark':
      return payload.content.target.id;
    case 'community':
      return payload.content.slug;
    case 'community-membership':
      return payload.schemaVersion === 1
        ? `${payload.content.community.id}:${payload.content.member}`
        : `${payload.content.communityAddress}:${payload.content.member}`;
    case 'community-role':
      return `${payload.content.community.id}:${payload.content.name}`;
    case 'governance-vote':
      return payload.content.proposal.id;
    default:
      return undefined;
  }
}

function assertSameLineage(previous: PortablePayload, next: PortablePayload): void {
  if (previous.network !== next.network) {
    throw new ProtocolValidationError('Object transitions cannot cross networks.');
  }
  if (previous.author !== next.author) {
    throw new ProtocolValidationError('Object transitions must retain the same author.');
  }
  if (previous.createdAt >= next.createdAt) {
    throw new ProtocolValidationError('Object transition timestamps must increase.');
  }
}

export function assertValidReplacementTransition(
  previousInput: PortablePayload,
  nextInput: PortablePayload,
): void {
  const previous = portablePayloadSchema.parse(previousInput);
  const next = portablePayloadSchema.parse(nextInput);
  if (
    previous.type === 'community-membership' &&
    next.type === 'community-membership' &&
    (previous.schemaVersion === 2 || next.schemaVersion === 2)
  ) {
    assertValidCommunityMembershipTransition(previous, next);
    return;
  }
  if (previous.type !== next.type) {
    throw new ProtocolValidationError('Replacement transitions must retain the object type.');
  }
  assertSameLineage(previous, next);

  const previousReplacement = replacementFor(previous);
  const nextReplacement = replacementFor(next);
  if (previousReplacement === undefined || nextReplacement === undefined) {
    throw new ProtocolValidationError(`${next.type} does not use replacement transitions.`);
  }
  if (nextReplacement.sequence !== previousReplacement.sequence + 1) {
    throw new ProtocolValidationError('Replacement sequences must increase by exactly one.');
  }
  if (nextReplacement.replaces?.id !== getObjectId(previous)) {
    throw new ProtocolValidationError('Replacement must reference the exact prior object ID.');
  }

  const previousSubject = transitionSubject(previous);
  const nextSubject = transitionSubject(next);
  if (
    previousSubject !== undefined &&
    nextSubject !== undefined &&
    previousSubject !== nextSubject
  ) {
    throw new ProtocolValidationError('Replacement transitions cannot change their subject.');
  }
}

const ALLOWED_COMMUNITY_MEMBERSHIP_ACTIONS = {
  active: ['leave', 'remove', 'ban'],
  left: ['join', 'ban'],
  removed: ['join', 'ban'],
  banned: [],
} as const satisfies Record<
  CommunityMembershipPayload['content']['state'],
  readonly CommunityMembershipPayload['content']['action'][]
>;

/**
 * Validates the shared membership-state lineage.
 *
 * Unlike author-owned replacement objects, a membership may move between a
 * member-authored self action and a separately authorized moderator action.
 * The network, community, member, sequence, prior object, and timestamp remain
 * immutable/exact across that actor change.
 */
export function assertValidCommunityMembershipTransition(
  previousInput: PortablePayload,
  nextInput: PortablePayload,
): void {
  const previous = portablePayloadSchema.parse(previousInput);
  const next = portablePayloadSchema.parse(nextInput);
  if (previous.type !== 'community-membership' || next.type !== 'community-membership') {
    throw new ProtocolValidationError('Expected community membership actions.');
  }
  if (previous.schemaVersion !== 2 || next.schemaVersion !== 2) {
    throw new ProtocolValidationError(
      'Community membership replacement transitions cannot cross schema versions.',
    );
  }
  if (previous.network !== next.network) {
    throw new ProtocolValidationError('Community membership transitions cannot cross networks.');
  }
  if (previous.content.communityAddress !== next.content.communityAddress) {
    throw new ProtocolValidationError(
      'Community membership transitions cannot change communities.',
    );
  }
  if (previous.content.member !== next.content.member) {
    throw new ProtocolValidationError('Community membership transitions cannot change members.');
  }
  if (previous.createdAt >= next.createdAt) {
    throw new ProtocolValidationError('Community membership action timestamps must increase.');
  }
  if (next.content.replacement.sequence !== previous.content.replacement.sequence + 1) {
    throw new ProtocolValidationError(
      'Community membership sequences must increase by exactly one.',
    );
  }
  if (next.content.replacement.replaces?.id !== getObjectId(previous)) {
    throw new ProtocolValidationError(
      'Community membership replacement must reference the exact prior object ID.',
    );
  }
  const allowedActions = ALLOWED_COMMUNITY_MEMBERSHIP_ACTIONS[previous.content.state];
  if (!(allowedActions as readonly string[]).includes(next.content.action)) {
    throw new ProtocolValidationError(
      `Community membership action ${next.content.action} cannot follow state ${previous.content.state}.`,
    );
  }
}

export function assertValidPostRevisionTransition(
  previousInput: PortablePayload,
  nextInput: PostRevisionPayload,
): void {
  const previous = portablePayloadSchema.parse(previousInput);
  const next = portablePayloadSchema.parse(nextInput);
  if (next.type !== 'post-revision') {
    throw new ProtocolValidationError('Expected a post revision.');
  }
  if (previous.type !== 'post' && previous.type !== 'post-revision') {
    throw new ProtocolValidationError('A post revision must follow a post or post revision.');
  }
  assertSameLineage(previous, next);
  if (next.content.previous.id !== getObjectId(previous)) {
    throw new ProtocolValidationError('Post revision must reference the exact prior object ID.');
  }

  const originalId =
    previous.type === 'post' ? getObjectId(previous) : previous.content.original.id;
  const expectedRevision = previous.type === 'post' ? 2 : previous.content.revision + 1;
  if (next.content.original.id !== originalId) {
    throw new ProtocolValidationError('Post revision cannot change its original post.');
  }
  if (next.content.revision !== expectedRevision) {
    throw new ProtocolValidationError('Post revision numbers must increase by exactly one.');
  }
}

export function assertValidCommunityRuleSetTransition(
  previousInput: CommunityRuleSetPayload,
  nextInput: CommunityRuleSetPayload,
): void {
  const previous = portablePayloadSchema.parse(previousInput);
  const next = portablePayloadSchema.parse(nextInput);
  if (previous.type !== 'community-rule-set' || next.type !== 'community-rule-set') {
    throw new ProtocolValidationError('Expected community rule-set versions.');
  }
  assertSameLineage(previous, next);
  if (previous.content.community.id !== next.content.community.id) {
    throw new ProtocolValidationError('A rule-set revision cannot change communities.');
  }
  if (next.content.version !== previous.content.version + 1) {
    throw new ProtocolValidationError('Rule-set versions must increase by exactly one.');
  }
  if (next.content.previous?.id !== getObjectId(previous)) {
    throw new ProtocolValidationError('A rule-set revision must reference the exact prior object.');
  }
}

export function assertValidModerationLabelSupersession(
  previousInput: ModerationLabelPayload,
  nextInput: ModerationLabelPayload,
): void {
  const previous = portablePayloadSchema.parse(previousInput);
  const next = portablePayloadSchema.parse(nextInput);
  if (previous.type !== 'moderation-label' || next.type !== 'moderation-label') {
    throw new ProtocolValidationError('Expected moderation labels.');
  }
  assertSameLineage(previous, next);
  if (JSON.stringify(previous.content.subject) !== JSON.stringify(next.content.subject)) {
    throw new ProtocolValidationError('A moderation-label revision cannot change subjects.');
  }
  if (next.content.supersedes?.id !== getObjectId(previous)) {
    throw new ProtocolValidationError('A moderation label must supersede the exact prior label.');
  }
}

export function assertValidEntitlementRenewal(
  previousInput: SubscriptionEntitlementPayload,
  nextInput: SubscriptionEntitlementPayload,
): void {
  const previous = portablePayloadSchema.parse(previousInput);
  const next = portablePayloadSchema.parse(nextInput);
  if (previous.type !== 'subscription-entitlement' || next.type !== 'subscription-entitlement') {
    throw new ProtocolValidationError('Expected subscription entitlements.');
  }
  assertSameLineage(previous, next);
  if (
    previous.content.offering.id !== next.content.offering.id ||
    previous.content.beneficiary !== next.content.beneficiary
  ) {
    throw new ProtocolValidationError('An entitlement renewal cannot change its subject.');
  }
  if (next.content.priorEntitlement?.id !== getObjectId(previous)) {
    throw new ProtocolValidationError('A renewal must reference the exact prior entitlement.');
  }
  if (next.content.validity.startsAt < previous.content.validity.startsAt) {
    throw new ProtocolValidationError('A renewal cannot move entitlement validity backwards.');
  }
}

export function assertValidDeletionTombstone(
  targetInput: PortablePayload,
  tombstoneInput: TombstonePayload,
  options: { readonly allowAuthorizedThirdParty?: boolean } = {},
): void {
  const target = portablePayloadSchema.parse(targetInput);
  const tombstone = portablePayloadSchema.parse(tombstoneInput);
  if (tombstone.type !== 'tombstone') {
    throw new ProtocolValidationError('Expected a deletion tombstone.');
  }
  if (target.network !== tombstone.network) {
    throw new ProtocolValidationError('A tombstone cannot target an object on another network.');
  }
  if (target.author !== tombstone.author && options.allowAuthorizedThirdParty !== true) {
    throw new ProtocolValidationError(
      'A deletion tombstone must be author-signed unless external authority is explicitly supplied.',
    );
  }
  if (tombstone.createdAt <= target.createdAt) {
    throw new ProtocolValidationError('A tombstone must be created after its target.');
  }
  if (tombstone.content.target.id !== getObjectId(target)) {
    throw new ProtocolValidationError('A tombstone must reference the exact target object ID.');
  }
}

export function assertValidObjectTransition(
  previous: PortablePayload,
  next: PortablePayload,
): void {
  if (next.type === 'post-revision') {
    assertValidPostRevisionTransition(previous, next);
    return;
  }
  if (next.type === 'tombstone') {
    assertValidDeletionTombstone(previous, next);
    return;
  }
  if (previous.type === 'community-rule-set' && next.type === 'community-rule-set') {
    assertValidCommunityRuleSetTransition(previous, next);
    return;
  }
  if (previous.type === 'moderation-label' && next.type === 'moderation-label') {
    assertValidModerationLabelSupersession(previous, next);
    return;
  }
  if (previous.type === 'subscription-entitlement' && next.type === 'subscription-entitlement') {
    assertValidEntitlementRenewal(previous, next);
    return;
  }
  assertValidReplacementTransition(previous, next);
}
