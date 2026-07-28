import { ed25519 } from '@noble/curves/ed25519.js';
import { randomBytes } from '@noble/hashes/utils.js';

import { PROTOCOL_NAME, PROTOCOL_VERSION, SCHEMA_VERSION } from './constants.js';
import { encodeMultibaseBase64Url } from './encoding.js';
import {
  portablePayloadSchema,
  type AppealContent,
  type AppealPayload,
  type BlockEdgeContent,
  type BlockEdgePayload,
  type BookmarkContent,
  type BookmarkPayload,
  type CommunityContent,
  type CommunityMembershipContent,
  type CommunityMembershipPayload,
  type CommunityPayload,
  type CommunityRoleContent,
  type CommunityRolePayload,
  type CommunityRuleSetContent,
  type CommunityRuleSetPayload,
  type ContentForType,
  type CreatorOfferingContent,
  type CreatorOfferingPayload,
  type DelegationContent,
  type DelegationPayload,
  type EventContent,
  type EventPayload,
  type FollowEdgeContent,
  type FollowEdgePayload,
  type GovernanceProposalContent,
  type GovernanceProposalPayload,
  type GovernanceVoteContent,
  type GovernanceVotePayload,
  type HandleClaimContent,
  type HandleClaimPayload,
  type MediaManifestContent,
  type MediaManifestPayload,
  type ModerationLabelContent,
  type ModerationLabelPayload,
  type MutePreferenceContent,
  type MutePreferencePayload,
  type NetworkId,
  type NotificationPreferenceContent,
  type NotificationPreferencePayload,
  type PayloadForType,
  type PortablePayloadType,
  type PostContent,
  type PostPayload,
  type PostRevisionContent,
  type PostRevisionPayload,
  type ProfileContent,
  type ProfilePayload,
  type QuoteContent,
  type QuotePayload,
  type ReactionContent,
  type ReactionPayload,
  type ReplyContent,
  type ReplyPayload,
  type ReportContent,
  type ReportPayload,
  type RepostContent,
  type RepostPayload,
  type SubscriptionEntitlementContent,
  type SubscriptionEntitlementPayload,
  type TipReceiptContent,
  type TipReceiptPayload,
  type TombstoneContent,
  type TombstonePayload,
} from './schemas.js';
import { signingKeyIdFor } from './signatures.js';

export interface PayloadBuilderIdentity {
  readonly network: NetworkId;
  readonly author: string;
  readonly signingKey: string;
}

export interface PayloadBuildOptions {
  readonly createdAt?: Date;
  readonly nonce?: Uint8Array;
}

export interface Ed25519KeyPair {
  readonly privateKey: Uint8Array;
  readonly publicKey: Uint8Array;
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const privateKey = randomBytes(32);
  return {
    privateKey,
    publicKey: ed25519.getPublicKey(privateKey),
  };
}

export function createPayloadBuilderIdentity(
  network: NetworkId,
  author: string,
  publicKey: Uint8Array,
  kind: 'root' | 'delegation' = 'delegation',
): PayloadBuilderIdentity {
  return {
    network,
    author,
    signingKey: signingKeyIdFor(author, publicKey, kind),
  };
}

function commonFields(
  identity: PayloadBuilderIdentity,
  createdAt: Date,
  nonce: Uint8Array,
): {
  readonly protocol: typeof PROTOCOL_NAME;
  readonly protocolVersion: typeof PROTOCOL_VERSION;
  readonly schemaVersion: typeof SCHEMA_VERSION;
  readonly network: NetworkId;
  readonly author: string;
  readonly signingKey: string;
  readonly createdAt: string;
  readonly nonce: string;
  readonly critical: readonly [];
  readonly extensions: Readonly<Record<string, never>>;
} {
  if (nonce.byteLength !== 16) {
    throw new TypeError('Protocol nonces must contain exactly 16 bytes.');
  }
  return {
    protocol: PROTOCOL_NAME,
    protocolVersion: PROTOCOL_VERSION,
    schemaVersion: SCHEMA_VERSION,
    network: identity.network,
    author: identity.author,
    signingKey: identity.signingKey,
    createdAt: createdAt.toISOString(),
    nonce: encodeMultibaseBase64Url(nonce),
    critical: [],
    extensions: {},
  };
}

export function buildPortablePayload<Type extends PortablePayloadType>(
  identity: PayloadBuilderIdentity,
  type: Type,
  content: ContentForType<Type>,
  options: PayloadBuildOptions = {},
): PayloadForType<Type> {
  const candidate = {
    ...commonFields(identity, options.createdAt ?? new Date(), options.nonce ?? randomBytes(16)),
    type,
    content,
  };
  return portablePayloadSchema.parse(candidate) as PayloadForType<Type>;
}

export function buildPostPayload(
  identity: PayloadBuilderIdentity,
  content: PostContent,
  options: PayloadBuildOptions = {},
): PostPayload {
  return buildPortablePayload(identity, 'post', content, options);
}

export function buildProfilePayload(
  identity: PayloadBuilderIdentity,
  content: ProfileContent,
  options: PayloadBuildOptions = {},
): ProfilePayload {
  return buildPortablePayload(identity, 'profile', content, options);
}

export function buildTombstonePayload(
  identity: PayloadBuilderIdentity,
  content: TombstoneContent,
  options: PayloadBuildOptions = {},
): TombstonePayload {
  return buildPortablePayload(identity, 'tombstone', content, options);
}

export const buildDeletionTombstonePayload = buildTombstonePayload;

export function buildHandleClaimPayload(
  identity: PayloadBuilderIdentity,
  content: HandleClaimContent,
  options: PayloadBuildOptions = {},
): HandleClaimPayload {
  return buildPortablePayload(identity, 'handle-claim', content, options);
}

export function buildDelegationPayload(
  identity: PayloadBuilderIdentity,
  content: DelegationContent,
  options: PayloadBuildOptions = {},
): DelegationPayload {
  return buildPortablePayload(identity, 'delegation', content, options);
}

export function buildFollowEdgePayload(
  identity: PayloadBuilderIdentity,
  content: FollowEdgeContent,
  options: PayloadBuildOptions = {},
): FollowEdgePayload {
  return buildPortablePayload(identity, 'follow-edge', content, options);
}

export function buildBlockEdgePayload(
  identity: PayloadBuilderIdentity,
  content: BlockEdgeContent,
  options: PayloadBuildOptions = {},
): BlockEdgePayload {
  return buildPortablePayload(identity, 'block-edge', content, options);
}

export function buildMutePreferencePayload(
  identity: PayloadBuilderIdentity,
  content: MutePreferenceContent,
  options: PayloadBuildOptions = {},
): MutePreferencePayload {
  return buildPortablePayload(identity, 'mute-preference', content, options);
}

export function buildPostRevisionPayload(
  identity: PayloadBuilderIdentity,
  content: PostRevisionContent,
  options: PayloadBuildOptions = {},
): PostRevisionPayload {
  return buildPortablePayload(identity, 'post-revision', content, options);
}

export function buildReplyPayload(
  identity: PayloadBuilderIdentity,
  content: ReplyContent,
  options: PayloadBuildOptions = {},
): ReplyPayload {
  return buildPortablePayload(identity, 'reply', content, options);
}

export function buildQuotePayload(
  identity: PayloadBuilderIdentity,
  content: QuoteContent,
  options: PayloadBuildOptions = {},
): QuotePayload {
  return buildPortablePayload(identity, 'quote', content, options);
}

export function buildRepostPayload(
  identity: PayloadBuilderIdentity,
  content: RepostContent,
  options: PayloadBuildOptions = {},
): RepostPayload {
  return buildPortablePayload(identity, 'repost', content, options);
}

export function buildReactionPayload(
  identity: PayloadBuilderIdentity,
  content: ReactionContent,
  options: PayloadBuildOptions = {},
): ReactionPayload {
  return buildPortablePayload(identity, 'reaction', content, options);
}

export function buildBookmarkPayload(
  identity: PayloadBuilderIdentity,
  content: BookmarkContent,
  options: PayloadBuildOptions = {},
): BookmarkPayload {
  return buildPortablePayload(identity, 'bookmark', content, options);
}

export function buildMediaManifestPayload(
  identity: PayloadBuilderIdentity,
  content: MediaManifestContent,
  options: PayloadBuildOptions = {},
): MediaManifestPayload {
  return buildPortablePayload(identity, 'media-manifest', content, options);
}

export function buildCommunityPayload(
  identity: PayloadBuilderIdentity,
  content: CommunityContent,
  options: PayloadBuildOptions = {},
): CommunityPayload {
  return buildPortablePayload(identity, 'community', content, options);
}

export function buildCommunityMembershipPayload(
  identity: PayloadBuilderIdentity,
  content: CommunityMembershipContent,
  options: PayloadBuildOptions = {},
): CommunityMembershipPayload {
  return buildPortablePayload(identity, 'community-membership', content, options);
}

export function buildCommunityRolePayload(
  identity: PayloadBuilderIdentity,
  content: CommunityRoleContent,
  options: PayloadBuildOptions = {},
): CommunityRolePayload {
  return buildPortablePayload(identity, 'community-role', content, options);
}

export function buildCommunityRuleSetPayload(
  identity: PayloadBuilderIdentity,
  content: CommunityRuleSetContent,
  options: PayloadBuildOptions = {},
): CommunityRuleSetPayload {
  return buildPortablePayload(identity, 'community-rule-set', content, options);
}

export function buildModerationLabelPayload(
  identity: PayloadBuilderIdentity,
  content: ModerationLabelContent,
  options: PayloadBuildOptions = {},
): ModerationLabelPayload {
  return buildPortablePayload(identity, 'moderation-label', content, options);
}

export function buildReportPayload(
  identity: PayloadBuilderIdentity,
  content: ReportContent,
  options: PayloadBuildOptions = {},
): ReportPayload {
  return buildPortablePayload(identity, 'report', content, options);
}

export function buildAppealPayload(
  identity: PayloadBuilderIdentity,
  content: AppealContent,
  options: PayloadBuildOptions = {},
): AppealPayload {
  return buildPortablePayload(identity, 'appeal', content, options);
}

export function buildGovernanceProposalPayload(
  identity: PayloadBuilderIdentity,
  content: GovernanceProposalContent,
  options: PayloadBuildOptions = {},
): GovernanceProposalPayload {
  return buildPortablePayload(identity, 'governance-proposal', content, options);
}

export function buildGovernanceVotePayload(
  identity: PayloadBuilderIdentity,
  content: GovernanceVoteContent,
  options: PayloadBuildOptions = {},
): GovernanceVotePayload {
  return buildPortablePayload(identity, 'governance-vote', content, options);
}

export function buildCreatorOfferingPayload(
  identity: PayloadBuilderIdentity,
  content: CreatorOfferingContent,
  options: PayloadBuildOptions = {},
): CreatorOfferingPayload {
  return buildPortablePayload(identity, 'creator-offering', content, options);
}

export function buildSubscriptionEntitlementPayload(
  identity: PayloadBuilderIdentity,
  content: SubscriptionEntitlementContent,
  options: PayloadBuildOptions = {},
): SubscriptionEntitlementPayload {
  return buildPortablePayload(identity, 'subscription-entitlement', content, options);
}

export function buildTipReceiptPayload(
  identity: PayloadBuilderIdentity,
  content: TipReceiptContent,
  options: PayloadBuildOptions = {},
): TipReceiptPayload {
  return buildPortablePayload(identity, 'tip-receipt', content, options);
}

export function buildEventPayload(
  identity: PayloadBuilderIdentity,
  content: EventContent,
  options: PayloadBuildOptions = {},
): EventPayload {
  return buildPortablePayload(identity, 'event', content, options);
}

export function buildNotificationPreferencePayload(
  identity: PayloadBuilderIdentity,
  content: NotificationPreferenceContent,
  options: PayloadBuildOptions = {},
): NotificationPreferencePayload {
  return buildPortablePayload(identity, 'notification-preference', content, options);
}
