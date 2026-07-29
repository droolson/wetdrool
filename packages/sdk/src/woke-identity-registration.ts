import { getAddressDecoder } from '@solana/kit';

import {
  assertExactWokeAccountCreations,
  assertWokeOperationSimulationBinding,
  buildCreatePrimaryWokeIdentityInstruction,
  decodeExactWokeOperationEvents,
  verifyWokeIdentityAccount,
  type BuiltCreateWokeIdentityInstruction,
  type WOKE_IDENTITY_ACCOUNT_SPACE,
  type WokeIdentityAccountRecord,
  type WokeProgramAccountReader,
  type WokeProgramAccountSnapshot,
} from './identity-publication.js';
import {
  buildClaimRandomWokeNameInstruction,
  verifyRandomWokeNameClaimAccount,
  type BuiltClaimRandomWokeNameInstruction,
  type WOKE_HANDLE_CLAIM_ACCOUNT_SPACE,
  type WokeNameClaimAccountRecord,
} from './woke-name-claim.js';
import type { ValidatedWokeNetContext, WokeInstruction, WokeNetContext } from './woke-payments.js';
import type {
  WokeTransactionSimulationSnapshot,
  WokeTransactionSimulationVerifier,
} from './woke-transaction.js';

const PROTOCOL_VERSION = 1;
const IDENTITY_CREATED_EVENT_DISCRIMINATOR = Uint8Array.of(247, 185, 231, 174, 133, 94, 200, 142);
const HANDLE_CLAIMED_EVENT_DISCRIMINATOR = Uint8Array.of(23, 183, 225, 13, 62, 87, 199, 150);
const ADDRESS_DECODER = getAddressDecoder();

export type WokeIdentityRegistrationErrorCode =
  'account-conflict' | 'invalid-account' | 'invalid-builder' | 'invalid-event' | 'invalid-reader';

export class WokeIdentityRegistrationError extends Error {
  override readonly name = 'WokeIdentityRegistrationError';

  constructor(
    readonly code: WokeIdentityRegistrationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface BuildPrimaryWokeIdentityRegistrationInput {
  readonly payer: string;
  readonly rootAuthority: string;
}

export interface BuiltPrimaryWokeIdentityRegistration {
  readonly kind: 'register-primary-identity-with-random-name';
  readonly context: ValidatedWokeNetContext;
  readonly identity: BuiltCreateWokeIdentityInstruction;
  readonly nameClaim: BuiltClaimRandomWokeNameInstruction;
  readonly instructions: readonly [WokeInstruction, WokeInstruction];
  readonly rentExemptionSpaces: readonly [
    typeof WOKE_IDENTITY_ACCOUNT_SPACE,
    typeof WOKE_HANDLE_CLAIM_ACCOUNT_SPACE,
  ];
}

export type WokeIdentityRegistrationReconciliation =
  | { readonly status: 'absent' }
  | {
      readonly status: 'identity-only';
      readonly identityAccount: WokeProgramAccountSnapshot;
      readonly identity: WokeIdentityAccountRecord;
    }
  | {
      readonly status: 'complete';
      readonly identityAccount: WokeProgramAccountSnapshot;
      readonly identity: WokeIdentityAccountRecord;
      readonly nameClaimAccount: WokeProgramAccountSnapshot;
      readonly nameClaim: WokeNameClaimAccountRecord;
    };

/**
 * Builds two ordered instructions for one atomic Solana transaction:
 * `create_identity`, then the identity-bound anonymous `claim_handle`.
 */
export async function buildPrimaryWokeIdentityRegistration(
  contextInput: WokeNetContext,
  input: BuildPrimaryWokeIdentityRegistrationInput,
): Promise<BuiltPrimaryWokeIdentityRegistration> {
  const identity = await buildCreatePrimaryWokeIdentityInstruction(contextInput, input);
  const nameClaim = await buildClaimRandomWokeNameInstruction(identity.context, {
    originAuthority: identity.originAuthority,
    rootAuthority: identity.rootAuthority,
    identityAddress: identity.identityAddress,
    payer: input.payer,
    expectedIdentitySequence: 0n,
  });
  if (
    !sameContext(identity.context, nameClaim.context) ||
    identity.configAddress !== nameClaim.configAddress ||
    identity.identityAddress !== nameClaim.identityAddress ||
    identity.originAuthority !== nameClaim.originAuthority ||
    identity.rootAuthority !== nameClaim.rootAuthority ||
    identity.payer !== nameClaim.payer
  ) {
    throw registrationError(
      'invalid-builder',
      'Identity and anonymous-name builders do not describe one atomic registration.',
    );
  }
  return Object.freeze({
    kind: 'register-primary-identity-with-random-name',
    context: identity.context,
    identity,
    nameClaim,
    instructions: Object.freeze([identity.instruction, nameClaim.instruction] as const),
    rentExemptionSpaces: Object.freeze([
      identity.rentExemptionSpace,
      nameClaim.rentExemptionSpace,
    ] as const),
  });
}

export function createPrimaryWokeIdentityRegistrationSimulationVerifier(
  built: BuiltPrimaryWokeIdentityRegistration,
): WokeTransactionSimulationVerifier {
  return (simulation) => {
    assertWokeOperationSimulationBinding(built.context, simulation);
    assertExactWokeAccountCreations(simulation, [
      {
        address: built.identity.identityAddress,
        rentPayer: built.identity.payer,
        space: built.identity.rentExemptionSpace,
        outerInstructionIndex: 0,
      },
      {
        address: built.nameClaim.handleClaimAddress,
        rentPayer: built.nameClaim.payer,
        space: built.nameClaim.rentExemptionSpace,
        outerInstructionIndex: 1,
      },
    ]);
    const [identityEvent, handleEvent] = decodeExactWokeOperationEvents(
      simulation.logs,
      built.context.programAddress,
      [
        {
          discriminator: IDENTITY_CREATED_EVENT_DISCRIMINATOR,
          label: 'IdentityCreated',
        },
        {
          discriminator: HANDLE_CLAIMED_EVENT_DISCRIMINATOR,
          label: 'HandleClaimed',
        },
      ],
    );
    verifyIdentityCreatedEvent(built, simulation, requireEvent(identityEvent, 'IdentityCreated'));
    verifyHandleClaimedEvent(built, simulation, requireEvent(handleEvent, 'HandleClaimed'));
  };
}

/** Verifies one current-sequence anonymous-name migration transaction. */
export function createRandomWokeNameClaimSimulationVerifier(
  built: BuiltClaimRandomWokeNameInstruction,
): WokeTransactionSimulationVerifier {
  return (simulation) => {
    assertWokeOperationSimulationBinding(built.context, simulation);
    assertExactWokeAccountCreations(simulation, [
      {
        address: built.handleClaimAddress,
        rentPayer: built.payer,
        space: built.rentExemptionSpace,
        outerInstructionIndex: 0,
      },
    ]);
    const [handleEvent] = decodeExactWokeOperationEvents(
      simulation.logs,
      built.context.programAddress,
      [{ discriminator: HANDLE_CLAIMED_EVENT_DISCRIMINATOR, label: 'HandleClaimed' }],
    );
    verifyHandleClaimedEventForClaim(built, simulation, requireEvent(handleEvent, 'HandleClaimed'));
  };
}

/**
 * Reconciles both deterministic PDAs before a non-idempotent atomic send. A
 * claim without its identity is impossible for this operation and fails
 * closed. `identity-only` identifies a pre-ADR account that needs a separate
 * current-sequence claim rather than recreating the identity.
 */
export async function reconcilePrimaryWokeIdentityRegistration(
  built: BuiltPrimaryWokeIdentityRegistration,
  reader: WokeProgramAccountReader,
): Promise<WokeIdentityRegistrationReconciliation> {
  assertReader(reader);
  const [identityAccount, nameClaimAccount] = await Promise.all([
    reader.readAccount(accountRequest(built, built.identity.identityAddress)),
    reader.readAccount(accountRequest(built, built.nameClaim.handleClaimAddress)),
  ]);
  if (identityAccount === null && nameClaimAccount === null) return { status: 'absent' };
  if (identityAccount === null) {
    throw registrationError(
      'account-conflict',
      'The anonymous HandleClaim exists without its deterministic Identity account.',
    );
  }
  const identity = verifyWokeIdentityAccount(built.identity, identityAccount);
  if (nameClaimAccount === null) {
    return { status: 'identity-only', identityAccount, identity };
  }
  const nameClaim = verifyRandomWokeNameClaimAccount(
    built.nameClaim,
    nameClaimAccount,
    'processed',
  );
  assertRegistrationBinding(built, identity, nameClaim);
  return {
    status: 'complete',
    identityAccount,
    identity,
    nameClaimAccount,
    nameClaim,
  };
}

export function verifyFinalizedPrimaryWokeIdentityRegistration(
  built: BuiltPrimaryWokeIdentityRegistration,
  identityAccount: WokeProgramAccountSnapshot,
  nameClaimAccount: WokeProgramAccountSnapshot,
): {
  readonly identity: WokeIdentityAccountRecord;
  readonly nameClaim: WokeNameClaimAccountRecord;
} {
  const { identity, nameClaim } = verifyFinalizedPrimaryWokeIdentityNameBinding(
    built,
    identityAccount,
    nameClaimAccount,
  );
  if (
    identity.rootAuthority !== built.identity.rootAuthority ||
    identity.rootRotationCount !== 0n ||
    identity.delegationSequence !== 0n ||
    identity.sequence !== 1n ||
    identity.profileSequence !== 0n ||
    identity.profileManifestUri !== '' ||
    identity.profileUpdatedAtSlot !== 0n ||
    nameClaim.claimedAtSlot !== identity.createdAtSlot
  ) {
    throw registrationError(
      'invalid-account',
      'The finalized identity and anonymous-name claim are not one fresh atomic registration.',
    );
  }
  return Object.freeze({ identity, nameClaim });
}

/** Verifies the durable name binding after later posts, profiles, or root rotations. */
export function verifyFinalizedPrimaryWokeIdentityNameBinding(
  built: BuiltPrimaryWokeIdentityRegistration,
  identityAccount: WokeProgramAccountSnapshot,
  nameClaimAccount: WokeProgramAccountSnapshot,
): {
  readonly identity: WokeIdentityAccountRecord;
  readonly nameClaim: WokeNameClaimAccountRecord;
} {
  const identity = verifyWokeIdentityAccount(built.identity, identityAccount, 'finalized');
  const nameClaim = verifyRandomWokeNameClaimAccount(
    built.nameClaim,
    nameClaimAccount,
    'finalized',
  );
  assertRegistrationBinding(built, identity, nameClaim);
  return Object.freeze({ identity, nameClaim });
}

function verifyIdentityCreatedEvent(
  built: BuiltPrimaryWokeIdentityRegistration,
  simulation: WokeTransactionSimulationSnapshot,
  bytes: Uint8Array,
): void {
  const reader = new RegistrationEventReader(bytes, IDENTITY_CREATED_EVENT_DISCRIMINATOR);
  const version = reader.u16();
  const config = reader.address();
  const identity = reader.address();
  const rootAuthority = reader.address();
  const nonce = reader.fixed(16);
  const slot = reader.u64();
  reader.finish();
  if (
    version !== PROTOCOL_VERSION ||
    config !== built.identity.configAddress ||
    identity !== built.identity.identityAddress ||
    rootAuthority !== built.identity.rootAuthority ||
    !equalBytes(nonce, built.identity.identityNonce) ||
    slot !== simulation.contextSlot
  ) {
    throw registrationError(
      'invalid-event',
      'The simulated IdentityCreated event differs from the approved registration.',
    );
  }
}

function verifyHandleClaimedEvent(
  built: BuiltPrimaryWokeIdentityRegistration,
  simulation: WokeTransactionSimulationSnapshot,
  bytes: Uint8Array,
): void {
  verifyHandleClaimedEventForClaim(built.nameClaim, simulation, bytes);
}

function verifyHandleClaimedEventForClaim(
  built: BuiltClaimRandomWokeNameInstruction,
  simulation: WokeTransactionSimulationSnapshot,
  bytes: Uint8Array,
): void {
  const reader = new RegistrationEventReader(bytes, HANDLE_CLAIMED_EVENT_DISCRIMINATOR);
  const version = reader.u16();
  const config = reader.address();
  const handleClaim = reader.address();
  const identity = reader.address();
  const authority = reader.address();
  const identitySequence = reader.u64();
  const handleHash = reader.fixed(32);
  const handle = reader.string(30);
  const slot = reader.u64();
  reader.finish();
  if (
    version !== PROTOCOL_VERSION ||
    config !== built.configAddress ||
    handleClaim !== built.handleClaimAddress ||
    identity !== built.identityAddress ||
    authority !== built.rootAuthority ||
    identitySequence !== built.expectedIdentitySequence + 1n ||
    !equalBytes(handleHash, built.handleHash) ||
    handle !== built.randomName.handle ||
    slot !== simulation.contextSlot
  ) {
    throw registrationError(
      'invalid-event',
      'The simulated HandleClaimed event differs from the approved registration.',
    );
  }
}

function assertRegistrationBinding(
  built: BuiltPrimaryWokeIdentityRegistration,
  identity: WokeIdentityAccountRecord,
  nameClaim: WokeNameClaimAccountRecord,
): void {
  if (
    !identity.active ||
    nameClaim.identity !== built.identity.identityAddress ||
    nameClaim.identitySequence > identity.sequence ||
    nameClaim.claimedAtSlot !== identity.createdAtSlot
  ) {
    throw registrationError(
      'invalid-account',
      'The identity and anonymous-name claim do not preserve one valid primary binding.',
    );
  }
}

function accountRequest(
  built: BuiltPrimaryWokeIdentityRegistration,
  accountAddress: string,
): {
  readonly endpoint: string;
  readonly genesisHash: string;
  readonly programAddress: string;
  readonly address: string;
  readonly commitment: 'processed';
} {
  return {
    endpoint: built.context.endpoint,
    genesisHash: built.context.genesisHash,
    programAddress: built.context.programAddress,
    address: accountAddress,
    commitment: 'processed',
  };
}

function assertReader(reader: WokeProgramAccountReader): void {
  if (reader === null || typeof reader !== 'object' || typeof reader.readAccount !== 'function') {
    throw registrationError('invalid-reader', 'A WokeNet program account reader is required.');
  }
}

function sameContext(left: ValidatedWokeNetContext, right: ValidatedWokeNetContext): boolean {
  return (
    left.endpoint === right.endpoint &&
    left.genesisHash === right.genesisHash &&
    left.programAddress === right.programAddress
  );
}

function requireEvent(bytes: Uint8Array | undefined, label: string): Uint8Array {
  if (bytes === undefined) {
    throw registrationError('invalid-event', `The ${label} event is missing.`);
  }
  return bytes;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((byte, index) => byte === right[index]);
}

class RegistrationEventReader {
  #offset = 0;

  constructor(
    private readonly bytes: Uint8Array,
    discriminator: Uint8Array,
  ) {
    if (!equalBytes(this.fixed(discriminator.byteLength), discriminator)) {
      throw registrationError('invalid-event', 'The registration event discriminator is invalid.');
    }
  }

  u16(): number {
    const bytes = this.fixed(2);
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(0, true);
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
      throw registrationError('invalid-event', 'The registration event is truncated.');
    }
    const value = this.bytes.slice(this.#offset, this.#offset + length);
    this.#offset += length;
    return value;
  }

  string(maxBytes: number): string {
    const length = this.u32();
    if (length > maxBytes) {
      throw registrationError('invalid-event', 'The registration event string is oversized.');
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(this.fixed(length));
    } catch (error) {
      throw registrationError(
        'invalid-event',
        'The registration event string is not valid UTF-8.',
        error,
      );
    }
  }

  finish(): void {
    if (this.#offset !== this.bytes.byteLength) {
      throw registrationError('invalid-event', 'The registration event has trailing bytes.');
    }
  }
}

function registrationError(
  code: WokeIdentityRegistrationErrorCode,
  message: string,
  cause?: unknown,
): WokeIdentityRegistrationError {
  return new WokeIdentityRegistrationError(
    code,
    message,
    cause === undefined ? undefined : { cause },
  );
}
