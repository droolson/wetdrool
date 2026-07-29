import { ed25519 } from '@noble/curves/ed25519.js';
import bs58 from 'bs58';

import {
  buildAppealPayload,
  buildBlockEdgePayload,
  buildBookmarkPayload,
  buildCommunityMembershipPayload,
  buildCommunityPayload,
  buildCommunityRolePayload,
  buildCommunityRuleSetPayload,
  buildCreatorOfferingPayload,
  buildDelegationPayload,
  buildEventPayload,
  buildFollowEdgePayload,
  buildGovernanceProposalPayload,
  buildGovernanceVotePayload,
  buildHandleClaimPayload,
  buildMediaManifestPayload,
  buildModerationLabelPayload,
  buildMutePreferencePayload,
  buildNotificationPreferencePayload,
  buildPostPayload,
  buildPostRevisionPayload,
  buildProfilePayload,
  buildQuotePayload,
  buildReactionPayload,
  buildReplyPayload,
  buildReportPayload,
  buildRepostPayload,
  buildSubscriptionEntitlementPayload,
  buildTipReceiptPayload,
  buildTombstonePayload,
  createPayloadBuilderIdentity,
  signingKeyIdFor,
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  type EncryptedContentReference,
  type MediaReference,
  type ObjectReference,
  type PortablePayload,
  type PortablePayloadType,
} from '../src/index.js';
import { author, identity, network, postContent, publicKey } from './fixtures.js';

export const fixedCreatedAt = new Date('2026-07-28T12:00:00.000Z');
export const fixedNonce = Uint8Array.from({ length: 16 }, (_, index) => index);
export const fixedOptions = { createdAt: fixedCreatedAt, nonce: fixedNonce };
export const rootIdentity = createPayloadBuilderIdentity(network, author, publicKey, 'root');

const otherIdentityPda = bs58.encode(Uint8Array.from({ length: 32 }, () => 10));
export const otherIdentity = `wokesocialid:v1:${network}:${otherIdentityPda}`;
export const communityAddress = bs58.encode(Uint8Array.from({ length: 32 }, () => 11));
const delegatedPrivateKey = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
const delegatedPublicKey = ed25519.getPublicKey(delegatedPrivateKey);

const fakeDigest = `u${'A'.repeat(43)}`;
const fixtureCids = {
  a: 'bafkreigks6arfsq3xxfpvqrrwonchxcnu6do76auprhhfomao6c273sixm',
  c: 'bafkreibopuwahkkqplrgl3hvwu2wrbnfgoj2eau5eqjzjglsmwq2ewxpyy',
  d: 'bafkreiazadvlnqbija6xcjszt3tpkdpa2j4qpnogl6uqkjcybnfq7gcswa',
  e: 'bafkreidsemiehpaya7tpoqfsgxvxkepmwmzfljvdovbvmmiznxuks5injm',
} as const;
const fakeCid = (character: keyof typeof fixtureCids) => fixtureCids[character];
export const objectReference = (type: PortablePayloadType): ObjectReference => ({
  id: `wokesocialobj:v1:${type}:${fakeDigest}`,
});

export const encryptedContentReference: EncryptedContentReference = {
  cid: fakeCid('a'),
  digest: fakeDigest,
  bytes: 128,
  mediaType: 'application/octet-stream',
  protection: {
    kind: 'encrypted',
    encryptionFormat: 'wokesocial-sealed-body-v1',
    keyEnvelope: objectReference('media-manifest'),
    accessPolicy: objectReference('community-rule-set'),
  },
};

const imageReference = (cid: string): MediaReference => ({
  cid,
  digest: fakeDigest,
  bytes: 1_024,
  mediaType: 'image/webp',
  altText: 'Two friends smiling at an outdoor community gathering.',
  width: 1_024,
  height: 768,
});

export function createValidPayloads(): readonly PortablePayload[] {
  return [
    buildProfilePayload(
      identity,
      {
        displayName: 'River',
        bio: 'Building humane social infrastructure.',
        pronouns: [
          { visibility: 'public', value: 'they/them' },
          { visibility: 'private', valueReference: encryptedContentReference },
        ],
        gender: { visibility: 'followers', valueReference: encryptedContentReference },
        chosenFamilyLabels: [{ visibility: 'public', value: 'chosen sibling' }],
        location: { visibility: 'private', valueReference: encryptedContentReference },
        links: [],
      },
      fixedOptions,
    ),
    buildPostPayload(identity, postContent, fixedOptions),
    buildTombstonePayload(
      identity,
      {
        target: objectReference('post'),
        reason: 'author-deleted',
      },
      fixedOptions,
    ),
    buildHandleClaimPayload(
      identity,
      {
        namespace: { kind: 'global' },
        handle: 'river',
        state: 'claimed',
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildDelegationPayload(
      rootIdentity,
      {
        delegateKey: signingKeyIdFor(author, delegatedPublicKey, 'delegation'),
        scopes: ['content.publish', 'social.follow'],
        validity: {
          startsAt: '2026-07-28T12:00:00.000Z',
          endsAt: '2026-08-28T12:00:00.000Z',
        },
        rootRotation: 0,
        deviceLabel: 'Test device',
      },
      fixedOptions,
    ),
    buildFollowEdgePayload(
      identity,
      {
        target: otherIdentity,
        state: 'active',
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildBlockEdgePayload(
      identity,
      {
        target: otherIdentity,
        state: 'active',
        scope: 'all',
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildMutePreferencePayload(
      identity,
      {
        target: { kind: 'keyword', keyword: 'spoilers', language: 'en' },
        state: 'active',
        replacement: { sequence: 1 },
        confidentiality: 'private',
      },
      fixedOptions,
    ),
    buildPostRevisionPayload(
      identity,
      {
        original: objectReference('post'),
        previous: objectReference('post'),
        revision: 2,
        content: { ...postContent, body: 'A corrected, still humane post.' },
        changeSummary: 'Fixed wording.',
      },
      fixedOptions,
    ),
    buildReplyPayload(
      identity,
      {
        ...postContent,
        body: 'Thank you for sharing this.',
        replyTo: objectReference('post'),
      },
      fixedOptions,
    ),
    buildQuotePayload(
      identity,
      {
        ...postContent,
        body: 'This is worth reading.',
        quoteOf: objectReference('post'),
      },
      fixedOptions,
    ),
    buildRepostPayload(
      identity,
      {
        target: objectReference('post'),
        visibility: { kind: 'public' },
        authorLabels: [],
      },
      fixedOptions,
    ),
    buildReactionPayload(
      identity,
      {
        target: objectReference('post'),
        reaction: { kind: 'named', value: 'support' },
        state: 'active',
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildBookmarkPayload(
      identity,
      {
        target: objectReference('post'),
        state: 'active',
        collection: 'Read later',
        replacement: { sequence: 1 },
        confidentiality: 'private',
        storage: 'private-client',
      },
      fixedOptions,
    ),
    buildMediaManifestPayload(
      identity,
      {
        original: imageReference(fakeCid('a')),
        variants: [
          {
            purpose: 'thumbnail',
            reference: imageReference(fakeCid('c')),
          },
        ],
        captions: [],
        metadataStripped: true,
        malwareScan: { status: 'passed' },
      },
      fixedOptions,
    ),
    buildCommunityPayload(
      rootIdentity,
      {
        slug: 'kind-tech',
        name: 'Kind Technology',
        description: 'A community for humane technology.',
        visibility: 'public',
        membershipPolicy: 'open',
        governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
        federationPolicy: {
          mode: 'open',
          allow: [],
          block: [{ network, community: objectReference('community') }],
        },
        treasury: {
          account: network.split(':')[2] ?? '',
          policy: objectReference('community-rule-set'),
          assetAllowList: ['SOL'],
        },
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildCommunityMembershipPayload(
      identity,
      {
        communityAddress,
        member: author,
        action: 'join',
        state: 'active',
        roles: ['member'],
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildCommunityRolePayload(
      identity,
      {
        community: objectReference('community'),
        name: 'moderator',
        displayName: 'Moderator',
        description: 'Can label and review community content.',
        permissions: ['community.moderate'],
        assignmentPolicy: 'governance',
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildCommunityRuleSetPayload(
      identity,
      {
        community: objectReference('community'),
        version: 1,
        rules: [
          {
            id: 'respect',
            title: 'Respect people',
            description: 'No targeted harassment or dehumanization.',
            severity: 'removal',
            appealable: true,
          },
        ],
        moderationProviders: [author],
        appealWindowHours: 168,
      },
      fixedOptions,
    ),
    buildModerationLabelPayload(
      identity,
      {
        subject: { kind: 'object', object: objectReference('post') },
        code: 'community.cw',
        severity: 'notice',
        recommendation: 'blur',
        rationale: 'Author-declared sensitive imagery.',
        policy: objectReference('community-rule-set'),
        source: 'human',
      },
      fixedOptions,
    ),
    buildReportPayload(
      identity,
      {
        subject: { kind: 'object', object: objectReference('post') },
        category: 'other',
        summary: 'Please review this against the linked community rules.',
        evidence: [encryptedContentReference],
        preserveEvidence: true,
        requestedOutcome: 'review',
        confidentiality: 'restricted',
      },
      fixedOptions,
    ),
    buildAppealPayload(
      identity,
      {
        decision: objectReference('moderation-label'),
        statement: 'The label appears to rely on the wrong rule.',
        evidence: [encryptedContentReference],
        requestedOutcome: 'remove-label',
        confidentiality: 'restricted',
      },
      fixedOptions,
    ),
    buildGovernanceProposalPayload(
      identity,
      {
        community: objectReference('community'),
        proposalNumber: 1,
        title: 'Adopt the first community rules',
        summary: 'Ratify a portable, appealable community rule set.',
        actions: [
          {
            kind: 'adopt-rule-set',
            ruleSet: objectReference('community-rule-set'),
          },
        ],
        votingStartsAt: '2026-07-28T12:00:00.000Z',
        votingEndsAt: '2026-08-04T12:00:00.000Z',
        executionEndsAt: '2026-08-11T12:00:00.000Z',
        choices: ['approve', 'reject'],
        quorum: { kind: 'members', minimum: '10' },
      },
      fixedOptions,
    ),
    buildGovernanceVotePayload(
      identity,
      {
        proposal: objectReference('governance-proposal'),
        choice: 'approve',
        claimedWeight: '1',
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildCreatorOfferingPayload(
      identity,
      {
        offeringKind: 'subscription',
        title: 'Supporter membership',
        description: 'Optional monthly support.',
        price: { asset: { kind: 'sol' }, amount: '10000000' },
        billing: { kind: 'recurring', interval: 'month' },
        recipientSplits: [{ recipient: author, basisPoints: 10_000 }],
        benefits: ['Supporter badge'],
        availability: { startsAt: '2026-07-28T12:00:00.000Z' },
        refundPolicy: {
          kind: 'creator-reviewed',
          summary: 'Contact the creator for a case-by-case refund.',
        },
        state: 'active',
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildSubscriptionEntitlementPayload(
      identity,
      {
        offering: objectReference('creator-offering'),
        beneficiary: otherIdentity,
        payment: {
          transactionSignature: '1'.repeat(64),
          finalizedSlot: '123456',
          asset: { kind: 'sol' },
          amount: '10000000',
        },
        validity: {
          startsAt: '2026-07-28T12:00:00.000Z',
          endsAt: '2026-08-28T12:00:00.000Z',
        },
        state: 'active',
      },
      fixedOptions,
    ),
    buildTipReceiptPayload(
      identity,
      {
        payer: author,
        recipient: otherIdentity,
        payment: {
          transactionSignature: bs58.encode(Uint8Array.from({ length: 64 }, () => 2)),
          finalizedSlot: '123457',
          asset: { kind: 'sol' },
          amount: '1000000',
        },
        recipientSplits: [{ recipient: otherIdentity, basisPoints: 10_000 }],
        paymentIntent: fakeDigest,
        memo: 'Thank you.',
      },
      fixedOptions,
    ),
    buildEventPayload(
      identity,
      {
        title: 'Community protocol workshop',
        description: 'Learn how to verify portable community objects.',
        hosts: [author],
        startsAt: '2026-08-10T16:00:00.000Z',
        endsAt: '2026-08-10T17:30:00.000Z',
        location: { kind: 'virtual', url: 'https://example.com/events/protocol-workshop' },
        visibility: { kind: 'public' },
        state: 'scheduled',
        replacement: { sequence: 1 },
      },
      fixedOptions,
    ),
    buildNotificationPreferencePayload(
      identity,
      {
        replacement: { sequence: 1 },
        rules: [
          {
            category: 'mentions',
            enabled: true,
            channels: ['in-app', 'push'],
          },
        ],
        sensitivePreview: 'hide',
        confidentiality: 'private',
      },
      fixedOptions,
    ),
  ];
}
