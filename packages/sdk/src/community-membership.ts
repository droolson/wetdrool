import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type AccountMeta,
} from '@solana/kit';

import { extractWokeManifestCid } from './manifest-uri.js';
import {
  createDroolNetContext,
  deriveWokeProtocolConfigAddress,
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  type ValidatedDroolNetContext,
  type WokeInstruction,
  type DroolNetContext,
} from './woke-payments.js';

const U64_MAX = 18_446_744_073_709_551_615n;
const MANIFEST_HASH_BYTES = 32;
const MAX_MANIFEST_URI_BYTES = 200;

const PDA_PREFIX = ascii('wetdrool');
const PDA_VERSION = Uint8Array.of(1);
const MEMBERSHIP_SEED = ascii('membership');
const ADDRESS_ENCODER = getAddressEncoder();

const JOIN_COMMUNITY_DISCRIMINATOR = Uint8Array.of(252, 106, 147, 30, 134, 74, 28, 232);
const LEAVE_COMMUNITY_DISCRIMINATOR = Uint8Array.of(218, 140, 41, 66, 8, 140, 33, 161);
const MODERATE_COMMUNITY_MEMBERSHIP_DISCRIMINATOR = Uint8Array.of(
  191,
  194,
  181,
  172,
  173,
  36,
  64,
  195,
);

/** Anchor account allocation for the predeployment membership-v2 layout. */
export const WOKE_COMMUNITY_MEMBERSHIP_ACCOUNT_SPACE = 426;

export type WokeCommunityMembershipAction = 'join' | 'leave' | 'remove' | 'ban';
export type WokeCommunityMembershipState = 'active' | 'left' | 'removed' | 'banned';

export type WokeMembershipErrorCode =
  'alias' | 'invalid-address' | 'invalid-action' | 'invalid-manifest' | 'invalid-sequence';

export class WokeMembershipError extends Error {
  override readonly name = 'WokeMembershipError';

  constructor(
    readonly code: WokeMembershipErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface CommunityMembershipActionCoordinates {
  /** Current member Identity.sequence; the program advances it for join/leave. */
  readonly expectedMemberIdentitySequence: bigint;
  /** Current membership state sequence, or zero before the first action. */
  readonly expectedMembershipStateSequence: bigint;
  /** Exact community policy snapshot reviewed by the signer. */
  readonly expectedMembershipPolicySequence: bigint;
  /** Exact community-wide membership transition snapshot reviewed by the signer. */
  readonly expectedCommunityMembershipSequence: bigint;
}

export interface CommunityMembershipManifestReference {
  readonly manifestHash: Uint8Array;
  readonly manifestUri: string;
}

export interface BuildMemberCommunityActionInput
  extends CommunityMembershipActionCoordinates, CommunityMembershipManifestReference {
  readonly authority: string;
  readonly community: string;
  readonly delegation?: string;
  readonly memberIdentity: string;
}

export interface BuildJoinCommunityInput extends BuildMemberCommunityActionInput {
  /** Pays rent only when the deterministic membership PDA does not exist yet. */
  readonly payer: string;
}

export interface BuildModerateCommunityMembershipInput
  extends
    Omit<CommunityMembershipActionCoordinates, 'expectedMemberIdentitySequence'>,
    CommunityMembershipManifestReference {
  readonly action: 'remove' | 'ban';
  readonly authority: string;
  readonly community: string;
  readonly creatorIdentity: string;
  readonly delegation?: string;
  readonly expectedCreatorIdentitySequence: bigint;
  readonly memberIdentity: string;
}

export interface BuiltWokeCommunityMembershipInstruction {
  readonly action: WokeCommunityMembershipAction;
  readonly expectedState: WokeCommunityMembershipState;
  readonly instruction: WokeInstruction;
  readonly memberIdentity: string;
  readonly membershipAddress: string;
}

export async function deriveWokeCommunityMembershipAddress(
  contextInput: DroolNetContext,
  communityInput: string,
  memberIdentityInput: string,
): Promise<string> {
  const context = createDroolNetContext(contextInput);
  const community = parseAddress(communityInput, 'community');
  const memberIdentity = parseAddress(memberIdentityInput, 'member identity');
  assertNotProtocolProgram(context, [
    ['community', community],
    ['member identity', memberIdentity],
  ]);
  const [membershipAddress] = await getProgramDerivedAddress({
    programAddress: address(context.programAddress),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      MEMBERSHIP_SEED,
      addressBytes(community),
      addressBytes(memberIdentity),
    ],
  });
  return membershipAddress;
}

/**
 * Builds the member-authorized open-community join instruction. The signed
 * manifest must already exist at `manifestUri`; this function never uploads,
 * signs, submits, or claims finality.
 */
export async function buildJoinCommunityInstruction(
  contextInput: DroolNetContext,
  input: BuildJoinCommunityInput,
): Promise<BuiltWokeCommunityMembershipInstruction> {
  const context = createDroolNetContext(contextInput);
  const parsed = await parseMemberAction(context, input);
  const payer = parseAddress(input.payer, 'membership rent payer');
  assertNotProtocolProgram(context, [['membership rent payer', payer]]);
  assertDistinctProtocolAccounts([
    parsed.config,
    parsed.community,
    parsed.memberIdentity,
    parsed.membershipAddress,
  ]);
  assertSignerDoesNotAliasProtocolState(parsed.authority, parsed);
  assertPayerDoesNotAliasProtocolState(payer, parsed);

  return Object.freeze({
    action: 'join',
    expectedState: 'active',
    instruction: instruction(
      context,
      [
        meta(parsed.config, AccountRole.WRITABLE),
        meta(parsed.community, AccountRole.WRITABLE),
        meta(parsed.memberIdentity, AccountRole.WRITABLE),
        meta(parsed.membershipAddress, AccountRole.WRITABLE),
        meta(parsed.authority, AccountRole.READONLY_SIGNER),
        meta(payer, AccountRole.WRITABLE_SIGNER),
        meta(WOKENET_SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
        optionalDelegationMeta(context, parsed.delegation),
      ],
      membershipActionData(JOIN_COMMUNITY_DISCRIMINATOR, parsed),
    ),
    memberIdentity: parsed.memberIdentity,
    membershipAddress: parsed.membershipAddress,
  });
}

/**
 * Builds a member-authorized withdrawal. It cannot create an account and
 * therefore carries neither a payer nor the System Program.
 */
export async function buildLeaveCommunityInstruction(
  contextInput: DroolNetContext,
  input: BuildMemberCommunityActionInput,
): Promise<BuiltWokeCommunityMembershipInstruction> {
  const context = createDroolNetContext(contextInput);
  const parsed = await parseMemberAction(context, input);
  assertDistinctProtocolAccounts([
    parsed.config,
    parsed.community,
    parsed.memberIdentity,
    parsed.membershipAddress,
  ]);
  assertSignerDoesNotAliasProtocolState(parsed.authority, parsed);

  return Object.freeze({
    action: 'leave',
    expectedState: 'left',
    instruction: instruction(
      context,
      [
        meta(parsed.config, AccountRole.READONLY),
        meta(parsed.community, AccountRole.WRITABLE),
        meta(parsed.memberIdentity, AccountRole.WRITABLE),
        meta(parsed.membershipAddress, AccountRole.WRITABLE),
        meta(parsed.authority, AccountRole.READONLY_SIGNER),
        optionalDelegationMeta(context, parsed.delegation),
      ],
      membershipActionData(LEAVE_COMMUNITY_DISCRIMINATOR, parsed),
    ),
    memberIdentity: parsed.memberIdentity,
    membershipAddress: parsed.membershipAddress,
  });
}

/**
 * Builds creator-identity moderation. Only remove/ban are representable here;
 * a community authority cannot manufacture a member's join or withdrawal.
 */
export async function buildModerateCommunityMembershipInstruction(
  contextInput: DroolNetContext,
  input: BuildModerateCommunityMembershipInput,
): Promise<BuiltWokeCommunityMembershipInstruction> {
  const context = createDroolNetContext(contextInput);
  if (input.action !== 'remove' && input.action !== 'ban') {
    throw new WokeMembershipError(
      'invalid-action',
      'Community moderation can only remove or ban a membership.',
    );
  }
  const config = await deriveWokeProtocolConfigAddress(context);
  const community = parseAddress(input.community, 'community');
  const creatorIdentity = parseAddress(input.creatorIdentity, 'community creator identity');
  const memberIdentity = parseAddress(input.memberIdentity, 'member identity');
  if (creatorIdentity === memberIdentity) {
    throw new WokeMembershipError(
      'alias',
      'A community creator cannot moderate their own membership through this instruction.',
    );
  }
  const authority = parseAddress(input.authority, 'community moderation authority');
  const delegation = parseOptionalAddress(input.delegation, 'community authority delegation');
  const membershipAddress = await deriveWokeCommunityMembershipAddress(
    context,
    community,
    memberIdentity,
  );
  const manifest = parseManifest(input);
  const expectedCreatorIdentitySequence = parseIncrementableU64(
    input.expectedCreatorIdentitySequence,
    'expected creator identity sequence',
  );
  const expectedMembershipStateSequence = parseIncrementableU64(
    input.expectedMembershipStateSequence,
    'expected membership state sequence',
  );
  const expectedMembershipPolicySequence = parsePositiveU64(
    input.expectedMembershipPolicySequence,
    'expected membership policy sequence',
  );
  const expectedCommunityMembershipSequence = parseIncrementableU64(
    input.expectedCommunityMembershipSequence,
    'expected community membership sequence',
  );
  const parsed = {
    authority,
    community,
    config,
    creatorIdentity,
    delegation,
    memberIdentity,
    membershipAddress,
  };
  assertNotProtocolProgram(context, [
    ['community creator identity', creatorIdentity],
    ['community moderation authority', authority],
    ...(delegation === undefined
      ? []
      : ([['community authority delegation', delegation]] as const)),
  ]);
  assertDistinctProtocolAccounts([
    config,
    community,
    creatorIdentity,
    memberIdentity,
    membershipAddress,
  ]);
  assertSignerDoesNotAliasProtocolState(authority, parsed);
  if (
    delegation !== undefined &&
    [
      config,
      community,
      creatorIdentity,
      memberIdentity,
      membershipAddress,
      WOKENET_SYSTEM_PROGRAM_ADDRESS,
      context.programAddress,
    ].includes(delegation)
  ) {
    throw new WokeMembershipError(
      'alias',
      'The community authority delegation cannot alias a protocol account.',
    );
  }

  const actionWireValue = input.action === 'remove' ? 2 : 3;
  const data = new BorshWriter(MODERATE_COMMUNITY_MEMBERSHIP_DISCRIMINATOR)
    .u64(expectedCreatorIdentitySequence)
    .u64(expectedMembershipStateSequence)
    .u64(expectedMembershipPolicySequence)
    .u64(expectedCommunityMembershipSequence)
    .u8(actionWireValue)
    .fixed(manifest.hash)
    .string(manifest.uri)
    .finish();

  return Object.freeze({
    action: input.action,
    expectedState: input.action === 'remove' ? 'removed' : 'banned',
    instruction: instruction(
      context,
      [
        meta(config, AccountRole.READONLY),
        meta(creatorIdentity, AccountRole.WRITABLE),
        meta(community, AccountRole.WRITABLE),
        meta(memberIdentity, AccountRole.READONLY),
        meta(membershipAddress, AccountRole.WRITABLE),
        meta(authority, AccountRole.READONLY_SIGNER),
        optionalDelegationMeta(context, delegation),
      ],
      data,
    ),
    memberIdentity,
    membershipAddress,
  });
}

interface ParsedMemberAction extends CommunityMembershipActionCoordinates {
  readonly authority: string;
  readonly community: string;
  readonly config: string;
  readonly delegation: string | undefined;
  readonly manifestHash: Uint8Array;
  readonly manifestUri: string;
  readonly memberIdentity: string;
  readonly membershipAddress: string;
}

async function parseMemberAction(
  context: ValidatedDroolNetContext,
  input: BuildMemberCommunityActionInput,
): Promise<ParsedMemberAction> {
  const config = await deriveWokeProtocolConfigAddress(context);
  const community = parseAddress(input.community, 'community');
  const memberIdentity = parseAddress(input.memberIdentity, 'member identity');
  const authority = parseAddress(input.authority, 'member authority');
  const delegation = parseOptionalAddress(input.delegation, 'member delegation');
  const membershipAddress = await deriveWokeCommunityMembershipAddress(
    context,
    community,
    memberIdentity,
  );
  const manifest = parseManifest(input);
  const parsed = {
    authority,
    community,
    config,
    delegation,
    manifestHash: manifest.hash,
    manifestUri: manifest.uri,
    memberIdentity,
    membershipAddress,
    expectedMemberIdentitySequence: parseIncrementableU64(
      input.expectedMemberIdentitySequence,
      'expected member identity sequence',
    ),
    expectedMembershipStateSequence: parseIncrementableU64(
      input.expectedMembershipStateSequence,
      'expected membership state sequence',
    ),
    expectedMembershipPolicySequence: parsePositiveU64(
      input.expectedMembershipPolicySequence,
      'expected membership policy sequence',
    ),
    expectedCommunityMembershipSequence: parseIncrementableU64(
      input.expectedCommunityMembershipSequence,
      'expected community membership sequence',
    ),
  };
  assertNotProtocolProgram(context, [
    ['member authority', authority],
    ...(delegation === undefined ? [] : ([['member delegation', delegation]] as const)),
  ]);
  if (
    delegation !== undefined &&
    [
      config,
      community,
      memberIdentity,
      membershipAddress,
      WOKENET_SYSTEM_PROGRAM_ADDRESS,
      context.programAddress,
    ].includes(delegation)
  ) {
    throw new WokeMembershipError(
      'alias',
      'The member delegation cannot alias a protocol account.',
    );
  }
  return parsed;
}

function membershipActionData(discriminator: Uint8Array, input: ParsedMemberAction): Uint8Array {
  return new BorshWriter(discriminator)
    .u64(input.expectedMemberIdentitySequence)
    .u64(input.expectedMembershipStateSequence)
    .u64(input.expectedMembershipPolicySequence)
    .u64(input.expectedCommunityMembershipSequence)
    .fixed(input.manifestHash)
    .string(input.manifestUri)
    .finish();
}

function parseManifest(input: CommunityMembershipManifestReference): {
  readonly hash: Uint8Array;
  readonly uri: string;
} {
  if (
    !(input.manifestHash instanceof Uint8Array) ||
    input.manifestHash.byteLength !== MANIFEST_HASH_BYTES ||
    input.manifestHash.every((byte) => byte === 0)
  ) {
    throw new WokeMembershipError(
      'invalid-manifest',
      'A membership manifest hash must contain exactly 32 nonzero bytes.',
    );
  }
  if (
    typeof input.manifestUri !== 'string' ||
    new TextEncoder().encode(input.manifestUri).byteLength > MAX_MANIFEST_URI_BYTES ||
    extractWokeManifestCid(input.manifestUri) === undefined
  ) {
    throw new WokeMembershipError(
      'invalid-manifest',
      'The membership manifest URI does not satisfy the bounded WetDrool URI policy.',
    );
  }
  return {
    hash: Uint8Array.from(input.manifestHash),
    uri: input.manifestUri,
  };
}

function parseAddress(value: string, label: string): string {
  try {
    const parsed = address(value);
    if (parsed === WOKENET_SYSTEM_PROGRAM_ADDRESS) throw new TypeError('default address');
    return parsed;
  } catch (error) {
    throw new WokeMembershipError(
      'invalid-address',
      `The ${label} must be a non-default canonical Solana address.`,
      { cause: error },
    );
  }
}

function parseOptionalAddress(value: string | undefined, label: string): string | undefined {
  return value === undefined ? undefined : parseAddress(value, label);
}

function parseIncrementableU64(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value >= U64_MAX) {
    throw new WokeMembershipError(
      'invalid-sequence',
      `The ${label} must fit the incrementable unsigned 64-bit range.`,
    );
  }
  return value;
}

function parsePositiveU64(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value <= 0n || value > U64_MAX) {
    throw new WokeMembershipError(
      'invalid-sequence',
      `The ${label} must fit the positive unsigned 64-bit range.`,
    );
  }
  return value;
}

function assertDistinctProtocolAccounts(accounts: readonly string[]): void {
  if (new Set(accounts).size !== accounts.length) {
    throw new WokeMembershipError(
      'alias',
      'Community membership protocol accounts must be pairwise distinct.',
    );
  }
}

function assertNotProtocolProgram(
  context: ValidatedDroolNetContext,
  accounts: readonly (readonly [label: string, address: string])[],
): void {
  const aliased = accounts.find(([, candidate]) => candidate === context.programAddress);
  if (aliased !== undefined) {
    throw new WokeMembershipError(
      'alias',
      `The ${aliased[0]} cannot alias the WetDrool protocol program.`,
    );
  }
}

function assertSignerDoesNotAliasProtocolState(
  signer: string,
  input: {
    readonly community: string;
    readonly config: string;
    readonly memberIdentity: string;
    readonly membershipAddress: string;
    readonly creatorIdentity?: string;
  },
): void {
  if (
    [
      input.config,
      input.community,
      input.memberIdentity,
      input.membershipAddress,
      ...(input.creatorIdentity === undefined ? [] : [input.creatorIdentity]),
    ].includes(signer)
  ) {
    throw new WokeMembershipError(
      'alias',
      'The signing authority cannot alias a community membership protocol account.',
    );
  }
}

function assertPayerDoesNotAliasProtocolState(
  payer: string,
  input: {
    readonly community: string;
    readonly config: string;
    readonly memberIdentity: string;
    readonly membershipAddress: string;
    readonly creatorIdentity?: string;
  },
): void {
  if (
    [
      input.config,
      input.community,
      input.memberIdentity,
      input.membershipAddress,
      ...(input.creatorIdentity === undefined ? [] : [input.creatorIdentity]),
    ].includes(payer)
  ) {
    throw new WokeMembershipError(
      'alias',
      'The rent payer cannot alias a community membership protocol account.',
    );
  }
}

function optionalDelegationMeta(
  context: ValidatedDroolNetContext,
  delegation: string | undefined,
): AccountMeta {
  return meta(delegation ?? context.programAddress, AccountRole.READONLY);
}

function instruction(
  context: ValidatedDroolNetContext,
  accounts: readonly AccountMeta[],
  data: Uint8Array,
): WokeInstruction {
  return {
    programAddress: address(context.programAddress),
    accounts,
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

class BorshWriter {
  readonly #bytes: number[];

  constructor(prefix: Uint8Array) {
    this.#bytes = [...prefix];
  }

  fixed(value: Uint8Array): this {
    this.#bytes.push(...value);
    return this;
  }

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new WokeMembershipError('invalid-action', 'A membership action wire value is invalid.');
    }
    this.#bytes.push(value);
    return this;
  }

  u32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new WokeMembershipError(
        'invalid-manifest',
        'A membership manifest wire length is invalid.',
      );
    }
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
