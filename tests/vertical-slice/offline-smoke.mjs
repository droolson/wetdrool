import { strict as assert } from 'node:assert';

import {
  buildPostPayload,
  buildProfilePayload,
  canonicalizeEnvelope,
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
const networkId = `woke:v1:${programId}:${programId}`;
const identityId = `swid:v1:${networkId}:${authority.publicKey.toBase58()}`;
const builder = createPayloadBuilderIdentity(
  networkId,
  identityId,
  authority.publicKey.toBytes(),
  'root',
);
const privateKey = authority.secretKey.subarray(0, 32);

for (const payload of [
  buildProfilePayload(
    builder,
    {
      displayName: 'Offline smoke',
      bio: '',
      pronouns: [],
      genderVisibility: 'private',
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
]) {
  const envelope = signPayload(payload, privateKey);
  const bytes = canonicalizeEnvelope(envelope);
  assert.deepEqual(decodeCanonicalEnvelope(bytes), envelope);
}

process.stdout.write('Vertical-slice Anchor/protocol fixture construction smoke passed.\n');
