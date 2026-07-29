import { strict as assert } from 'node:assert';
import { readFile, writeFile } from 'node:fs/promises';

import anchor from '@coral-xyz/anchor';
import {
  WOKENET_ONE_MEMBER_ONE_VOTE_V1,
  buildCommunityMembershipPayload,
  buildCommunityPayload,
  PROFILE_SCHEMA_VERSION,
  buildPostPayload,
  buildProfilePayload,
  canonicalizeEnvelope,
  communityGovernanceStrategyCommitment,
  createPayloadBuilderIdentity,
  decodeMultibaseBase64Url,
  getObjectId,
  signPayload,
} from '../../packages/protocol/dist/src/index.js';
import { LocalContentAddressedStorage } from '../../packages/storage/dist/src/index.js';
import {
  deterministicNonce as nonce,
  deterministicTestKeypair,
  textPostContent as postContent,
} from './fixture-helpers.mjs';

const { BN, web3 } = anchor;
const { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } = web3;
const PROGRAM_ID = required('PROGRAM_ID');
const RPC_URL = localUrl(required('SOLANA_RPC_URL'), 'http:');
const WS_URL = localUrl(required('SOLANA_WS_URL'), 'ws:');
const CONTENT_STORAGE_PATH = required('CONTENT_STORAGE_PATH');
const METADATA_PATH = required('VERTICAL_SLICE_METADATA_PATH');
const DEPLOYER_KEYPAIR_PATH = required('DEPLOYER_KEYPAIR_PATH');

const PDA_PREFIX = Buffer.from('wokesocial');
const PDA_VERSION = Buffer.from([1]);
const CONFIG_SEED = Buffer.from('config');
const IDENTITY_SEED = Buffer.from('identity');
const POST_SEED = Buffer.from('post');
const COMMUNITY_SEED = Buffer.from('community');
const MEMBERSHIP_SEED = Buffer.from('membership');
const FOLLOW_SEED = Buffer.from('follow');
const TOMBSTONE_SEED = Buffer.from('tombstone');
const AUTHOR_DISPLAY_NAME = 'Avery Sol';
const COMMUNITY_NAME = 'Kind Technology';
const COMMUNITY_SLUG = 'kind-technology';
const POST_BODY =
  'A real signed post crossed WokeNet localnet, canonical storage, replay, and this production feed.';
const TOMBSTONED_POST_BODY = 'This validator post must be suppressed by its on-chain tombstone.';

const idl = JSON.parse(
  await readFile(new URL('../../target/idl/social_protocol.json', import.meta.url), 'utf8'),
);
assert.equal(idl.address, PROGRAM_ID, 'fresh IDL program address');

const deployer = Keypair.fromSecretKey(
  Uint8Array.from(JSON.parse(await readFile(DEPLOYER_KEYPAIR_PATH, 'utf8'))),
);
const authorAuthority = deterministicTestKeypair(41);
const viewerAuthority = deterministicTestKeypair(113);
const connection = new Connection(RPC_URL.toString(), {
  commitment: 'confirmed',
  wsEndpoint: WS_URL.toString(),
});
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(deployer), {
  commitment: 'confirmed',
  preflightCommitment: 'confirmed',
  skipPreflight: false,
});
anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);
assert.equal(program.programId.toBase58(), PROGRAM_ID, 'Anchor program address');

const genesisHash = await connection.getGenesisHash();
const networkId = `wokenet:v1:${genesisHash}:${PROGRAM_ID}`;
const config = PublicKey.findProgramAddressSync(
  [PDA_PREFIX, PDA_VERSION, CONFIG_SEED],
  program.programId,
)[0];
const authorNonce = nonce(17);
const viewerNonce = nonce(71);
const postNonce = nonce(127);
const tombstonedPostNonce = nonce(181);
const communityNonce = nonce(211);
const authorIdentity = identityAddress(program.programId, authorAuthority.publicKey, authorNonce);
const viewerIdentity = identityAddress(program.programId, viewerAuthority.publicKey, viewerNonce);
const postReference = postAddress(program.programId, authorIdentity, postNonce);
const tombstonedPostReference = postAddress(program.programId, authorIdentity, tombstonedPostNonce);
const communityReference = communityAddress(program.programId, authorIdentity, communityNonce);
const membershipReference = communityMembershipAddress(
  program.programId,
  communityReference,
  viewerIdentity,
);
const followEdge = PublicKey.findProgramAddressSync(
  [PDA_PREFIX, PDA_VERSION, FOLLOW_SEED, viewerIdentity.toBuffer(), authorIdentity.toBuffer()],
  program.programId,
)[0];
const tombstone = PublicKey.findProgramAddressSync(
  [
    PDA_PREFIX,
    PDA_VERSION,
    TOMBSTONE_SEED,
    authorIdentity.toBuffer(),
    tombstonedPostReference.toBuffer(),
  ],
  program.programId,
)[0];

const authorIdentityId = `wokesocialid:v1:${networkId}:${authorIdentity.toBase58()}`;
const viewerIdentityId = `wokesocialid:v1:${networkId}:${viewerIdentity.toBase58()}`;
const authorBuilder = createPayloadBuilderIdentity(
  networkId,
  authorIdentityId,
  authorAuthority.publicKey.toBytes(),
  'root',
);
const viewerBuilder = createPayloadBuilderIdentity(
  networkId,
  viewerIdentityId,
  viewerAuthority.publicKey.toBytes(),
  'root',
);
const storage = new LocalContentAddressedStorage({
  rootDirectory: CONTENT_STORAGE_PATH,
});
const profile = await publishEnvelope(
  storage,
  signPayload(
    buildProfilePayload(
      authorBuilder,
      {
        displayName: AUTHOR_DISPLAY_NAME,
        bio: 'Building a joyful, user-owned social web.',
        pronouns: [{ visibility: 'public', value: 'they/them' }],
        chosenFamilyLabels: [],
        links: [],
      },
      {
        createdAt: new Date('2026-07-28T14:00:00.000Z'),
        nonce: nonce(23),
      },
    ),
    authorAuthority.secretKey.subarray(0, 32),
  ),
);
const post = await publishEnvelope(
  storage,
  signPayload(
    buildPostPayload(authorBuilder, postContent(POST_BODY), {
      createdAt: new Date('2026-07-28T14:01:00.000Z'),
      nonce: nonce(29),
    }),
    authorAuthority.secretKey.subarray(0, 32),
  ),
);
const tombstonedPost = await publishEnvelope(
  storage,
  signPayload(
    buildPostPayload(authorBuilder, postContent(TOMBSTONED_POST_BODY), {
      createdAt: new Date('2026-07-28T14:02:00.000Z'),
      nonce: nonce(31),
    }),
    authorAuthority.secretKey.subarray(0, 32),
  ),
);
const community = await publishEnvelope(
  storage,
  signPayload(
    buildCommunityPayload(
      authorBuilder,
      {
        slug: COMMUNITY_SLUG,
        name: COMMUNITY_NAME,
        description: 'A public community for building humane technology together.',
        visibility: 'public',
        membershipPolicy: 'open',
        governance: WOKENET_ONE_MEMBER_ONE_VOTE_V1,
        federationPolicy: {
          mode: 'open',
          allow: [],
          block: [],
        },
        replacement: { sequence: 1 },
      },
      {
        createdAt: new Date('2026-07-28T14:03:00.000Z'),
        nonce: communityNonce,
      },
    ),
    authorAuthority.secretKey.subarray(0, 32),
  ),
);
const communityGovernance = communityGovernanceStrategyCommitment(
  community.envelope.payload.content,
);
const membership = await publishEnvelope(
  storage,
  signPayload(
    buildCommunityMembershipPayload(
      viewerBuilder,
      {
        action: 'join',
        communityAddress: communityReference.toBase58(),
        member: viewerIdentityId,
        replacement: { sequence: 1 },
        roles: ['member'],
        state: 'active',
      },
      {
        createdAt: new Date('2026-07-28T14:04:00.000Z'),
        nonce: nonce(223),
      },
    ),
    viewerAuthority.secretKey.subarray(0, 32),
  ),
);

const transactionSignatures = [];
const latestBlockhash = await waitForTransactionReadiness(connection, deployer.publicKey);
const fundingTransaction = new Transaction({
  feePayer: deployer.publicKey,
  blockhash: latestBlockhash.blockhash,
  lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
}).add(
  SystemProgram.transfer({
    fromPubkey: deployer.publicKey,
    toPubkey: authorAuthority.publicKey,
    lamports: LAMPORTS_PER_SOL,
  }),
  SystemProgram.transfer({
    fromPubkey: deployer.publicKey,
    toPubkey: viewerAuthority.publicKey,
    lamports: LAMPORTS_PER_SOL,
  }),
);
fundingTransaction.sign(deployer);
transactionSignatures.push(
  await connection.sendRawTransaction(fundingTransaction.serialize(), {
    maxRetries: 5,
    preflightCommitment: 'confirmed',
    skipPreflight: false,
  }),
);
await waitForCommitment(connection, transactionSignatures, 'confirmed', 30_000);

transactionSignatures.push(
  await program.methods
    .initializeProtocol()
    .accountsStrict({
      payer: deployer.publicKey,
      config,
      systemProgram: SystemProgram.programId,
    })
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .createIdentity({ identityNonce: authorNonce })
    .accountsStrict({
      config,
      identity: authorIdentity,
      rootAuthority: authorAuthority.publicKey,
      payer: deployer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authorAuthority])
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .createIdentity({ identityNonce: viewerNonce })
    .accountsStrict({
      config,
      identity: viewerIdentity,
      rootAuthority: viewerAuthority.publicKey,
      payer: deployer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([viewerAuthority])
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .updateProfile({
      expectedSequence: new BN(0),
      profileSchemaVersion: PROFILE_SCHEMA_VERSION,
      manifestHash: digestBytes(profile.envelope.proof.payloadHash),
      manifestUri: `ipfs://${profile.cid}`,
    })
    .accountsStrict({
      config,
      identity: authorIdentity,
      rootAuthority: authorAuthority.publicKey,
    })
    .signers([authorAuthority])
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .publishPost({
      expectedAuthorSequence: new BN(1),
      postNonce,
      manifestHash: digestBytes(post.envelope.proof.payloadHash),
      manifestUri: `ipfs://${post.cid}`,
    })
    .accountsStrict({
      config,
      authorIdentity,
      postReference,
      rootAuthority: authorAuthority.publicKey,
      payer: deployer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authorAuthority])
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .follow({ expectedFollowerSequence: new BN(0) })
    .accountsStrict({
      config,
      followerIdentity: viewerIdentity,
      subjectIdentity: authorIdentity,
      followEdge,
      rootAuthority: viewerAuthority.publicKey,
      payer: deployer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([viewerAuthority])
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .publishPost({
      expectedAuthorSequence: new BN(2),
      postNonce: tombstonedPostNonce,
      manifestHash: digestBytes(tombstonedPost.envelope.proof.payloadHash),
      manifestUri: `ipfs://${tombstonedPost.cid}`,
    })
    .accountsStrict({
      config,
      authorIdentity,
      postReference: tombstonedPostReference,
      rootAuthority: authorAuthority.publicKey,
      payer: deployer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authorAuthority])
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .tombstonePost({
      expectedAuthorSequence: new BN(3),
      targetHash: digestBytes(tombstonedPost.envelope.proof.payloadHash),
      reason: { userRequest: {} },
    })
    .accountsStrict({
      config,
      authorIdentity,
      postReference: tombstonedPostReference,
      tombstone,
      rootAuthority: authorAuthority.publicKey,
      payer: deployer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authorAuthority])
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .createCommunity({
      expectedCreatorSequence: new BN(4),
      communityNonce,
      manifestHash: digestBytes(community.envelope.proof.payloadHash),
      manifestUri: `ipfs://${community.cid}`,
      governanceVersion: communityGovernance.governanceVersion,
      governanceStrategyHash: Array.from(communityGovernance.bytes),
      visibility: { public: {} },
      membershipPolicy: { open: {} },
    })
    .accountsStrict({
      config,
      creatorIdentity: authorIdentity,
      community: communityReference,
      rootAuthority: authorAuthority.publicKey,
      payer: deployer.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authorAuthority])
    .rpc(),
);
transactionSignatures.push(
  await program.methods
    .joinCommunity({
      expectedMemberSequence: new BN(1),
      expectedStateSequence: new BN(0),
      expectedMembershipPolicySequence: new BN(1),
      expectedCommunityMembershipSequence: new BN(0),
      manifestHash: digestBytes(membership.envelope.proof.payloadHash),
      manifestUri: `ipfs://${membership.cid}`,
    })
    .accountsStrict({
      config,
      community: communityReference,
      memberIdentity: viewerIdentity,
      membership: membershipReference,
      authority: viewerAuthority.publicKey,
      payer: deployer.publicKey,
      systemProgram: SystemProgram.programId,
      delegation: null,
    })
    .signers([viewerAuthority])
    .rpc(),
);

await waitForCommitment(connection, transactionSignatures, 'finalized', 90_000);
const [authorBalance, viewerBalance] = await Promise.all([
  connection.getBalance(authorAuthority.publicKey, 'finalized'),
  connection.getBalance(viewerAuthority.publicKey, 'finalized'),
]);
assert.ok(authorBalance >= LAMPORTS_PER_SOL, 'deterministic author authority is funded');
assert.ok(viewerBalance >= LAMPORTS_PER_SOL, 'deterministic viewer authority is funded');

await writeFile(
  METADATA_PATH,
  `${JSON.stringify(
    {
      authorDisplayName: AUTHOR_DISPLAY_NAME,
      authorAuthority: authorAuthority.publicKey.toBase58(),
      authorIdentityId,
      authorIdentityAddress: authorIdentity.toBase58(),
      communityAddress: communityReference.toBase58(),
      communityCid: community.cid,
      communityGovernanceDigest: communityGovernance.digest,
      communityName: COMMUNITY_NAME,
      communityObjectId: community.objectId,
      communityPayloadHash: community.envelope.proof.payloadHash,
      communitySlug: COMMUNITY_SLUG,
      followEdge: followEdge.toBase58(),
      membershipAddress: membershipReference.toBase58(),
      membershipCid: membership.cid,
      membershipObjectId: membership.objectId,
      membershipPayloadHash: membership.envelope.proof.payloadHash,
      networkId,
      postBody: POST_BODY,
      postCid: post.cid,
      postObjectId: post.objectId,
      postPayloadHash: post.envelope.proof.payloadHash,
      postReference: postReference.toBase58(),
      profileCid: profile.cid,
      profileObjectId: profile.objectId,
      profilePayloadHash: profile.envelope.proof.payloadHash,
      programId: PROGRAM_ID,
      tombstonedPostBody: TOMBSTONED_POST_BODY,
      tombstonedPostCid: tombstonedPost.cid,
      tombstonedPostObjectId: tombstonedPost.objectId,
      tombstonedPostReference: tombstonedPostReference.toBase58(),
      transactionSignatures,
      viewerIdentityId,
      viewerIdentityAddress: viewerIdentity.toBase58(),
    },
    null,
    2,
  )}\n`,
  { mode: 0o600 },
);
process.stdout.write(
  `Published ${post.objectId} and finalized ${transactionSignatures.length} local transactions.\n`,
);

function identityAddress(programId, authority, identityNonce) {
  return PublicKey.findProgramAddressSync(
    [PDA_PREFIX, PDA_VERSION, IDENTITY_SEED, authority.toBuffer(), Buffer.from(identityNonce)],
    programId,
  )[0];
}

function postAddress(programId, authorIdentity, postNonce) {
  return PublicKey.findProgramAddressSync(
    [PDA_PREFIX, PDA_VERSION, POST_SEED, authorIdentity.toBuffer(), Buffer.from(postNonce)],
    programId,
  )[0];
}

function communityAddress(programId, creatorIdentity, communityNonce) {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      COMMUNITY_SEED,
      creatorIdentity.toBuffer(),
      Buffer.from(communityNonce),
    ],
    programId,
  )[0];
}

function communityMembershipAddress(programId, community, memberIdentity) {
  return PublicKey.findProgramAddressSync(
    [PDA_PREFIX, PDA_VERSION, MEMBERSHIP_SEED, community.toBuffer(), memberIdentity.toBuffer()],
    programId,
  )[0];
}

async function publishEnvelope(storage, envelope) {
  const canonicalBytes = canonicalizeEnvelope(envelope);
  const receipt = await storage.put(canonicalBytes, {
    permanence: 'deletion-compatible',
  });
  assert.equal(receipt.verified, true);
  assert.deepEqual(await storage.get(receipt.cid), canonicalBytes);
  return {
    cid: receipt.cid,
    envelope,
    objectId: getObjectId(envelope.payload),
  };
}

function digestBytes(multibaseDigest) {
  return Array.from(decodeMultibaseBase64Url(multibaseDigest, 32));
}

async function waitForTransactionReadiness(connection, payer) {
  const startedAt = Date.now();
  const initialSlot = await connection.getSlot('confirmed');
  const deadline = startedAt + 30_000;
  while (Date.now() < deadline) {
    const [slot, balance, latestBlockhash] = await Promise.all([
      connection.getSlot('confirmed'),
      connection.getBalance(payer, 'confirmed'),
      connection.getLatestBlockhash('confirmed'),
    ]);
    if (
      Date.now() - startedAt >= 3_000 &&
      slot >= initialSlot + 8 &&
      balance >= 3 * LAMPORTS_PER_SOL
    ) {
      return latestBlockhash;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Local validator did not become transaction-ready within 30 seconds.');
}

async function waitForCommitment(connection, signatures, commitment, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const response = await connection.getSignatureStatuses(signatures, {
      searchTransactionHistory: true,
    });
    for (const status of response.value) {
      if (status?.err) {
        throw new Error(`Local transaction failed: ${JSON.stringify(status.err)}`);
      }
    }
    if (
      response.value.every(
        (status) =>
          status !== null &&
          (commitment === 'confirmed'
            ? status.confirmationStatus === 'confirmed' || status.confirmationStatus === 'finalized'
            : status.confirmationStatus === 'finalized'),
      )
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Transactions did not reach ${commitment} within ${timeout / 1_000} seconds.`);
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the vertical-slice fixture.`);
  }
  return value;
}

function localUrl(value, expectedProtocol) {
  const url = new URL(value);
  if (
    url.protocol !== expectedProtocol ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.username ||
    url.password
  ) {
    throw new Error(`Refusing non-local ${expectedProtocol} endpoint ${value}.`);
  }
  return url;
}
