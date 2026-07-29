import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";

import { BN, web3, type AnchorProvider, type Program } from "@coral-xyz/anchor";

import type { SocialProtocol } from "../../target/types/social_protocol";

const { PublicKey, SystemProgram } = web3;

const PDA_PREFIX = Buffer.from("wokesocial");
const PDA_VERSION = Buffer.from([1]);
const IDENTITY_SEED = Buffer.from("identity");
const HANDLE_SEED = Buffer.from("handle");
const POST_SEED = Buffer.from("post");
const FOLLOW_SEED = Buffer.from("follow");
const TOMBSTONE_SEED = Buffer.from("tombstone");
const DELEGATION_SEED = Buffer.from("delegation");
const BLOCK_SEED = Buffer.from("block");
const REACTION_SEED = Buffer.from("reaction");

export const HANDLE_CLAIM_SPACE = 156;
export const REACTION_LIKE = 1;
export const SCOPE_PROFILE = 1;
export const SCOPE_POST = 1 << 1;
export const SCOPE_SOCIAL = 1 << 2;
export const TEST_MANIFEST_CID =
  "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";

export interface Phase2Context {
  config: web3.PublicKey;
  program: Program<SocialProtocol>;
  provider: AnchorProvider;
}

export interface IdentityFixture {
  address: web3.PublicKey;
  authority: web3.Keypair;
  identityNonce: number[];
}

export interface DelegationFixture {
  address: web3.PublicKey;
  delegate: web3.Keypair;
  delegationSequence: number;
}

export interface TransactionMeasurement {
  computeUnits: number;
  label: string;
  signature: string;
  transactionBytes: number;
}

export function digest(value: string): number[] {
  return Array.from(createHash("sha256").update(value).digest());
}

export function manifestUri(value: string): string {
  const digest = createHash("sha256").update(value).digest();
  const cidBytes = Buffer.concat([
    Buffer.from([0x01, 0x55, 0x12, 0x20]),
    digest,
  ]);
  return `local://b${encodeBase32(cidBytes)}`;
}

function encodeBase32(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let encoded = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      encoded += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    encoded += alphabet[(value << (5 - bits)) & 31];
  }
  return encoded;
}

export function nonce(value: number): number[] {
  return Array.from({ length: 16 }, (_, index) => (value + index) & 0xff);
}

export function u64Seed(value: number): Buffer {
  const seed = Buffer.alloc(8);
  seed.writeBigUInt64LE(BigInt(value));
  return seed;
}

export function deriveIdentity(
  programId: web3.PublicKey,
  authority: web3.PublicKey,
  identityNonce: number[],
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      IDENTITY_SEED,
      authority.toBuffer(),
      Buffer.from(identityNonce),
    ],
    programId,
  )[0];
}

export function deriveHandleClaim(
  programId: web3.PublicKey,
  handleHash: number[],
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [PDA_PREFIX, PDA_VERSION, HANDLE_SEED, Buffer.from(handleHash)],
    programId,
  )[0];
}

export function derivePost(
  programId: web3.PublicKey,
  identity: web3.PublicKey,
  postNonce: number[],
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      POST_SEED,
      identity.toBuffer(),
      Buffer.from(postNonce),
    ],
    programId,
  )[0];
}

export function deriveFollow(
  programId: web3.PublicKey,
  followerIdentity: web3.PublicKey,
  subjectIdentity: web3.PublicKey,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      FOLLOW_SEED,
      followerIdentity.toBuffer(),
      subjectIdentity.toBuffer(),
    ],
    programId,
  )[0];
}

export function deriveTombstone(
  programId: web3.PublicKey,
  authorIdentity: web3.PublicKey,
  postReference: web3.PublicKey,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      TOMBSTONE_SEED,
      authorIdentity.toBuffer(),
      postReference.toBuffer(),
    ],
    programId,
  )[0];
}

export function deriveDelegation(
  programId: web3.PublicKey,
  identity: web3.PublicKey,
  delegate: web3.PublicKey,
  sequence: number,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      DELEGATION_SEED,
      identity.toBuffer(),
      delegate.toBuffer(),
      u64Seed(sequence),
    ],
    programId,
  )[0];
}

export function deriveBlock(
  programId: web3.PublicKey,
  blockerIdentity: web3.PublicKey,
  subjectIdentity: web3.PublicKey,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      BLOCK_SEED,
      blockerIdentity.toBuffer(),
      subjectIdentity.toBuffer(),
    ],
    programId,
  )[0];
}

export function deriveReaction(
  programId: web3.PublicKey,
  reactorIdentity: web3.PublicKey,
  targetPost: web3.PublicKey,
  reactionKind: number,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      REACTION_SEED,
      reactorIdentity.toBuffer(),
      targetPost.toBuffer(),
      Buffer.from([reactionKind]),
    ],
    programId,
  )[0];
}

export async function createIdentity(
  context: Phase2Context,
  nonceStart: number,
): Promise<IdentityFixture> {
  const authority = web3.Keypair.generate();
  const identityNonce = nonce(nonceStart);
  const address = deriveIdentity(
    context.program.programId,
    authority.publicKey,
    identityNonce,
  );

  await context.program.methods
    .createIdentity({ identityNonce })
    .accountsStrict({
      config: context.config,
      identity: address,
      rootAuthority: authority.publicKey,
      payer: context.provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([authority])
    .rpc();

  return { address, authority, identityNonce };
}

export async function createDelegation(
  context: Phase2Context,
  identity: IdentityFixture,
  delegate: web3.Keypair,
  scopes: number,
  options: {
    delegationSequence?: number;
    expectedIdentitySequence?: number;
    expiresAtSlot?: number;
  } = {},
): Promise<DelegationFixture> {
  const delegationSequence = options.delegationSequence ?? 1;
  const expectedIdentitySequence = options.expectedIdentitySequence ?? 0;
  const expiresAtSlot =
    options.expiresAtSlot ??
    (await context.provider.connection.getSlot("confirmed")) + 1_000;
  const address = deriveDelegation(
    context.program.programId,
    identity.address,
    delegate.publicKey,
    delegationSequence,
  );

  await context.program.methods
    .createDelegation({
      expectedIdentitySequence: new BN(expectedIdentitySequence),
      delegationSequence: new BN(delegationSequence),
      delegateAuthority: delegate.publicKey,
      scopes,
      expiresAtSlot: new BN(expiresAtSlot),
    })
    .accountsStrict({
      config: context.config,
      identity: identity.address,
      delegation: address,
      rootAuthority: identity.authority.publicKey,
      payer: context.provider.wallet.publicKey,
      systemProgram: SystemProgram.programId,
    })
    .signers([identity.authority])
    .rpc();

  return { address, delegate, delegationSequence };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringProperty(
  value: unknown,
  ...properties: string[]
): string | undefined {
  let cursor: unknown = value;
  for (const property of properties) {
    cursor = record(cursor)?.[property];
  }
  return typeof cursor === "string" ? cursor : undefined;
}

function anchorErrorCode(error: unknown): string | undefined {
  const structuredCode =
    stringProperty(error, "error", "errorCode", "code") ??
    stringProperty(error, "errorCode", "code") ??
    stringProperty(error, "code");
  if (structuredCode !== undefined) {
    return structuredCode;
  }

  const errorRecord = record(error);
  const logs = errorRecord?.logs;
  const rendered = [
    error instanceof Error ? error.message : String(error),
    ...(Array.isArray(logs)
      ? logs.filter((entry): entry is string => typeof entry === "string")
      : []),
  ].join("\n");
  return /Error Code: ([A-Za-z0-9_]+)/u.exec(rendered)?.[1];
}

export async function assertAnchorError(
  operation: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  await assert.rejects(operation, (error: unknown) => {
    assert.equal(
      anchorErrorCode(error),
      expectedCode,
      `expected Anchor error ${expectedCode}, received ${String(error)}`,
    );
    return true;
  });
}

export async function waitUntilAfterSlot(
  provider: AnchorProvider,
  expiresAtSlot: number,
): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (
    (await provider.connection.getSlot("confirmed")) <= expiresAtSlot &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(
    (await provider.connection.getSlot("confirmed")) > expiresAtSlot,
    "local validator did not advance beyond delegation expiry",
  );
}

export async function waitForAccountClosure(
  provider: AnchorProvider,
  address: web3.PublicKey,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (
      (await provider.connection.getAccountInfo(address, "confirmed")) === null
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail(`account ${address.toBase58()} was not closed at confirmed`);
}

export async function measureAndSend(
  context: Phase2Context,
  label: string,
  build: () => Promise<web3.Transaction>,
  signers: web3.Keypair[],
): Promise<TransactionMeasurement> {
  const transaction = await build();
  const latestBlockhash =
    await context.provider.connection.getLatestBlockhash("confirmed");
  transaction.feePayer = context.provider.wallet.publicKey;
  transaction.recentBlockhash = latestBlockhash.blockhash;
  transaction.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
  if (signers.length > 0) {
    transaction.partialSign(...signers);
  }
  const signedTransaction =
    await context.provider.wallet.signTransaction(transaction);
  const serialized = signedTransaction.serialize();
  assert.ok(
    serialized.byteLength <= 1_100,
    `${label} exceeds the 1,100-byte budget`,
  );
  assert.ok(
    serialized.byteLength <= 1_232,
    `${label} exceeds Solana packet size`,
  );

  const simulation =
    await context.provider.connection.simulateTransaction(signedTransaction);
  assert.equal(
    simulation.value.err,
    null,
    `${label} simulation failed: ${JSON.stringify(simulation.value.err)}`,
  );
  assert.equal(typeof simulation.value.unitsConsumed, "number");
  assert.ok(
    (simulation.value.unitsConsumed ?? Number.POSITIVE_INFINITY) <= 150_000,
    `${label} simulation exceeds the 150,000-CU budget`,
  );

  const signature = await context.provider.connection.sendRawTransaction(
    serialized,
    {
      maxRetries: 3,
      skipPreflight: false,
    },
  );
  const confirmation = await context.provider.connection.confirmTransaction(
    { ...latestBlockhash, signature },
    "confirmed",
  );
  assert.equal(
    confirmation.value.err,
    null,
    `${label} transaction failed: ${JSON.stringify(confirmation.value.err)}`,
  );

  let landed: Awaited<
    ReturnType<typeof context.provider.connection.getTransaction>
  > = null;
  for (let attempt = 0; attempt < 20 && landed === null; attempt += 1) {
    landed = await context.provider.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (landed === null) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  const computeUnits = landed?.meta?.computeUnitsConsumed;
  assert.equal(
    typeof computeUnits,
    "number",
    `${label} has no compute measurement`,
  );
  assert.ok(
    (computeUnits ?? Number.POSITIVE_INFINITY) <= 150_000,
    `${label} exceeds the 150,000-CU budget`,
  );

  return {
    label,
    signature,
    transactionBytes: serialized.byteLength,
    computeUnits: computeUnits ?? 0,
  };
}

export async function assertRentExemptAccount(
  context: Phase2Context,
  address: web3.PublicKey,
  label: string,
  expectedSpace: number,
): Promise<{
  label: string;
  minimumRentLamports: number;
  space: number;
}> {
  const [account, minimumRentLamports] = await Promise.all([
    context.provider.connection.getAccountInfo(address, "confirmed"),
    context.provider.connection.getMinimumBalanceForRentExemption(
      expectedSpace,
      "confirmed",
    ),
  ]);
  assert.ok(account, `${label} account is missing`);
  assert.equal(
    account.data.byteLength,
    expectedSpace,
    `${label} space drifted`,
  );
  assert.ok(
    account.lamports >= minimumRentLamports,
    `${label} is below rent-exempt minimum`,
  );
  return { label, space: expectedSpace, minimumRentLamports };
}
