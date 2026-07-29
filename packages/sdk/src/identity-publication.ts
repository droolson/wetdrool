import {
  AccountRole,
  address,
  getAddressDecoder,
  getAddressEncoder,
  getBase64Decoder,
  getBase64Encoder,
  getProgramDerivedAddress,
  type AccountMeta,
} from '@solana/kit';

import { extractWokeManifestCid } from './manifest-uri.js';
import {
  createWokeNetContext,
  deriveWokeProtocolConfigAddress,
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  type ValidatedWokeNetContext,
  type WokeInstruction,
  type WokeNetContext,
} from './woke-payments.js';
import type {
  WokeTransactionSimulationSnapshot,
  WokeTransactionSimulationVerifier,
} from './woke-transaction.js';

const ACCOUNT_VERSION = 1;
const PROTOCOL_VERSION = 1;
const U64_MAX = 18_446_744_073_709_551_615n;
const NONCE_BYTES = 16;
const MANIFEST_HASH_BYTES = 32;
const MAX_MANIFEST_URI_BYTES = 200;
const MAX_EVENT_BYTES = 512;
const MAX_EVENT_BASE64_CHARACTERS = 1_024;
const MAX_LOG_LINES = 1_024;
const MAX_LOG_LINE_CHARACTERS = 16_384;

const PDA_PREFIX = ascii('wokesocial');
const PDA_VERSION = Uint8Array.of(ACCOUNT_VERSION);
const IDENTITY_SEED = ascii('identity');
const POST_SEED = ascii('post');
const PRIMARY_IDENTITY_NONCE = ascii('primary-identity');
const ADDRESS_ENCODER = getAddressEncoder();

const CREATE_IDENTITY_DISCRIMINATOR = Uint8Array.of(12, 253, 209, 41, 176, 51, 195, 179);
const PUBLISH_POST_DISCRIMINATOR = Uint8Array.of(182, 78, 189, 205, 125, 46, 217, 154);
const IDENTITY_ACCOUNT_DISCRIMINATOR = Uint8Array.of(58, 132, 5, 12, 176, 164, 85, 112);
const POST_REFERENCE_ACCOUNT_DISCRIMINATOR = Uint8Array.of(211, 85, 89, 48, 227, 1, 60, 119);
const IDENTITY_CREATED_EVENT_DISCRIMINATOR = Uint8Array.of(247, 185, 231, 174, 133, 94, 200, 142);
const POST_REFERENCE_PUBLISHED_EVENT_DISCRIMINATOR = Uint8Array.of(
  65,
  16,
  116,
  252,
  204,
  196,
  161,
  100,
);

/** Exact Anchor allocation in `Identity::SPACE`. */
export const WOKE_IDENTITY_ACCOUNT_SPACE = 407;
/** Exact Anchor allocation in `PostReference::SPACE`. */
export const WOKE_POST_REFERENCE_ACCOUNT_SPACE = 351;

export type WokeIdentityPublicationErrorCode =
  | 'account-not-found'
  | 'alias'
  | 'invalid-account'
  | 'invalid-address'
  | 'invalid-event'
  | 'invalid-manifest'
  | 'invalid-nonce'
  | 'invalid-reader'
  | 'invalid-sequence'
  | 'simulation-mismatch';

export class WokeIdentityPublicationError extends Error {
  override readonly name = 'WokeIdentityPublicationError';

  constructor(
    readonly code: WokeIdentityPublicationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface WokeIdentityCoordinates {
  readonly context: ValidatedWokeNetContext;
  readonly configAddress: string;
  readonly identityAddress: string;
  readonly identityBump: number;
  readonly identityNonce: Uint8Array;
  readonly originAuthority: string;
}

export interface BuildCreateWokeIdentityInput {
  readonly identityNonce: Uint8Array;
  readonly payer: string;
  readonly rootAuthority: string;
}

export interface BuildCreatePrimaryWokeIdentityInput {
  readonly payer: string;
  readonly rootAuthority: string;
}

export interface BuiltCreateWokeIdentityInstruction extends WokeIdentityCoordinates {
  readonly kind: 'create-identity';
  readonly instruction: WokeInstruction;
  readonly payer: string;
  readonly rentExemptionSpace: typeof WOKE_IDENTITY_ACCOUNT_SPACE;
  readonly rootAuthority: string;
}

export interface BuildPublishWokePostInput {
  /** The current `Identity.sequence`; the program increments it exactly once. */
  readonly expectedAuthorSequence: bigint;
  readonly manifestHash: Uint8Array;
  readonly manifestUri: string;
  readonly payer: string;
  /**
   * Persistent operation coordinate. Reuse these exact 16 bytes after an
   * ambiguous send result; changing them addresses a different post.
   */
  readonly postNonce: Uint8Array;
  readonly authorIdentity: string;
  readonly rootAuthority: string;
}

export interface BuiltPublishWokePostInstruction {
  readonly kind: 'publish-post';
  readonly context: ValidatedWokeNetContext;
  readonly configAddress: string;
  readonly authorIdentity: string;
  readonly expectedAuthorSequence: bigint;
  readonly manifestHash: Uint8Array;
  readonly manifestUri: string;
  readonly payer: string;
  readonly postNonce: Uint8Array;
  readonly postReferenceAddress: string;
  readonly postReferenceBump: number;
  readonly rentExemptionSpace: typeof WOKE_POST_REFERENCE_ACCOUNT_SPACE;
  readonly rootAuthority: string;
  readonly instruction: WokeInstruction;
}

export interface WokeIdentityAccountRecord {
  readonly version: number;
  readonly config: string;
  readonly identityNonce: Uint8Array;
  readonly originAuthority: string;
  readonly rootAuthority: string;
  readonly rootRotationCount: bigint;
  readonly delegationSequence: bigint;
  readonly sequence: bigint;
  readonly profileSequence: bigint;
  readonly profileManifestHash: Uint8Array;
  readonly profileManifestUri: string;
  readonly createdAtSlot: bigint;
  readonly profileUpdatedAtSlot: bigint;
  readonly active: boolean;
  readonly bump: number;
}

export interface WokePostReferenceAccountRecord {
  readonly version: number;
  readonly config: string;
  readonly authorIdentity: string;
  readonly postNonce: Uint8Array;
  readonly manifestHash: Uint8Array;
  readonly manifestUri: string;
  readonly authorSequence: bigint;
  readonly createdAtSlot: bigint;
  readonly tombstonedAtSlot: bigint | null;
  readonly bump: number;
}

export type WokeAccountCommitment = 'processed' | 'confirmed' | 'finalized';

export interface WokeProgramAccountReadRequest {
  readonly endpoint: string;
  readonly genesisHash: string;
  readonly programAddress: string;
  readonly address: string;
  readonly commitment: WokeAccountCommitment;
}

export interface WokeProgramAccountSnapshot {
  readonly address: string;
  readonly owner: string;
  readonly commitment: WokeAccountCommitment;
  readonly slot: bigint;
  readonly data: Uint8Array;
}

export interface WokeProgramAccountReader {
  readAccount(request: WokeProgramAccountReadRequest): Promise<WokeProgramAccountSnapshot | null>;
}

export type WokeIdentityCreationReconciliation =
  | { readonly status: 'absent' }
  | {
      readonly status: 'existing';
      readonly account: WokeProgramAccountSnapshot;
      readonly identity: WokeIdentityAccountRecord;
    };

export type WokePostPublicationReconciliation =
  | {
      readonly status: 'ready';
      readonly identity: WokeIdentityAccountRecord;
    }
  | {
      readonly status: 'existing';
      readonly account: WokeProgramAccountSnapshot;
      readonly post: WokePostReferenceAccountRecord;
    };

/**
 * Returns the one stable v1 primary-identity coordinate for a root authority.
 * The 16-byte convention nonce is constant because the root authority is
 * already an independent PDA seed.
 */
export async function derivePrimaryWokeIdentityCoordinates(
  contextInput: WokeNetContext,
  rootAuthorityInput: string,
): Promise<WokeIdentityCoordinates> {
  return deriveIdentityCoordinates(contextInput, rootAuthorityInput, PRIMARY_IDENTITY_NONCE);
}

export async function deriveWokePostReferenceAddress(
  contextInput: WokeNetContext,
  authorIdentityInput: string,
  postNonceInput: Uint8Array,
): Promise<string> {
  return (await derivePostCoordinates(contextInput, authorIdentityInput, postNonceInput))
    .postReferenceAddress;
}

/**
 * Builds the exact root-authorized `create_identity` instruction. It does not
 * sign, simulate, submit, or claim that the identity exists.
 */
export async function buildCreateWokeIdentityInstruction(
  contextInput: WokeNetContext,
  input: BuildCreateWokeIdentityInput,
): Promise<BuiltCreateWokeIdentityInstruction> {
  const coordinates = await deriveIdentityCoordinates(
    contextInput,
    input.rootAuthority,
    input.identityNonce,
  );
  const payer = parseAddress(input.payer, 'identity rent payer');
  assertCreationAliases(coordinates, payer);
  const nonce = Uint8Array.from(coordinates.identityNonce);
  return Object.freeze({
    kind: 'create-identity',
    ...coordinates,
    identityNonce: Uint8Array.from(nonce),
    instruction: instruction(
      coordinates.context,
      [
        meta(coordinates.configAddress, AccountRole.WRITABLE),
        meta(coordinates.identityAddress, AccountRole.WRITABLE),
        meta(coordinates.originAuthority, AccountRole.READONLY_SIGNER),
        meta(payer, AccountRole.WRITABLE_SIGNER),
        meta(WOKENET_SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
      ],
      concat(CREATE_IDENTITY_DISCRIMINATOR, nonce),
    ),
    payer,
    rentExemptionSpace: WOKE_IDENTITY_ACCOUNT_SPACE,
    rootAuthority: coordinates.originAuthority,
  });
}

export async function buildCreatePrimaryWokeIdentityInstruction(
  contextInput: WokeNetContext,
  input: BuildCreatePrimaryWokeIdentityInput,
): Promise<BuiltCreateWokeIdentityInstruction> {
  return buildCreateWokeIdentityInstruction(contextInput, {
    ...input,
    identityNonce: PRIMARY_IDENTITY_NONCE,
  });
}

/**
 * Builds the exact root-authorized `publish_post` instruction. Every
 * response-loss-sensitive coordinate is returned in the built value and is
 * defensively copied from the caller.
 */
export async function buildPublishWokePostInstruction(
  contextInput: WokeNetContext,
  input: BuildPublishWokePostInput,
): Promise<BuiltPublishWokePostInstruction> {
  const coordinates = await derivePostCoordinates(
    contextInput,
    input.authorIdentity,
    input.postNonce,
  );
  const configAddress = await deriveWokeProtocolConfigAddress(coordinates.context);
  const rootAuthority = parseAddress(input.rootAuthority, 'post root authority');
  const payer = parseAddress(input.payer, 'post-reference rent payer');
  const expectedAuthorSequence = parseIncrementableU64(
    input.expectedAuthorSequence,
    'expected author sequence',
  );
  const manifest = parseManifest(input.manifestHash, input.manifestUri);
  assertPostAliases(
    coordinates.context,
    configAddress,
    coordinates.authorIdentity,
    coordinates.postReferenceAddress,
    rootAuthority,
    payer,
  );

  const postNonce = Uint8Array.from(coordinates.postNonce);
  const manifestHash = Uint8Array.from(manifest.hash);
  const data = new BorshWriter(PUBLISH_POST_DISCRIMINATOR)
    .u64(expectedAuthorSequence)
    .fixed(postNonce)
    .fixed(manifestHash)
    .string(manifest.uri)
    .finish();
  return Object.freeze({
    kind: 'publish-post',
    context: coordinates.context,
    configAddress,
    authorIdentity: coordinates.authorIdentity,
    expectedAuthorSequence,
    manifestHash: Uint8Array.from(manifestHash),
    manifestUri: manifest.uri,
    payer,
    postNonce: Uint8Array.from(postNonce),
    postReferenceAddress: coordinates.postReferenceAddress,
    postReferenceBump: coordinates.postReferenceBump,
    rentExemptionSpace: WOKE_POST_REFERENCE_ACCOUNT_SPACE,
    rootAuthority,
    instruction: instruction(
      coordinates.context,
      [
        meta(configAddress, AccountRole.WRITABLE),
        meta(coordinates.authorIdentity, AccountRole.WRITABLE),
        meta(coordinates.postReferenceAddress, AccountRole.WRITABLE),
        meta(rootAuthority, AccountRole.READONLY_SIGNER),
        meta(payer, AccountRole.WRITABLE_SIGNER),
        meta(WOKENET_SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
      ],
      data,
    ),
  });
}

export function decodeWokeIdentityAccount(dataInput: Uint8Array): WokeIdentityAccountRecord {
  const data = parseAccountBytes(dataInput, WOKE_IDENTITY_ACCOUNT_SPACE, 'Identity');
  const reader = new BorshReader(data, IDENTITY_ACCOUNT_DISCRIMINATOR, 'Identity');
  const record: WokeIdentityAccountRecord = {
    version: reader.u8(),
    config: reader.address(),
    identityNonce: reader.fixed(NONCE_BYTES),
    originAuthority: reader.address(),
    rootAuthority: reader.address(),
    rootRotationCount: reader.u64(),
    delegationSequence: reader.u64(),
    sequence: reader.u64(),
    profileSequence: reader.u64(),
    profileManifestHash: reader.fixed(MANIFEST_HASH_BYTES),
    profileManifestUri: reader.string(MAX_MANIFEST_URI_BYTES),
    createdAtSlot: reader.u64(),
    profileUpdatedAtSlot: reader.u64(),
    active: reader.boolean(),
    bump: reader.u8(),
  };
  reader.finishZeroPadding();
  validateDecodedIdentity(record);
  return record;
}

export function decodeWokePostReferenceAccount(
  dataInput: Uint8Array,
): WokePostReferenceAccountRecord {
  const data = parseAccountBytes(dataInput, WOKE_POST_REFERENCE_ACCOUNT_SPACE, 'PostReference');
  const reader = new BorshReader(data, POST_REFERENCE_ACCOUNT_DISCRIMINATOR, 'PostReference');
  const record: WokePostReferenceAccountRecord = {
    version: reader.u8(),
    config: reader.address(),
    authorIdentity: reader.address(),
    postNonce: reader.fixed(NONCE_BYTES),
    manifestHash: reader.fixed(MANIFEST_HASH_BYTES),
    manifestUri: reader.string(MAX_MANIFEST_URI_BYTES),
    authorSequence: reader.u64(),
    createdAtSlot: reader.u64(),
    tombstonedAtSlot: reader.optionalU64(),
    bump: reader.u8(),
  };
  reader.finishZeroPadding();
  validateDecodedPost(record);
  return record;
}

/**
 * Verifies both the RPC envelope and the invariant PDA fields. Mutable identity
 * state is decoded and returned but is not mistaken for a fresh account.
 */
export function verifyWokeIdentityAccount(
  coordinates: WokeIdentityCoordinates,
  account: WokeProgramAccountSnapshot,
  minimumCommitment: WokeAccountCommitment = 'processed',
): WokeIdentityAccountRecord {
  verifyAccountEnvelope(
    coordinates.context,
    coordinates.identityAddress,
    account,
    minimumCommitment,
  );
  const identity = decodeWokeIdentityAccount(account.data);
  if (
    identity.version !== ACCOUNT_VERSION ||
    identity.config !== coordinates.configAddress ||
    identity.originAuthority !== coordinates.originAuthority ||
    !equalBytes(identity.identityNonce, coordinates.identityNonce) ||
    identity.bump !== coordinates.identityBump ||
    identity.createdAtSlot > account.slot ||
    identity.profileUpdatedAtSlot > account.slot
  ) {
    throw operationError(
      'invalid-account',
      'The Identity account does not match its deterministic WokeNet coordinates.',
    );
  }
  return identity;
}

export function verifyFreshWokeIdentityAccount(
  built: BuiltCreateWokeIdentityInstruction,
  account: WokeProgramAccountSnapshot,
  minimumCommitment: WokeAccountCommitment = 'finalized',
): WokeIdentityAccountRecord {
  const identity = verifyWokeIdentityAccount(built, account, minimumCommitment);
  if (
    identity.rootAuthority !== built.rootAuthority ||
    identity.rootRotationCount !== 0n ||
    identity.delegationSequence !== 0n ||
    identity.sequence !== 0n ||
    identity.profileSequence !== 0n ||
    !isZeroHash(identity.profileManifestHash) ||
    identity.profileManifestUri !== '' ||
    identity.profileUpdatedAtSlot !== 0n ||
    !identity.active
  ) {
    throw operationError(
      'invalid-account',
      'The finalized Identity account is not the exact fresh account created by this operation.',
    );
  }
  return identity;
}

export function verifyWokePostReferenceAccount(
  built: BuiltPublishWokePostInstruction,
  account: WokeProgramAccountSnapshot,
  minimumCommitment: WokeAccountCommitment = 'processed',
): WokePostReferenceAccountRecord {
  verifyAccountEnvelope(built.context, built.postReferenceAddress, account, minimumCommitment);
  const post = decodeWokePostReferenceAccount(account.data);
  if (
    post.version !== ACCOUNT_VERSION ||
    post.config !== built.configAddress ||
    post.authorIdentity !== built.authorIdentity ||
    !equalBytes(post.postNonce, built.postNonce) ||
    !equalBytes(post.manifestHash, built.manifestHash) ||
    post.manifestUri !== built.manifestUri ||
    post.authorSequence !== built.expectedAuthorSequence + 1n ||
    post.bump !== built.postReferenceBump ||
    post.createdAtSlot > account.slot ||
    (post.tombstonedAtSlot !== null &&
      (post.tombstonedAtSlot < post.createdAtSlot || post.tombstonedAtSlot > account.slot))
  ) {
    throw operationError(
      'invalid-account',
      'The PostReference account does not match the persistent publication coordinates.',
    );
  }
  return post;
}

/**
 * Checks the deterministic identity PDA before submitting Anchor's
 * non-idempotent `init`. Any matching commitment is treated as landed.
 */
export async function reconcileWokeIdentityCreation(
  built: BuiltCreateWokeIdentityInstruction,
  reader: WokeProgramAccountReader,
): Promise<WokeIdentityCreationReconciliation> {
  const account = await readAccount(reader, accountRequest(built.context, built.identityAddress));
  if (account === null) return { status: 'absent' };
  return {
    status: 'existing',
    account,
    identity: verifyWokeIdentityAccount(built, account),
  };
}

/**
 * Checks the deterministic post PDA first. If absent, it proves that the
 * author identity still has the exact sequence and authority this transaction
 * was built against before returning `ready`.
 */
export async function reconcileWokePostPublication(
  built: BuiltPublishWokePostInstruction,
  identityCoordinates: WokeIdentityCoordinates,
  reader: WokeProgramAccountReader,
): Promise<WokePostPublicationReconciliation> {
  assertSameContext(built.context, identityCoordinates.context);
  if (built.authorIdentity !== identityCoordinates.identityAddress) {
    throw operationError(
      'invalid-account',
      'The supplied identity coordinates do not select the post author.',
    );
  }
  const postAccount = await readAccount(
    reader,
    accountRequest(built.context, built.postReferenceAddress),
  );
  if (postAccount !== null) {
    return {
      status: 'existing',
      account: postAccount,
      post: verifyWokePostReferenceAccount(built, postAccount),
    };
  }
  const identityAccount = await readAccount(
    reader,
    accountRequest(built.context, built.authorIdentity),
  );
  if (identityAccount === null) {
    throw operationError('account-not-found', 'The author Identity account does not exist.');
  }
  const identity = verifyWokeIdentityAccount(identityCoordinates, identityAccount);
  if (
    !identity.active ||
    identity.rootAuthority !== built.rootAuthority ||
    identity.sequence !== built.expectedAuthorSequence
  ) {
    throw operationError(
      'invalid-account',
      'The author Identity state no longer matches the persistent post operation.',
    );
  }
  return { status: 'ready', identity };
}

export function createWokeIdentitySimulationVerifier(
  built: BuiltCreateWokeIdentityInstruction,
): WokeTransactionSimulationVerifier {
  return (simulation) => {
    assertSimulationBinding(built.context, simulation);
    assertExactCreationLamportEffects(
      simulation,
      built.identityAddress,
      built.payer,
      built.rentExemptionSpace,
    );
    const event = decodeSingleOperationEvent(
      simulation.logs,
      built.context.programAddress,
      IDENTITY_CREATED_EVENT_DISCRIMINATOR,
      'IdentityCreated',
    );
    const reader = new EventReader(event, IDENTITY_CREATED_EVENT_DISCRIMINATOR, 'IdentityCreated');
    const eventVersion = reader.u16();
    const config = reader.address();
    const identity = reader.address();
    const rootAuthority = reader.address();
    const identityNonce = reader.fixed(NONCE_BYTES);
    const createdAtSlot = reader.u64();
    reader.finish();
    if (
      eventVersion !== PROTOCOL_VERSION ||
      config !== built.configAddress ||
      identity !== built.identityAddress ||
      rootAuthority !== built.rootAuthority ||
      !equalBytes(identityNonce, built.identityNonce) ||
      createdAtSlot !== simulation.contextSlot
    ) {
      throw operationError(
        'simulation-mismatch',
        'The simulated IdentityCreated event differs from the approved identity operation.',
      );
    }
  };
}

export function createWokePostSimulationVerifier(
  built: BuiltPublishWokePostInstruction,
): WokeTransactionSimulationVerifier {
  return (simulation) => {
    assertSimulationBinding(built.context, simulation);
    assertExactCreationLamportEffects(
      simulation,
      built.postReferenceAddress,
      built.payer,
      built.rentExemptionSpace,
    );
    const event = decodeSingleOperationEvent(
      simulation.logs,
      built.context.programAddress,
      POST_REFERENCE_PUBLISHED_EVENT_DISCRIMINATOR,
      'PostReferencePublished',
    );
    const reader = new EventReader(
      event,
      POST_REFERENCE_PUBLISHED_EVENT_DISCRIMINATOR,
      'PostReferencePublished',
    );
    const eventVersion = reader.u16();
    const config = reader.address();
    const postReference = reader.address();
    const authorIdentity = reader.address();
    const authority = reader.address();
    const postNonce = reader.fixed(NONCE_BYTES);
    const authorSequence = reader.u64();
    const manifestHash = reader.fixed(MANIFEST_HASH_BYTES);
    const manifestUri = reader.string(MAX_MANIFEST_URI_BYTES);
    const createdAtSlot = reader.u64();
    reader.finish();
    if (
      eventVersion !== PROTOCOL_VERSION ||
      config !== built.configAddress ||
      postReference !== built.postReferenceAddress ||
      authorIdentity !== built.authorIdentity ||
      authority !== built.rootAuthority ||
      !equalBytes(postNonce, built.postNonce) ||
      authorSequence !== built.expectedAuthorSequence + 1n ||
      !equalBytes(manifestHash, built.manifestHash) ||
      manifestUri !== built.manifestUri ||
      createdAtSlot !== simulation.contextSlot
    ) {
      throw operationError(
        'simulation-mismatch',
        'The simulated PostReferencePublished event differs from the approved post operation.',
      );
    }
  };
}

interface DerivedPostCoordinates {
  readonly context: ValidatedWokeNetContext;
  readonly authorIdentity: string;
  readonly postNonce: Uint8Array;
  readonly postReferenceAddress: string;
  readonly postReferenceBump: number;
}

async function deriveIdentityCoordinates(
  contextInput: WokeNetContext,
  rootAuthorityInput: string,
  nonceInput: Uint8Array,
): Promise<WokeIdentityCoordinates> {
  const context = createWokeNetContext(contextInput);
  const originAuthority = parseAddress(rootAuthorityInput, 'identity root authority');
  if (originAuthority === context.programAddress) {
    throw operationError(
      'alias',
      'The identity root authority cannot alias the WokeSocial protocol program.',
    );
  }
  const identityNonce = parseNonce(nonceInput, 'identity nonce');
  const configAddress = await deriveWokeProtocolConfigAddress(context);
  const [identityAddress, identityBump] = await getProgramDerivedAddress({
    programAddress: address(context.programAddress),
    seeds: [PDA_PREFIX, PDA_VERSION, IDENTITY_SEED, addressBytes(originAuthority), identityNonce],
  });
  if (
    identityAddress === configAddress ||
    identityAddress === originAuthority ||
    identityAddress === context.programAddress
  ) {
    throw operationError('alias', 'The derived Identity address aliases a protocol account.');
  }
  return Object.freeze({
    context,
    configAddress,
    identityAddress,
    identityBump,
    identityNonce: Uint8Array.from(identityNonce),
    originAuthority,
  });
}

async function derivePostCoordinates(
  contextInput: WokeNetContext,
  authorIdentityInput: string,
  nonceInput: Uint8Array,
): Promise<DerivedPostCoordinates> {
  const context = createWokeNetContext(contextInput);
  const authorIdentity = parseAddress(authorIdentityInput, 'post author identity');
  if (authorIdentity === context.programAddress) {
    throw operationError(
      'alias',
      'The post author identity cannot alias the WokeSocial protocol program.',
    );
  }
  const postNonce = parseNonce(nonceInput, 'post nonce');
  const [postReferenceAddress, postReferenceBump] = await getProgramDerivedAddress({
    programAddress: address(context.programAddress),
    seeds: [PDA_PREFIX, PDA_VERSION, POST_SEED, addressBytes(authorIdentity), postNonce],
  });
  if (postReferenceAddress === authorIdentity || postReferenceAddress === context.programAddress) {
    throw operationError('alias', 'The derived PostReference address aliases a protocol account.');
  }
  return {
    context,
    authorIdentity,
    postNonce: Uint8Array.from(postNonce),
    postReferenceAddress,
    postReferenceBump,
  };
}

function validateDecodedIdentity(identity: WokeIdentityAccountRecord): void {
  if (
    identity.version !== ACCOUNT_VERSION ||
    identity.config === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    identity.originAuthority === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    identity.rootAuthority === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    identity.profileSequence > identity.sequence ||
    (identity.profileManifestUri === '') !== isZeroHash(identity.profileManifestHash) ||
    (identity.profileManifestUri !== '' &&
      extractWokeManifestCid(identity.profileManifestUri) === undefined)
  ) {
    throw operationError(
      'invalid-account',
      'The Identity account contains invalid protocol state.',
    );
  }
}

function validateDecodedPost(post: WokePostReferenceAccountRecord): void {
  if (
    post.version !== ACCOUNT_VERSION ||
    post.config === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    post.authorIdentity === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    post.authorSequence === 0n ||
    isZeroHash(post.manifestHash) ||
    extractWokeManifestCid(post.manifestUri) === undefined ||
    (post.tombstonedAtSlot !== null && post.tombstonedAtSlot < post.createdAtSlot)
  ) {
    throw operationError(
      'invalid-account',
      'The PostReference account contains invalid protocol state.',
    );
  }
}

function assertCreationAliases(coordinates: WokeIdentityCoordinates, payer: string): void {
  if (
    payer === coordinates.context.programAddress ||
    payer === coordinates.configAddress ||
    payer === coordinates.identityAddress
  ) {
    throw operationError(
      'alias',
      'The identity rent payer cannot alias a WokeSocial protocol account.',
    );
  }
}

function assertPostAliases(
  context: ValidatedWokeNetContext,
  config: string,
  authorIdentity: string,
  postReference: string,
  rootAuthority: string,
  payer: string,
): void {
  if (new Set([config, authorIdentity, postReference]).size !== 3) {
    throw operationError('alias', 'Post protocol accounts must be pairwise distinct.');
  }
  const state = [context.programAddress, config, authorIdentity, postReference];
  if (state.includes(rootAuthority) || state.includes(payer)) {
    throw operationError(
      'alias',
      'The post authority and rent payer cannot alias a WokeSocial protocol account.',
    );
  }
}

function parseAddress(value: string, label: string): string {
  try {
    const parsed = address(value);
    if (parsed === WOKENET_SYSTEM_PROGRAM_ADDRESS) throw new TypeError('default address');
    return parsed;
  } catch (error) {
    throw operationError(
      'invalid-address',
      `The ${label} must be a non-default canonical Solana address.`,
      error,
    );
  }
}

function parseNonce(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== NONCE_BYTES) {
    throw operationError(
      'invalid-nonce',
      `The ${label} must contain exactly ${String(NONCE_BYTES)} bytes.`,
    );
  }
  return Uint8Array.from(value);
}

function parseIncrementableU64(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value >= U64_MAX) {
    throw operationError(
      'invalid-sequence',
      `The ${label} must fit the incrementable unsigned 64-bit range.`,
    );
  }
  return value;
}

function parseManifest(
  hashInput: Uint8Array,
  uriInput: string,
): { readonly hash: Uint8Array; readonly uri: string } {
  if (
    !(hashInput instanceof Uint8Array) ||
    hashInput.byteLength !== MANIFEST_HASH_BYTES ||
    isZeroHash(hashInput)
  ) {
    throw operationError(
      'invalid-manifest',
      'A post manifest hash must contain exactly 32 nonzero bytes.',
    );
  }
  if (
    typeof uriInput !== 'string' ||
    new TextEncoder().encode(uriInput).byteLength > MAX_MANIFEST_URI_BYTES ||
    extractWokeManifestCid(uriInput) === undefined
  ) {
    throw operationError(
      'invalid-manifest',
      'The post manifest URI does not satisfy the bounded WokeSocial URI policy.',
    );
  }
  return { hash: Uint8Array.from(hashInput), uri: uriInput };
}

function parseAccountBytes(value: Uint8Array, expectedLength: number, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== expectedLength) {
    throw operationError(
      'invalid-account',
      `The ${label} account must contain exactly ${String(expectedLength)} bytes.`,
    );
  }
  return Uint8Array.from(value);
}

function verifyAccountEnvelope(
  context: ValidatedWokeNetContext,
  expectedAddress: string,
  account: WokeProgramAccountSnapshot,
  minimumCommitment: WokeAccountCommitment,
): void {
  if (
    account === null ||
    typeof account !== 'object' ||
    parseEnvelopeAddress(account.address, 'account address') !== expectedAddress ||
    parseEnvelopeAddress(account.owner, 'account owner') !== context.programAddress ||
    commitmentRank(account.commitment) < commitmentRank(minimumCommitment) ||
    typeof account.slot !== 'bigint' ||
    account.slot < 0n ||
    account.slot > U64_MAX ||
    !(account.data instanceof Uint8Array)
  ) {
    throw operationError(
      'invalid-account',
      'The WokeNet account envelope has the wrong address, owner, commitment, slot, or data.',
    );
  }
}

function parseEnvelopeAddress(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw operationError('invalid-account', `The ${label} is malformed.`);
  }
  try {
    return address(value);
  } catch (error) {
    throw operationError('invalid-account', `The ${label} is malformed.`, error);
  }
}

function commitmentRank(commitment: unknown): number {
  if (commitment === 'processed') return 0;
  if (commitment === 'confirmed') return 1;
  if (commitment === 'finalized') return 2;
  throw operationError('invalid-account', 'The account commitment is invalid.');
}

function accountRequest(
  context: ValidatedWokeNetContext,
  accountAddress: string,
): WokeProgramAccountReadRequest {
  return Object.freeze({
    endpoint: context.endpoint,
    genesisHash: context.genesisHash,
    programAddress: context.programAddress,
    address: accountAddress,
    commitment: 'processed',
  });
}

async function readAccount(
  reader: WokeProgramAccountReader,
  request: WokeProgramAccountReadRequest,
): Promise<WokeProgramAccountSnapshot | null> {
  if (reader === null || typeof reader !== 'object' || typeof reader.readAccount !== 'function') {
    throw operationError('invalid-reader', 'A WokeNet program account reader is required.');
  }
  return reader.readAccount(request);
}

function assertSameContext(left: ValidatedWokeNetContext, right: ValidatedWokeNetContext): void {
  if (
    left.endpoint !== right.endpoint ||
    left.genesisHash !== right.genesisHash ||
    left.programAddress !== right.programAddress
  ) {
    throw operationError(
      'invalid-account',
      'Identity and post coordinates must belong to the same WokeNet context.',
    );
  }
}

function assertSimulationBinding(
  context: ValidatedWokeNetContext,
  simulation: WokeTransactionSimulationSnapshot,
): void {
  if (
    simulation === null ||
    typeof simulation !== 'object' ||
    simulation.source !== 'simulateTransaction' ||
    simulation.endpoint !== context.endpoint ||
    simulation.genesisHash !== context.genesisHash ||
    simulation.programAddress !== context.programAddress ||
    simulation.error !== null ||
    typeof simulation.contextSlot !== 'bigint' ||
    simulation.contextSlot < 0n ||
    simulation.contextSlot > U64_MAX
  ) {
    throw operationError(
      'simulation-mismatch',
      'The simulation is not bound to the approved WokeNet operation context.',
    );
  }
}

function assertExactCreationLamportEffects(
  simulation: WokeTransactionSimulationSnapshot,
  createdAccount: string,
  rentPayer: string,
  accountSpace: number,
): void {
  const rent = simulation.minimumRentExemptBalances[String(accountSpace)];
  if (typeof rent !== 'bigint' || rent <= 0n || rent > U64_MAX) {
    throw operationError(
      'simulation-mismatch',
      'The simulation omitted the exact rent-exempt balance for the created account.',
    );
  }
  if (
    typeof simulation.feeLamports !== 'bigint' ||
    simulation.feeLamports < 0n ||
    simulation.feeLamports > simulation.maxTransactionFeeLamports
  ) {
    throw operationError('simulation-mismatch', 'The simulated transaction fee is invalid.');
  }
  const expected = new Map<string, bigint>();
  const observed = new Set<string>();
  const add = (accountAddress: string, delta: bigint): void => {
    expected.set(accountAddress, (expected.get(accountAddress) ?? 0n) + delta);
  };
  for (const balance of simulation.accountBalances) {
    if (observed.has(balance.address)) {
      throw operationError(
        'simulation-mismatch',
        'The simulation contains a duplicate account balance.',
      );
    }
    observed.add(balance.address);
    expected.set(balance.address, 0n);
  }
  add(createdAccount, rent);
  add(rentPayer, -rent);
  add(simulation.feePayer, -simulation.feeLamports);

  let observedCreated = false;
  for (const balance of simulation.accountBalances) {
    if (
      typeof balance.preLamports !== 'bigint' ||
      typeof balance.postLamports !== 'bigint' ||
      typeof balance.deltaLamports !== 'bigint' ||
      balance.postLamports - balance.preLamports !== balance.deltaLamports ||
      balance.deltaLamports !== expected.get(balance.address)
    ) {
      throw operationError(
        'simulation-mismatch',
        'The simulation contains an unapproved native-lamport effect.',
      );
    }
    if (balance.address === createdAccount) {
      observedCreated = true;
      if (balance.preLamports !== 0n || balance.postLamports !== rent) {
        throw operationError(
          'simulation-mismatch',
          'The simulated program account creation does not match exact rent funding.',
        );
      }
    }
  }
  if (!observedCreated || !observed.has(rentPayer) || !observed.has(simulation.feePayer)) {
    throw operationError(
      'simulation-mismatch',
      'The simulation omitted the created account, rent payer, or fee payer.',
    );
  }
  assertExactSystemAccountCreation(
    simulation.innerInstructions,
    rentPayer,
    createdAccount,
    simulation.programAddress,
    rent,
    BigInt(accountSpace),
  );
}

function assertExactSystemAccountCreation(
  innerInstructions: unknown,
  rentPayer: string,
  createdAccount: string,
  owner: string,
  rent: bigint,
  space: bigint,
): void {
  if (
    !Array.isArray(innerInstructions) ||
    innerInstructions.length !== 1 ||
    !isRecord(innerInstructions[0]) ||
    innerInstructions[0].index !== 0 ||
    !Array.isArray(innerInstructions[0].instructions) ||
    innerInstructions[0].instructions.length !== 1
  ) {
    throw operationError(
      'simulation-mismatch',
      'The simulation must contain one exact System Program account creation.',
    );
  }
  const candidate = innerInstructions[0].instructions[0];
  if (
    !isRecord(candidate) ||
    candidate.programId !== WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    !isRecord(candidate.parsed) ||
    candidate.parsed.type !== 'createAccount' ||
    !isRecord(candidate.parsed.info)
  ) {
    throw operationError(
      'simulation-mismatch',
      'The simulated inner instruction is not the approved account creation.',
    );
  }
  const info = candidate.parsed.info;
  if (
    info.source !== rentPayer ||
    info.newAccount !== createdAccount ||
    info.owner !== owner ||
    info.lamports !== rent ||
    info.space !== space
  ) {
    throw operationError(
      'simulation-mismatch',
      'The simulated System Program account creation differs from the approved operation.',
    );
  }
}

function decodeSingleOperationEvent(
  logs: readonly string[] | null,
  programAddress: string,
  expectedDiscriminator: Uint8Array,
  label: string,
): Uint8Array {
  if (logs === null || !Array.isArray(logs) || logs.length > MAX_LOG_LINES) {
    throw operationError(
      'invalid-event',
      `The successful ${label} simulation omitted valid program logs.`,
    );
  }
  const stack: string[] = [];
  const events: Uint8Array[] = [];
  for (const line of logs) {
    if (typeof line !== 'string' || line.length > MAX_LOG_LINE_CHARACTERS) {
      throw operationError('invalid-event', `The ${label} simulation log is malformed.`);
    }
    const invoke = /^Program ([1-9A-HJ-NP-Za-km-z]+) invoke \[(\d+)\]$/u.exec(line);
    if (invoke !== null) {
      const invokedProgram = invoke[1];
      const depthText = invoke[2];
      const depth = Number(depthText);
      if (
        invokedProgram === undefined ||
        depthText === undefined ||
        !Number.isSafeInteger(depth) ||
        depth < 1 ||
        depth > 64 ||
        depth !== stack.length + 1
      ) {
        throw operationError('invalid-event', `The ${label} invocation log is malformed.`);
      }
      stack.push(invokedProgram);
      continue;
    }
    if (line.startsWith(`Program ${programAddress} invoke`)) {
      throw operationError('invalid-event', `The ${label} invocation log is malformed.`);
    }
    const terminal = /^Program ([1-9A-HJ-NP-Za-km-z]+) (?:success|failed:.*)$/u.exec(line);
    if (terminal !== null) {
      const terminalProgram = terminal[1];
      if (terminalProgram === undefined || stack.at(-1) !== terminalProgram) {
        if (terminalProgram === programAddress || stack.includes(terminalProgram ?? '')) {
          throw operationError('invalid-event', `The ${label} invocation stack is malformed.`);
        }
      } else {
        stack.pop();
      }
      continue;
    }
    if (!line.startsWith('Program data: ') || stack.at(-1) !== programAddress) continue;
    const encoded = line.slice('Program data: '.length);
    if (encoded.length > MAX_EVENT_BASE64_CHARACTERS) {
      throw operationError('invalid-event', `The ${label} event exceeds its safe size limit.`);
    }
    const bytes = decodeCanonicalBase64(encoded, label);
    if (bytes.byteLength > MAX_EVENT_BYTES || !startsWith(bytes, expectedDiscriminator)) {
      throw operationError(
        'invalid-event',
        `The ${label} event discriminator or decoded size is invalid.`,
      );
    }
    events.push(bytes);
  }
  if (stack.length !== 0 || events.length !== 1) {
    throw operationError(
      'invalid-event',
      `The simulation must contain one complete ${label} program event.`,
    );
  }
  const event = events[0];
  if (event === undefined) {
    throw operationError('invalid-event', `The ${label} event is missing.`);
  }
  return event;
}

function decodeCanonicalBase64(value: string, label: string): Uint8Array {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw operationError('invalid-event', `The ${label} event is not canonical base64.`);
  }
  try {
    const bytes = getBase64Encoder().encode(value);
    if (getBase64Decoder().decode(bytes) !== value) {
      throw new TypeError('non-canonical base64');
    }
    return Uint8Array.from(bytes);
  } catch (error) {
    throw operationError('invalid-event', `The ${label} event could not be decoded.`, error);
  }
}

function instruction(
  context: ValidatedWokeNetContext,
  accounts: readonly AccountMeta[],
  data: Uint8Array,
): WokeInstruction {
  return {
    programAddress: address(context.programAddress),
    accounts: Object.freeze([...accounts]),
    data,
  };
}

function meta(value: string, role: AccountRole): AccountMeta {
  return { address: address(value), role };
}

function addressBytes(value: string): Uint8Array {
  return Uint8Array.from(ADDRESS_ENCODER.encode(address(value)));
}

function ascii(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concat(...values: readonly Uint8Array[]): Uint8Array {
  const length = values.reduce((sum, value) => sum + value.byteLength, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return prefix.every((byte, index) => value[index] === byte);
}

function isZeroHash(value: Uint8Array): boolean {
  return value.every((byte) => byte === 0);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function operationError(
  code: WokeIdentityPublicationErrorCode,
  message: string,
  cause?: unknown,
): WokeIdentityPublicationError {
  return new WokeIdentityPublicationError(code, message, {
    ...(cause === undefined ? {} : { cause }),
  });
}

class BorshWriter {
  readonly #bytes: number[];

  constructor(prefix: Uint8Array) {
    this.#bytes = [...prefix];
  }

  fixed(value: Uint8Array): this {
    this.#bytes.push(...value);
    return this;
  }

  u32(value: number): this {
    this.#bytes.push(
      value & 0xff,
      (value >>> 8) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 24) & 0xff,
    );
    return this;
  }

  u64(value: bigint): this {
    let remaining = value;
    for (let index = 0; index < 8; index += 1) {
      this.#bytes.push(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
    return this;
  }

  string(value: string): this {
    const bytes = new TextEncoder().encode(value);
    return this.u32(bytes.byteLength).fixed(bytes);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}

class BorshReader {
  readonly #bytes: Uint8Array;
  readonly #errorCode: 'invalid-account' | 'invalid-event';
  readonly #label: string;
  #offset: number;

  constructor(
    bytes: Uint8Array,
    discriminator: Uint8Array,
    label: string,
    errorCode: 'invalid-account' | 'invalid-event' = 'invalid-account',
  ) {
    if (!startsWith(bytes, discriminator)) {
      throw operationError(errorCode, `The ${label} discriminator is invalid.`);
    }
    this.#bytes = bytes;
    this.#errorCode = errorCode;
    this.#label = label;
    this.#offset = discriminator.byteLength;
  }

  fixed(length: number): Uint8Array {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.#offset + length > this.#bytes.byteLength
    ) {
      throw operationError(this.#errorCode, `The ${this.#label} data ended unexpectedly.`);
    }
    const result = Uint8Array.from(this.#bytes.subarray(this.#offset, this.#offset + length));
    this.#offset += length;
    return result;
  }

  u8(): number {
    return this.fixed(1)[0] ?? 0;
  }

  u16(): number {
    const bytes = this.fixed(2);
    return (bytes[0] ?? 0) | ((bytes[1] ?? 0) << 8);
  }

  u32(): number {
    const bytes = this.fixed(4);
    return (
      ((bytes[0] ?? 0) |
        ((bytes[1] ?? 0) << 8) |
        ((bytes[2] ?? 0) << 16) |
        ((bytes[3] ?? 0) << 24)) >>>
      0
    );
  }

  u64(): bigint {
    const bytes = this.fixed(8);
    let value = 0n;
    for (let index = bytes.length - 1; index >= 0; index -= 1) {
      value = (value << 8n) | BigInt(bytes[index] ?? 0);
    }
    return value;
  }

  optionalU64(): bigint | null {
    const option = this.u8();
    if (option === 0) return null;
    if (option === 1) return this.u64();
    throw operationError(this.#errorCode, `The ${this.#label} contains an invalid optional value.`);
  }

  boolean(): boolean {
    const value = this.u8();
    if (value !== 0 && value !== 1) {
      throw operationError(this.#errorCode, `The ${this.#label} boolean is invalid.`);
    }
    return value === 1;
  }

  address(): string {
    try {
      return getAddressDecoder().decode(this.fixed(32));
    } catch (error) {
      throw operationError(
        this.#errorCode,
        `The ${this.#label} contains an invalid address.`,
        error,
      );
    }
  }

  string(maxBytes: number): string {
    const length = this.u32();
    if (length > maxBytes) {
      throw operationError(
        this.#errorCode,
        `The ${this.#label} string exceeds its protocol bound.`,
      );
    }
    const bytes = this.fixed(length);
    try {
      const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!equalBytes(new TextEncoder().encode(value), bytes)) {
        throw new TypeError('non-canonical utf-8');
      }
      return value;
    } catch (error) {
      throw operationError(this.#errorCode, `The ${this.#label} contains invalid UTF-8.`, error);
    }
  }

  finish(): void {
    if (this.#offset !== this.#bytes.byteLength) {
      throw operationError(
        'invalid-event',
        `The ${this.#label} event has trailing or malformed bytes.`,
      );
    }
  }

  finishZeroPadding(): void {
    if (this.#bytes.subarray(this.#offset).some((byte) => byte !== 0)) {
      throw operationError(
        'invalid-account',
        `The ${this.#label} account has nonzero trailing bytes.`,
      );
    }
    this.#offset = this.#bytes.byteLength;
  }
}

class EventReader extends BorshReader {
  constructor(bytes: Uint8Array, discriminator: Uint8Array, label: string) {
    super(bytes, discriminator, label, 'invalid-event');
  }

  override finish(): void {
    try {
      super.finish();
    } catch (error) {
      throw operationError('invalid-event', 'The simulated operation event is malformed.', error);
    }
  }
}
