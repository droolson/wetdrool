import { AccountRole, address, getProgramDerivedAddress, type AccountMeta } from '@solana/kit';
import {
  deriveRandomWokeName,
  digestSha256,
  utf8,
  type RandomWokeName,
} from '@wokesocial/protocol';

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

export const WOKE_HANDLE_CLAIM_ACCOUNT_SPACE = 156;

export type WokeNameClaimErrorCode = 'alias' | 'invalid-address' | 'invalid-sequence';

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

function claimError(
  code: WokeNameClaimErrorCode,
  message: string,
  cause?: unknown,
): WokeNameClaimError {
  return new WokeNameClaimError(code, message, cause === undefined ? undefined : { cause });
}
