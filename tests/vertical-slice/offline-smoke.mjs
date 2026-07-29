import { strict as assert } from 'node:assert';

import {
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  buildCommunityMembershipPayload,
  buildCommunityPayload,
  buildPostPayload,
  buildProfilePayload,
  canonicalizeEnvelope,
  communityGovernanceStrategyCommitment,
  createPayloadBuilderIdentity,
  decodeCanonicalEnvelope,
  signPayload,
} from '../../packages/protocol/dist/src/index.js';
import {
  deterministicNonce,
  deterministicTestKeypair,
  textPostContent,
} from './fixture-helpers.mjs';

const programId = '9kFGJEzA7uKvJ1wTvKRWoFadRU7WFnpwWEGP6APro3dD';
const authority = deterministicTestKeypair(41);
const networkId = `wokenet:v1:${programId}:${programId}`;
const identityId = `wokesocialid:v1:${networkId}:${authority.publicKey.toBase58()}`;
const builder = createPayloadBuilderIdentity(
  networkId,
  identityId,
  authority.publicKey.toBytes(),
  'root',
);
const privateKey = authority.secretKey.subarray(0, 32);
const communityPayload = buildCommunityPayload(
  builder,
  {
    slug: 'offline-smoke',
    name: 'Offline Smoke',
    description: 'Signed community construction without a validator.',
    visibility: 'public',
    membershipPolicy: 'open',
    governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
    federationPolicy: { mode: 'open', allow: [], block: [] },
    replacement: { sequence: 1 },
  },
  {
    createdAt: new Date('2026-07-28T14:02:00.000Z'),
    nonce: deterministicNonce(3),
  },
);
const communityGovernance = communityGovernanceStrategyCommitment(communityPayload.content);
assert.equal(communityGovernance.governanceVersion, 1);
assert.equal(communityGovernance.bytes.byteLength, 32);
const membershipPayload = buildCommunityMembershipPayload(
  builder,
  {
    action: 'join',
    communityAddress: deterministicTestKeypair(73).publicKey.toBase58(),
    member: identityId,
    replacement: { sequence: 1 },
    roles: ['member'],
    state: 'active',
  },
  {
    createdAt: new Date('2026-07-28T14:03:00.000Z'),
    nonce: deterministicNonce(4),
  },
);

for (const payload of [
  buildProfilePayload(
    builder,
    {
      displayName: 'Offline smoke',
      bio: '',
      pronouns: [],
      chosenFamilyLabels: [],
      links: [],
    },
    {
      createdAt: new Date('2026-07-28T14:00:00.000Z'),
      nonce: deterministicNonce(1),
    },
  ),
  buildPostPayload(builder, textPostContent('Offline signed fixture smoke.'), {
    createdAt: new Date('2026-07-28T14:01:00.000Z'),
    nonce: deterministicNonce(2),
  }),
  communityPayload,
  membershipPayload,
]) {
  const envelope = signPayload(payload, privateKey);
  const bytes = canonicalizeEnvelope(envelope);
  assert.deepEqual(decodeCanonicalEnvelope(bytes), envelope);
}

process.stdout.write('Vertical-slice Anchor/protocol fixture construction smoke passed.\n');
