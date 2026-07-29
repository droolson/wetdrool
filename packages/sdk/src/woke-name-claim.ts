import {
  AccountRole,
  address,
  getAddressDecoder,
  getProgramDerivedAddress,
  type AccountMeta,
} from '@solana/kit';
import {
  deriveRandomWokeName,
  digestSha256,
  utf8,
  wokeHandleSchema,
  type RandomWokeName,
} from '@wokesocial/protocol';

import type { WokeAccountCommitment, WokeProgramAccountSnapshot } from './identity-publication.js';
import {
  createWokeNetContext,
  deriveWokeProtocolConfigAddress,
  WOKENET_SYSTEM_PROGRAM_ADDRESS,
  type ValidatedWokeNetContext,
  type WokeInstruction,
  type WokeNetContext,
} from './woke-payments.js';

const ACCOUNT_VERSION = 1;
const U64_MAX = 18_446_744_073_709_551_615n;
const PDA_PREFIX = utf8('wokesocial');
const PDA_VERSION = Uint8Array.of(ACCOUNT_VERSION);
const HANDLE_SEED = utf8('handle');
const CLAIM_HANDLE_DISCRIMINATOR = Uint8Array.of(93, 142, 47, 111, 164, 134, 99, 181);
const HANDLE_CLAIM_ACCOUNT_DISCRIMINATOR = Uint8Array.of(148, 215, 248, 53, 11, 234, 115, 190);
const ADDRESS_DECODER = getAddressDecoder();

export const WOKE_HANDLE_CLAIM_ACCOUNT_SPACE = 156;

export type WokeNameClaimErrorCode =
  'alias' | 'invalid-account' | 'invalid-address' | 'invalid-sequence';

export class WokeNameClaimError extends Error {
  override readonly name = 'WokeNameClaimError';

  constructor(
    readonly code: WokeNameClaimErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface BuildClaimRandomWokeNameInput {
  /** Immutable first root stored as `Identity.origin_authority`. */
  readonly originAuthority: string;
  /** Current authority; it may differ after rotation or guardian recovery. */
  readonly rootAuthority: string;
  readonly identityAddress: string;
  readonly payer: string;
  readonly expectedIdentitySequence: bigint;
}

export interface BuiltClaimRandomWokeNameInstruction {
  readonly kind: 'claim-random-woke-name';
  readonly context: ValidatedWokeNetContext;
  readonly configAddress: string;
  readonly identityAddress: string;
  readonly originAuthority: string;
  readonly rootAuthority: string;
  readonly payer: string;
  readonly expectedIdentitySequence: bigint;
  readonly randomName: RandomWokeName;
  readonly handleHash: Uint8Array;
  readonly handleClaimAddress: string;
  readonly handleClaimBump: number;
  readonly rentExemptionSpace: typeof WOKE_HANDLE_CLAIM_ACCOUNT_SPACE;
  readonly instruction: WokeInstruction;
}

export interface WokeNameClaimAccountRecord {
  readonly version: number;
  readonly config: string;
  readonly identity: string;
  readonly handleHash: Uint8Array;
  readonly handle: string;
  readonly identitySequence: bigint;
  readonly claimedAtSlot: bigint;
  readonly bump: number;
}

/**
 * Builds the exact v1 `claim_handle` instruction for the reserved anonymous
 * namespace. The program independently re-derives the name from the Identity's
 * immutable origin authority, so an observer cannot claim another account's
 * `anon_…` value.
 */
export async function buildClaimRandomWokeNameInstruction(
  contextInput: WokeNetContext,
  input: BuildClaimRandomWokeNameInput,
): Promise<BuiltClaimRandomWokeNameInstruction> {
  const context = createWokeNetContext(contextInput);
  const configAddress = await deriveWokeProtocolConfigAddress(context);
  const originAuthority = parseAddress(input.originAuthority, 'identity origin authority');
  const rootAuthority = parseAddress(input.rootAuthority, 'current identity root authority');
  const identityAddress = parseAddress(input.identityAddress, 'identity account');
  const payer = parseAddress(input.payer, 'handle-claim rent payer');
  const expectedIdentitySequence = parseIncrementableU64(input.expectedIdentitySequence);
  const randomName = deriveRandomWokeName(originAuthority);
  const handleBytes = utf8(randomName.handle);
  const handleHash = digestSha256(handleBytes);
  const [handleClaimAddress, handleClaimBump] = await getProgramDerivedAddress({
    programAddress: address(context.programAddress),
    seeds: [PDA_PREFIX, PDA_VERSION, HANDLE_SEED, handleHash],
  });

  const protocolAccounts = [
    context.programAddress,
    configAddress,
    identityAddress,
    handleClaimAddress,
  ];
  if (
    new Set(protocolAccounts).size !== protocolAccounts.length ||
    protocolAccounts.includes(rootAuthority) ||
    protocolAccounts.includes(payer)
  ) {
    throw claimError(
      'alias',
      'Name-claim state, authority, and payer accounts must not alias one another.',
    );
  }

  const data = concat(
    CLAIM_HANDLE_DISCRIMINATOR,
    u64(expectedIdentitySequence),
    handleHash,
    u32(handleBytes.byteLength),
    handleBytes,
  );
  return Object.freeze({
    kind: 'claim-random-woke-name',
    context,
    configAddress,
    identityAddress,
    originAuthority,
    rootAuthority,
    payer,
    expectedIdentitySequence,
    randomName,
    handleHash: Uint8Array.from(handleHash),
    handleClaimAddress,
    handleClaimBump,
    rentExemptionSpace: WOKE_HANDLE_CLAIM_ACCOUNT_SPACE,
    instruction: Object.freeze({
      programAddress: address(context.programAddress),
      accounts: Object.freeze([
        meta(configAddress, AccountRole.READONLY),
        meta(identityAddress, AccountRole.WRITABLE),
        meta(handleClaimAddress, AccountRole.WRITABLE),
        meta(rootAuthority, AccountRole.READONLY_SIGNER),
        meta(payer, AccountRole.WRITABLE_SIGNER),
        meta(WOKENET_SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
      ]),
      data,
    }),
  });
}

export function decodeWokeNameClaimAccount(dataInput: Uint8Array): WokeNameClaimAccountRecord {
  if (
    !(dataInput instanceof Uint8Array) ||
    dataInput.byteLength !== WOKE_HANDLE_CLAIM_ACCOUNT_SPACE
  ) {
    throw claimError(
      'invalid-account',
      `A HandleClaim account must contain exactly ${String(WOKE_HANDLE_CLAIM_ACCOUNT_SPACE)} bytes.`,
    );
  }
  const reader = new ClaimAccountReader(Uint8Array.from(dataInput));
  reader.discriminator(HANDLE_CLAIM_ACCOUNT_DISCRIMINATOR);
  const record: WokeNameClaimAccountRecord = {
    version: reader.u8(),
    config: reader.address(),
    identity: reader.address(),
    handleHash: reader.fixed(32),
    handle: reader.string(30),
    identitySequence: reader.u64(),
    claimedAtSlot: reader.u64(),
    bump: reader.u8(),
  };
  reader.finishZeroPadding();
  if (
    record.version !== ACCOUNT_VERSION ||
    record.config === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    record.identity === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    record.identitySequence === 0n ||
    !wokeHandleSchema.safeParse(record.handle).success ||
    !equalBytes(record.handleHash, digestSha256(utf8(record.handle)))
  ) {
    throw claimError('invalid-account', 'The HandleClaim account contains invalid protocol state.');
  }
  return record;
}

export function verifyRandomWokeNameClaimAccount(
  built: BuiltClaimRandomWokeNameInstruction,
  account: WokeProgramAccountSnapshot,
  minimumCommitment: WokeAccountCommitment = 'finalized',
): WokeNameClaimAccountRecord {
  if (
    account === null ||
    typeof account !== 'object' ||
    parseAccountAddress(account.address) !== built.handleClaimAddress ||
    parseAccountAddress(account.owner) !== built.context.programAddress ||
    commitmentRank(account.commitment) < commitmentRank(minimumCommitment) ||
    typeof account.slot !== 'bigint' ||
    account.slot < 0n ||
    account.slot > U64_MAX
  ) {
    throw claimError(
      'invalid-account',
      'The HandleClaim envelope has the wrong address, owner, commitment, or slot.',
    );
  }
  const claim = decodeWokeNameClaimAccount(account.data);
  if (
    claim.config !== built.configAddress ||
    claim.identity !== built.identityAddress ||
    claim.handle !== built.randomName.handle ||
    !equalBytes(claim.handleHash, built.handleHash) ||
    claim.identitySequence !== built.expectedIdentitySequence + 1n ||
    claim.claimedAtSlot > account.slot ||
    claim.bump !== built.handleClaimBump
  ) {
    throw claimError(
      'invalid-account',
      'The HandleClaim account does not match the approved anonymous-name operation.',
    );
  }
  return claim;
}

function parseAddress(value: string, label: string): string {
  try {
    const parsed = address(value);
    if (parsed === WOKENET_SYSTEM_PROGRAM_ADDRESS) throw new TypeError('default address');
    return parsed;
  } catch (error) {
    throw claimError(
      'invalid-address',
      `The ${label} must be a non-default canonical Solana address.`,
      error,
    );
  }
}

function parseIncrementableU64(value: bigint): bigint {
  if (typeof value !== 'bigint' || value < 0n || value >= U64_MAX) {
    throw claimError(
      'invalid-sequence',
      'The expected identity sequence must fit the incrementable unsigned 64-bit range.',
    );
  }
  return value;
}

function meta(value: string, role: AccountRole): AccountMeta {
  return { address: address(value), role };
}

function u64(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, value, true);
  return bytes;
}

function u32(value: number): Uint8Array {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, true);
  return bytes;
}

function concat(...parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function parseAccountAddress(value: unknown): string {
  if (typeof value !== 'string') {
    throw claimError('invalid-account', 'A HandleClaim account address is malformed.');
  }
  try {
    return address(value);
  } catch (error) {
    throw claimError('invalid-account', 'A HandleClaim account address is malformed.', error);
  }
}

function commitmentRank(value: unknown): number {
  if (value === 'processed') return 0;
  if (value === 'confirmed') return 1;
  if (value === 'finalized') return 2;
  throw claimError('invalid-account', 'The HandleClaim commitment is invalid.');
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

class ClaimAccountReader {
  #offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  discriminator(expected: Uint8Array): void {
    if (!equalBytes(this.fixed(expected.byteLength), expected)) {
      throw claimError('invalid-account', 'The HandleClaim discriminator is invalid.');
    }
  }

  u8(): number {
    return this.fixed(1)[0] ?? 0;
  }

  u32(): number {
    const bytes = this.fixed(4);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
  }

  u64(): bigint {
    const bytes = this.fixed(8);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getBigUint64(0, true);
  }

  address(): string {
    return ADDRESS_DECODER.decode(this.fixed(32));
  }

  fixed(length: number): Uint8Array {
    if (
      !Number.isSafeInteger(length) ||
      length < 0 ||
      this.#offset + length > this.bytes.byteLength
    ) {
      throw claimError('invalid-account', 'The HandleClaim account is truncated.');
    }
    const value = this.bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  string(maxBytes: number): string {
    const length = this.u32();
    if (length > maxBytes) {
      throw claimError('invalid-account', 'The HandleClaim string exceeds its v1 bound.');
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(this.fixed(length));
    } catch (error) {
      throw claimError('invalid-account', 'The HandleClaim string is not valid UTF-8.', error);
    }
  }

  finishZeroPadding(): void {
    if (this.fixed(this.bytes.byteLength - this.#offset).some((byte) => byte !== 0)) {
      throw claimError('invalid-account', 'The HandleClaim account has nonzero trailing bytes.');
    }
  }
}

function claimError(
  code: WokeNameClaimErrorCode,
  message: string,
  cause?: unknown,
): WokeNameClaimError {
  return new WokeNameClaimError(code, message, cause === undefined ? undefined : { cause });
}
