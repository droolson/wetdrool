import {
  AccountRole,
  address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type AccountMeta,
  type Address,
  type Instruction,
} from '@solana/kit';

import { extractWokeManifestCid } from './manifest-uri.js';

const BASIS_POINTS_DENOMINATOR = 10_000n;
const MAX_PROTOCOL_FEE_BPS = 1_000;
const U64_MAX = 18_446_744_073_709_551_615n;
const U128_MAX = 340_282_366_920_938_463_463_374_607_431_768_211_455n;
const I64_MAX = 9_223_372_036_854_775_807n;
const WEEK_SECONDS = 604_800n;
const MAX_SUBSCRIPTION_PREPAY_WEEKS = 52n;
const MAX_ADDITIONAL_PAYMENT_RECIPIENTS = 2;
const ACCOUNT_VERSION = 1;
const PROTOCOL_VERSION = 1;
const NONCE_BYTES = 16;
const HASH_BYTES = 32;

const PDA_PREFIX = ascii('wokesocial');
const PDA_VERSION = Uint8Array.of(ACCOUNT_VERSION);
const CONFIG_SEED = ascii('config');
const IDENTITY_SEED = ascii('identity');
const PAYMENT_CONFIG_SEED = ascii('payment_config');
const SUBSCRIPTION_OFFERING_SEED = ascii('subscription_offering');
const PAYMENT_RECEIPT_SEED = ascii('payment_receipt');
const SUBSCRIPTION_ENTITLEMENT_SEED = ascii('subscription_entitlement');

export const WOKENET_SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111';
export const WOKENET_UPGRADEABLE_LOADER_ADDRESS = 'BPFLoaderUpgradeab1e11111111111111111111111';

const SYSTEM_PROGRAM_ADDRESS = address(WOKENET_SYSTEM_PROGRAM_ADDRESS);
const UPGRADEABLE_LOADER_ADDRESS = address(WOKENET_UPGRADEABLE_LOADER_ADDRESS);
const ADDRESS_ENCODER = getAddressEncoder();

const INITIALIZE_PAYMENT_CONFIG_DISCRIMINATOR = Uint8Array.of(38, 187, 7, 244, 201, 111, 164, 182);
const UPDATE_PAYMENT_CONFIG_DISCRIMINATOR = Uint8Array.of(233, 162, 182, 43, 61, 208, 188, 169);
const ROTATE_PAYMENT_AUTHORITY_DISCRIMINATOR = Uint8Array.of(130, 220, 113, 212, 146, 91, 227, 218);
const CREATE_SUBSCRIPTION_OFFERING_DISCRIMINATOR = Uint8Array.of(
  176,
  121,
  188,
  91,
  87,
  92,
  113,
  216,
);
const RETIRE_SUBSCRIPTION_OFFERING_DISCRIMINATOR = Uint8Array.of(
  207,
  71,
  200,
  23,
  92,
  151,
  101,
  99,
);
const SEND_WOKE_TIP_DISCRIMINATOR = Uint8Array.of(45, 180, 20, 31, 17, 4, 214, 17);
const SETTLE_SUBSCRIPTION_DISCRIMINATOR = Uint8Array.of(140, 212, 22, 211, 219, 187, 4, 131);
const DEACTIVATE_IDENTITY_DISCRIMINATOR = Uint8Array.of(58, 175, 10, 246, 145, 179, 1, 179);

export type WokePaymentErrorCode =
  | 'account-not-found'
  | 'alias'
  | 'amount-out-of-range'
  | 'context-mismatch'
  | 'invalid-address'
  | 'invalid-context'
  | 'invalid-event'
  | 'invalid-fee'
  | 'invalid-proof'
  | 'invalid-recipient'
  | 'invalid-wire-value'
  | 'rounding-underflow'
  | 'simulation-mismatch';

export class WokePaymentError extends Error {
  override readonly name = 'WokePaymentError';

  constructor(
    readonly code: WokePaymentErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * Every legacy settlement operation is explicitly bound to one Solana RPC
 * endpoint, one genesis hash, and one deployed program. There are
 * intentionally no cluster defaults.
 */
export interface WokeNetContext {
  readonly endpoint: string;
  readonly genesisHash: string;
  readonly programAddress: string;
}

export interface ValidatedWokeNetContext extends WokeNetContext {
  readonly endpoint: string;
  readonly genesisHash: string;
  readonly programAddress: string;
}

export function createWokeNetContext(input: WokeNetContext): ValidatedWokeNetContext {
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch (error) {
    throw new WokePaymentError('invalid-context', 'The Solana RPC endpoint is invalid.', {
      cause: error,
    });
  }
  if (
    !['http:', 'https:'].includes(endpoint.protocol) ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.hash !== ''
  ) {
    throw new WokePaymentError(
      'invalid-context',
      'The Solana RPC endpoint must be an HTTP(S) URL without credentials or a fragment.',
    );
  }

  const genesisHash = parseAddress(input.genesisHash, 'WokeNet genesis hash');
  const programAddress = parseAddress(input.programAddress, 'WokeSocial protocol program');
  if (
    genesisHash === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    programAddress === WOKENET_SYSTEM_PROGRAM_ADDRESS ||
    programAddress === WOKENET_UPGRADEABLE_LOADER_ADDRESS
  ) {
    throw new WokePaymentError(
      'invalid-context',
      'The WokeNet genesis hash and program address must be non-default values.',
    );
  }
  return Object.freeze({
    endpoint: endpoint.toString(),
    genesisHash,
    programAddress,
  });
}

export interface WokeRecipientSplitInput {
  readonly recipientIdentity: string;
  readonly destination: string;
  readonly basisPoints: number;
}

export interface WokeNativePaymentInput {
  readonly context: WokeNetContext;
  readonly payerIdentity: string;
  readonly payerAuthority: string;
  readonly feeDestination: string;
  readonly feeBasisPoints: number;
  readonly grossLamports: bigint;
  readonly recipientSplits: readonly WokeRecipientSplitInput[];
}

export interface WokeRecipientAllocation {
  readonly recipientIdentity: string;
  readonly destination: string;
  readonly basisPoints: number;
  readonly lamports: bigint;
}

export interface WokeNativeTransfer {
  readonly kind: 'protocol-fee' | 'recipient';
  readonly source: string;
  readonly destination: string;
  readonly lamports: bigint;
  readonly recipientIdentity?: string;
}

export interface WokeNativePaymentPlan {
  readonly asset: 'SOL';
  readonly context: ValidatedWokeNetContext;
  readonly payerIdentity: string;
  readonly payerAuthority: string;
  readonly feeDestination: string;
  readonly feeBasisPoints: number;
  readonly grossLamports: bigint;
  readonly feeLamports: bigint;
  readonly distributableLamports: bigint;
  readonly recipientAllocations: readonly WokeRecipientAllocation[];
  readonly transfers: readonly WokeNativeTransfer[];
  readonly roundingPolicy: 'largest-remainder-raw-identity-bytes';
}

/**
 * Mirrors `calculate_legacy_lamport_payment_allocation` in the WokeSocial protocol program.
 * All arithmetic is checked in the same unsigned-128 intermediate domain.
 */
export function calculateWokeNativePaymentPlan(
  input: WokeNativePaymentInput,
): WokeNativePaymentPlan {
  const context = createWokeNetContext(input.context);
  const payerIdentity = parseAddress(input.payerIdentity, 'payer identity');
  const payerAuthority = parseAddress(input.payerAuthority, 'payer authority');
  const feeDestination = parseAddress(input.feeDestination, 'fee destination');
  const grossLamports = parsePositiveU64(input.grossLamports, 'gross SOL lamports');
  const feeBasisPoints = parseFeeBasisPoints(input.feeBasisPoints);
  const recipients = parseRecipientSplits(input.recipientSplits);
  assertGlobalPaymentAliases(payerIdentity, payerAuthority, feeDestination, recipients);

  const gross = checkedU128(grossLamports, 'gross SOL lamports');
  const feeNumerator = checkedU128Multiply(gross, BigInt(feeBasisPoints), 'protocol-fee numerator');
  const feeLamports = feeNumerator / BASIS_POINTS_DENOMINATOR;
  const distributableLamports = gross - feeLamports;
  if (distributableLamports < 1n) {
    throw new WokePaymentError(
      'rounding-underflow',
      'The protocol fee leaves no SOL lamports for recipients.',
    );
  }

  const allocations = recipients.map((recipient) => {
    const numerator = checkedU128Multiply(
      distributableLamports,
      BigInt(recipient.basisPoints),
      'recipient allocation numerator',
    );
    return {
      ...recipient,
      lamports: numerator / BASIS_POINTS_DENOMINATOR,
      remainder: numerator % BASIS_POINTS_DENOMINATOR,
    };
  });
  const allocated = allocations.reduce(
    (sum, allocation) => checkedU128Add(sum, allocation.lamports, 'recipient allocation total'),
    0n,
  );
  let residual = distributableLamports - allocated;
  const residualOrder = [...allocations].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    return compareBytes(left.identityBytes, right.identityBytes);
  });
  for (const allocation of residualOrder) {
    if (residual === 0n) {
      break;
    }
    allocation.lamports = checkedU128Add(allocation.lamports, 1n, 'recipient residual allocation');
    residual -= 1n;
  }
  if (residual !== 0n || allocations.some((allocation) => allocation.lamports < 1n)) {
    throw new WokePaymentError(
      'rounding-underflow',
      'The gross amount cannot pay every SOL recipient at least one lamport.',
    );
  }

  const recipientAllocations = allocations.map(
    ({ recipientIdentity, destination, basisPoints, lamports }) => ({
      recipientIdentity,
      destination,
      basisPoints,
      lamports: parseU64(lamports, 'recipient SOL allocation'),
    }),
  );
  const recipientTotal = recipientAllocations.reduce(
    (sum, allocation) => checkedU128Add(sum, allocation.lamports, 'recipient total'),
    0n,
  );
  if (checkedU128Add(feeLamports, recipientTotal, 'payment total') !== grossLamports) {
    throw new WokePaymentError('rounding-underflow', 'The SOL allocation does not conserve value.');
  }

  const transfers: WokeNativeTransfer[] = [];
  if (feeLamports > 0n) {
    transfers.push({
      kind: 'protocol-fee',
      source: payerAuthority,
      destination: feeDestination,
      lamports: parseU64(feeLamports, 'protocol fee'),
    });
  }
  transfers.push(
    ...recipientAllocations.map((allocation): WokeNativeTransfer => ({
      kind: 'recipient',
      source: payerAuthority,
      destination: allocation.destination,
      lamports: allocation.lamports,
      recipientIdentity: allocation.recipientIdentity,
    })),
  );

  return {
    asset: 'SOL',
    context,
    payerIdentity,
    payerAuthority,
    feeDestination,
    feeBasisPoints,
    grossLamports,
    feeLamports: parseU64(feeLamports, 'protocol fee'),
    distributableLamports: parseU64(distributableLamports, 'distributable amount'),
    recipientAllocations,
    transfers,
    roundingPolicy: 'largest-remainder-raw-identity-bytes',
  };
}

export async function deriveWokeProtocolConfigAddress(context: WokeNetContext): Promise<string> {
  return (await derivePda(context, [PDA_PREFIX, PDA_VERSION, CONFIG_SEED])).address;
}

export async function deriveWokePaymentConfigAddress(context: WokeNetContext): Promise<string> {
  return (await derivePda(context, [PDA_PREFIX, PDA_VERSION, PAYMENT_CONFIG_SEED])).address;
}

export async function deriveWokeIdentityAddress(
  context: WokeNetContext,
  originAuthority: string,
  identityNonce: Uint8Array,
): Promise<string> {
  const authority = parseAddress(originAuthority, 'identity origin authority');
  const nonce = parseNonce(identityNonce, 'identity nonce');
  return (
    await derivePda(context, [
      PDA_PREFIX,
      PDA_VERSION,
      IDENTITY_SEED,
      addressBytes(authority),
      nonce,
    ])
  ).address;
}

export async function deriveWokeSubscriptionOfferingAddress(
  context: WokeNetContext,
  creatorIdentity: string,
  offeringNonce: Uint8Array,
): Promise<string> {
  const creator = parseAddress(creatorIdentity, 'creator identity');
  const nonce = parseNonce(offeringNonce, 'offering nonce');
  return (
    await derivePda(context, [
      PDA_PREFIX,
      PDA_VERSION,
      SUBSCRIPTION_OFFERING_SEED,
      addressBytes(creator),
      nonce,
    ])
  ).address;
}

export async function deriveWokePaymentReceiptAddress(
  context: WokeNetContext,
  payerIdentity: string,
  receiptNonce: Uint8Array,
): Promise<string> {
  return (await deriveReceiptPda(context, payerIdentity, receiptNonce)).address;
}

export async function deriveWokeSubscriptionEntitlementAddress(
  context: WokeNetContext,
  offeringAddress: string,
  beneficiaryIdentity: string,
): Promise<string> {
  return (await deriveEntitlementPda(context, offeringAddress, beneficiaryIdentity)).address;
}

export async function deriveWokeProgramDataAddress(context: WokeNetContext): Promise<string> {
  const parsed = createWokeNetContext(context);
  const [programData] = await getProgramDerivedAddress({
    programAddress: UPGRADEABLE_LOADER_ADDRESS,
    seeds: [addressBytes(parsed.programAddress)],
  });
  return programData;
}

export interface WokeInstruction extends Instruction {
  readonly accounts: readonly AccountMeta[];
  readonly data: Uint8Array;
}

export interface DeactivateWokeIdentityInput {
  readonly identity: string;
  readonly rootAuthority: string;
  readonly expectedIdentitySequence: bigint;
}

/**
 * Builds the root-authorized, one-way WokeSocial identity-retirement
 * instruction. This builder does not submit the transaction or imply content
 * deletion; callers must present that irreversible distinction to the user.
 */
export async function buildDeactivateWokeIdentityInstruction(
  contextInput: WokeNetContext,
  input: DeactivateWokeIdentityInput,
): Promise<WokeInstruction> {
  const context = createWokeNetContext(contextInput);
  const identity = parseAddress(input.identity, 'identity');
  const rootAuthority = parseAddress(input.rootAuthority, 'identity root authority');
  const expectedIdentitySequence = parseIncrementableU64(
    input.expectedIdentitySequence,
    'expected identity sequence',
  );
  const config = await deriveWokeProtocolConfigAddress(context);
  if (new Set([config, identity, rootAuthority]).size !== 3) {
    throw new WokePaymentError(
      'alias',
      'Protocol config, identity, and root-authority accounts must be distinct.',
    );
  }
  return instruction(
    context,
    [
      meta(config, AccountRole.READONLY),
      meta(identity, AccountRole.WRITABLE),
      meta(rootAuthority, AccountRole.READONLY_SIGNER),
    ],
    new BorshWriter(DEACTIVATE_IDENTITY_DISCRIMINATOR).u64(expectedIdentitySequence).finish(),
  );
}

export interface InitializeWokePaymentConfigInput {
  readonly upgradeAuthority: string;
  readonly paymentAuthority: string;
  readonly feeDestination: string;
  readonly payer: string;
  readonly feeBasisPoints: number;
}

export async function buildInitializeWokePaymentConfigInstruction(
  contextInput: WokeNetContext,
  input: InitializeWokePaymentConfigInput,
): Promise<WokeInstruction> {
  const context = createWokeNetContext(contextInput);
  const upgradeAuthority = parseAddress(input.upgradeAuthority, 'upgrade authority');
  const paymentAuthority = parseAddress(input.paymentAuthority, 'payment authority');
  const feeDestination = parseAddress(input.feeDestination, 'fee destination');
  const payer = parseAddress(input.payer, 'payment-config rent payer');
  const feeBasisPoints = parseFeeBasisPoints(input.feeBasisPoints);
  const [config, paymentConfig, programData] = await Promise.all([
    deriveWokeProtocolConfigAddress(context),
    deriveWokePaymentConfigAddress(context),
    deriveWokeProgramDataAddress(context),
  ]);
  return instruction(
    context,
    [
      meta(config, AccountRole.READONLY),
      meta(paymentConfig, AccountRole.WRITABLE),
      meta(context.programAddress, AccountRole.READONLY),
      meta(programData, AccountRole.READONLY),
      meta(upgradeAuthority, AccountRole.READONLY_SIGNER),
      meta(paymentAuthority, AccountRole.READONLY_SIGNER),
      meta(feeDestination, AccountRole.READONLY),
      meta(payer, AccountRole.WRITABLE_SIGNER),
      meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
    ],
    new BorshWriter(INITIALIZE_PAYMENT_CONFIG_DISCRIMINATOR).u16(feeBasisPoints).finish(),
  );
}

export interface UpdateWokePaymentConfigInput {
  readonly authority: string;
  readonly feeDestination: string;
  readonly expectedPolicySequence: bigint;
  readonly feeBasisPoints: number;
  readonly enabled: boolean;
}

export async function buildUpdateWokePaymentConfigInstruction(
  contextInput: WokeNetContext,
  input: UpdateWokePaymentConfigInput,
): Promise<WokeInstruction> {
  const context = createWokeNetContext(contextInput);
  const authority = parseAddress(input.authority, 'payment authority');
  const feeDestination = parseAddress(input.feeDestination, 'fee destination');
  const policySequence = parseIncrementableU64(
    input.expectedPolicySequence,
    'expected payment policy sequence',
  );
  const feeBasisPoints = parseFeeBasisPoints(input.feeBasisPoints);
  if (typeof input.enabled !== 'boolean') {
    throw new WokePaymentError('invalid-wire-value', 'Payment enabled must be boolean.');
  }
  const [config, paymentConfig] = await Promise.all([
    deriveWokeProtocolConfigAddress(context),
    deriveWokePaymentConfigAddress(context),
  ]);
  return instruction(
    context,
    [
      meta(config, AccountRole.READONLY),
      meta(paymentConfig, AccountRole.WRITABLE),
      meta(authority, AccountRole.READONLY_SIGNER),
      meta(feeDestination, AccountRole.READONLY),
    ],
    new BorshWriter(UPDATE_PAYMENT_CONFIG_DISCRIMINATOR)
      .u64(policySequence)
      .u16(feeBasisPoints)
      .bool(input.enabled)
      .finish(),
  );
}

export interface RotateWokePaymentAuthorityInput {
  readonly currentAuthority: string;
  readonly newAuthority: string;
  readonly expectedPolicySequence: bigint;
}

export async function buildRotateWokePaymentAuthorityInstruction(
  contextInput: WokeNetContext,
  input: RotateWokePaymentAuthorityInput,
): Promise<WokeInstruction> {
  const context = createWokeNetContext(contextInput);
  const currentAuthority = parseAddress(input.currentAuthority, 'current payment authority');
  const newAuthority = parseAddress(input.newAuthority, 'new payment authority');
  if (currentAuthority === newAuthority) {
    throw new WokePaymentError('alias', 'The current and new payment authorities must differ.');
  }
  const policySequence = parseIncrementableU64(
    input.expectedPolicySequence,
    'expected payment policy sequence',
  );
  const [config, paymentConfig] = await Promise.all([
    deriveWokeProtocolConfigAddress(context),
    deriveWokePaymentConfigAddress(context),
  ]);
  return instruction(
    context,
    [
      meta(config, AccountRole.READONLY),
      meta(paymentConfig, AccountRole.WRITABLE),
      meta(currentAuthority, AccountRole.READONLY_SIGNER),
      meta(newAuthority, AccountRole.READONLY_SIGNER),
    ],
    new BorshWriter(ROTATE_PAYMENT_AUTHORITY_DISCRIMINATOR).u64(policySequence).finish(),
  );
}

export interface CreateWokeSubscriptionOfferingInput {
  readonly creatorIdentity: string;
  readonly rootAuthority: string;
  readonly payer: string;
  readonly expectedCreatorSequence: bigint;
  readonly offeringNonce: Uint8Array;
  readonly manifestHash: Uint8Array;
  readonly manifestUri: string;
  readonly priceLamports: bigint;
  readonly refundPolicyHash: Uint8Array;
  readonly maxProtocolFeeBasisPoints: number;
  readonly recipientSplits: readonly WokeRecipientSplitInput[];
}

export interface BuiltWokeSubscriptionOfferingInstruction {
  readonly instruction: WokeInstruction;
  readonly offeringAddress: string;
  readonly recipientSplits: readonly WokeRecipientSplitInput[];
}

export async function buildCreateWokeSubscriptionOfferingInstruction(
  contextInput: WokeNetContext,
  input: CreateWokeSubscriptionOfferingInput,
): Promise<BuiltWokeSubscriptionOfferingInstruction> {
  const context = createWokeNetContext(contextInput);
  const creatorIdentity = parseAddress(input.creatorIdentity, 'creator identity');
  const rootAuthority = parseAddress(input.rootAuthority, 'creator root authority');
  const payer = parseAddress(input.payer, 'offering rent payer');
  const expectedCreatorSequence = parseIncrementableU64(
    input.expectedCreatorSequence,
    'expected creator sequence',
  );
  const offeringNonce = parseNonce(input.offeringNonce, 'offering nonce');
  const manifestHash = parseNonzeroHash(input.manifestHash, 'offering manifest hash');
  const manifestUri = parseManifestUri(input.manifestUri);
  const priceLamports = parsePositiveU64(input.priceLamports, 'subscription price');
  const refundPolicyHash = parseNonzeroHash(input.refundPolicyHash, 'refund policy hash');
  const maxFee = parseFeeBasisPoints(input.maxProtocolFeeBasisPoints);
  const recipients = parseRecipientSplits(input.recipientSplits);
  allocateRecipientLamports(priceLamports, maxFee, recipients);

  const creatorSplit = recipients.find(
    (split) => split.recipientIdentity === creatorIdentity && split.destination === rootAuthority,
  );
  if (creatorSplit === undefined) {
    throw new WokePaymentError(
      'invalid-recipient',
      'The offering must include the creator identity and root authority as one recipient split.',
    );
  }
  const additionalRecipients = recipients.filter(
    (split) => split.recipientIdentity !== creatorIdentity,
  );
  const [config, paymentConfig, offeringAddress] = await Promise.all([
    deriveWokeProtocolConfigAddress(context),
    deriveWokePaymentConfigAddress(context),
    deriveWokeSubscriptionOfferingAddress(context, creatorIdentity, offeringNonce),
  ]);
  const accounts: AccountMeta[] = [
    meta(config, AccountRole.READONLY),
    meta(paymentConfig, AccountRole.READONLY),
    meta(creatorIdentity, AccountRole.WRITABLE),
    meta(offeringAddress, AccountRole.WRITABLE),
    meta(rootAuthority, AccountRole.READONLY_SIGNER),
    meta(payer, AccountRole.WRITABLE_SIGNER),
    meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
  ];
  for (let index = 0; index < MAX_ADDITIONAL_PAYMENT_RECIPIENTS; index += 1) {
    const recipient = additionalRecipients[index];
    if (recipient === undefined) {
      accounts.push(
        meta(context.programAddress, AccountRole.READONLY),
        meta(context.programAddress, AccountRole.READONLY),
      );
    } else {
      accounts.push(
        meta(recipient.recipientIdentity, AccountRole.READONLY),
        meta(recipient.destination, AccountRole.READONLY),
      );
    }
  }

  const writer = new BorshWriter(CREATE_SUBSCRIPTION_OFFERING_DISCRIMINATOR)
    .u64(expectedCreatorSequence)
    .fixed(offeringNonce)
    .fixed(manifestHash)
    .string(manifestUri)
    .u64(priceLamports)
    .fixed(refundPolicyHash)
    .u16(maxFee)
    .u16(creatorSplit.basisPoints)
    .u32(additionalRecipients.length);
  for (const recipient of additionalRecipients) {
    writer.u16(recipient.basisPoints);
  }
  return {
    instruction: instruction(context, accounts, writer.finish()),
    offeringAddress,
    recipientSplits: recipients.map(stripIdentityBytes),
  };
}

export interface RetireWokeSubscriptionOfferingInput {
  readonly creatorIdentity: string;
  readonly rootAuthority: string;
  readonly offeringNonce: Uint8Array;
  readonly expectedCreatorSequence: bigint;
  readonly expectedOfferingStateSequence: bigint;
}

export async function buildRetireWokeSubscriptionOfferingInstruction(
  contextInput: WokeNetContext,
  input: RetireWokeSubscriptionOfferingInput,
): Promise<WokeInstruction> {
  const context = createWokeNetContext(contextInput);
  const creatorIdentity = parseAddress(input.creatorIdentity, 'creator identity');
  const rootAuthority = parseAddress(input.rootAuthority, 'creator root authority');
  const nonce = parseNonce(input.offeringNonce, 'offering nonce');
  const creatorSequence = parseIncrementableU64(
    input.expectedCreatorSequence,
    'expected creator sequence',
  );
  const offeringSequence = parseIncrementableU64(
    input.expectedOfferingStateSequence,
    'expected offering state sequence',
  );
  const [config, offering] = await Promise.all([
    deriveWokeProtocolConfigAddress(context),
    deriveWokeSubscriptionOfferingAddress(context, creatorIdentity, nonce),
  ]);
  return instruction(
    context,
    [
      meta(config, AccountRole.READONLY),
      meta(creatorIdentity, AccountRole.WRITABLE),
      meta(offering, AccountRole.WRITABLE),
      meta(rootAuthority, AccountRole.READONLY_SIGNER),
    ],
    new BorshWriter(RETIRE_SUBSCRIPTION_OFFERING_DISCRIMINATOR)
      .u64(creatorSequence)
      .u64(offeringSequence)
      .finish(),
  );
}

export interface SendWokeTipInput {
  readonly payerIdentity: string;
  readonly payerAuthority: string;
  readonly recipientIdentity: string;
  readonly recipientDestination: string;
  readonly feeDestination: string;
  readonly rentPayer: string;
  readonly receiptNonce: Uint8Array;
  readonly expectedPaymentPolicySequence: bigint;
  readonly expectedFeeBasisPoints: number;
  readonly expectedPayerRootRotationCount: bigint;
  readonly grossLamports: bigint;
}

interface WokeSettlementBase {
  readonly context: ValidatedWokeNetContext;
  readonly instruction: WokeInstruction;
  readonly plan: WokeNativePaymentPlan;
  readonly configAddress: string;
  readonly paymentConfigAddress: string;
  readonly receiptAddress: string;
  readonly receiptBump: number;
  readonly receiptNonce: Uint8Array;
  readonly paymentPolicySequence: bigint;
  readonly payerRootRotationCount: bigint;
}

export interface BuiltWokeTipInstruction extends WokeSettlementBase {
  readonly kind: 'woke-tip';
  readonly recipientIdentity: string;
  readonly recipientDestination: string;
}

export async function buildSendWokeTipInstruction(
  contextInput: WokeNetContext,
  input: SendWokeTipInput,
): Promise<BuiltWokeTipInstruction> {
  const context = createWokeNetContext(contextInput);
  const receiptNonce = parseNonce(input.receiptNonce, 'receipt nonce');
  const rentPayer = parseAddress(input.rentPayer, 'receipt rent payer');
  const paymentPolicySequence = parseU64(
    input.expectedPaymentPolicySequence,
    'expected payment policy sequence',
  );
  const payerRootRotationCount = parseU64(
    input.expectedPayerRootRotationCount,
    'expected payer root rotation count',
  );
  const plan = calculateWokeNativePaymentPlan({
    context,
    payerIdentity: input.payerIdentity,
    payerAuthority: input.payerAuthority,
    feeDestination: input.feeDestination,
    feeBasisPoints: input.expectedFeeBasisPoints,
    grossLamports: input.grossLamports,
    recipientSplits: [
      {
        recipientIdentity: input.recipientIdentity,
        destination: input.recipientDestination,
        basisPoints: Number(BASIS_POINTS_DENOMINATOR),
      },
    ],
  });
  const recipient = plan.recipientAllocations[0];
  if (recipient === undefined) {
    throw new WokePaymentError('invalid-recipient', 'The legacy SOL tip requires one recipient.');
  }
  const [configAddress, paymentConfigAddress, receiptPda] = await Promise.all([
    deriveWokeProtocolConfigAddress(context),
    deriveWokePaymentConfigAddress(context),
    deriveReceiptPda(context, plan.payerIdentity, receiptNonce),
  ]);
  const writer = new BorshWriter(SEND_WOKE_TIP_DISCRIMINATOR)
    .fixed(receiptNonce)
    .u64(paymentPolicySequence)
    .u16(plan.feeBasisPoints)
    .address(plan.feeDestination)
    .u64(payerRootRotationCount)
    .address(recipient.recipientIdentity)
    .address(recipient.destination)
    .u64(plan.grossLamports);
  return {
    kind: 'woke-tip',
    context,
    instruction: instruction(
      context,
      [
        meta(configAddress, AccountRole.READONLY),
        meta(paymentConfigAddress, AccountRole.READONLY),
        meta(plan.payerIdentity, AccountRole.READONLY),
        meta(recipient.recipientIdentity, AccountRole.READONLY),
        meta(receiptPda.address, AccountRole.WRITABLE),
        meta(plan.payerAuthority, AccountRole.WRITABLE_SIGNER),
        meta(recipient.destination, AccountRole.WRITABLE),
        meta(plan.feeDestination, AccountRole.WRITABLE),
        meta(rentPayer, AccountRole.WRITABLE_SIGNER),
        meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
      ],
      writer.finish(),
    ),
    plan,
    configAddress,
    paymentConfigAddress,
    receiptAddress: receiptPda.address,
    receiptBump: receiptPda.bump,
    receiptNonce,
    paymentPolicySequence,
    payerRootRotationCount,
    recipientIdentity: recipient.recipientIdentity,
    recipientDestination: recipient.destination,
  };
}

export type WokeEntitlementSnapshot =
  | { readonly kind: 'new' }
  | {
      readonly kind: 'existing';
      readonly stateSequence: bigint;
      readonly settlementCount: bigint;
      readonly startedAtTimestamp: bigint;
      readonly validUntilTimestamp: bigint;
    };

export interface SettleWokeSubscriptionInput {
  readonly payerIdentity: string;
  readonly payerAuthority: string;
  readonly creatorIdentity: string;
  readonly creatorDestination: string;
  readonly offeringNonce: Uint8Array;
  readonly feeDestination: string;
  readonly rentPayer: string;
  readonly receiptNonce: Uint8Array;
  readonly expectedPaymentPolicySequence: bigint;
  readonly expectedFeeBasisPoints: number;
  readonly expectedPayerRootRotationCount: bigint;
  readonly expectedOfferingStateSequence: bigint;
  readonly expectedOfferingManifestHash: Uint8Array;
  readonly expectedRefundPolicyHash: Uint8Array;
  readonly expectedPriceLamports: bigint;
  readonly entitlement: WokeEntitlementSnapshot;
  readonly recipientSplits: readonly WokeRecipientSplitInput[];
}

export interface BuiltWokeSubscriptionSettlementInstruction extends WokeSettlementBase {
  readonly kind: 'weekly-subscription';
  readonly creatorIdentity: string;
  readonly creatorDestination: string;
  readonly offeringAddress: string;
  readonly offeringStateSequence: bigint;
  readonly offeringManifestHash: Uint8Array;
  readonly refundPolicyHash: Uint8Array;
  readonly entitlementAddress: string;
  readonly entitlementBump: number;
  readonly priorEntitlementStateSequence: bigint;
  readonly priorSettlementCount: bigint;
  readonly priorStartedAtTimestamp: bigint | null;
  readonly priorValidUntilTimestamp: bigint;
}

export async function buildSettleWokeSubscriptionInstruction(
  contextInput: WokeNetContext,
  input: SettleWokeSubscriptionInput,
): Promise<BuiltWokeSubscriptionSettlementInstruction> {
  const context = createWokeNetContext(contextInput);
  const creatorIdentity = parseAddress(input.creatorIdentity, 'creator identity');
  const creatorDestination = parseAddress(input.creatorDestination, 'creator destination');
  const offeringNonce = parseNonce(input.offeringNonce, 'offering nonce');
  const rentPayer = parseAddress(input.rentPayer, 'settlement rent payer');
  const receiptNonce = parseNonce(input.receiptNonce, 'receipt nonce');
  const paymentPolicySequence = parseU64(
    input.expectedPaymentPolicySequence,
    'expected payment policy sequence',
  );
  const payerRootRotationCount = parseU64(
    input.expectedPayerRootRotationCount,
    'expected payer root rotation count',
  );
  const offeringStateSequence = parseU64(
    input.expectedOfferingStateSequence,
    'expected offering state sequence',
  );
  const offeringManifestHash = parseNonzeroHash(
    input.expectedOfferingManifestHash,
    'offering manifest hash',
  );
  const refundPolicyHash = parseNonzeroHash(input.expectedRefundPolicyHash, 'refund policy hash');
  const { stateSequence, settlementCount, startedAtTimestamp, validUntilTimestamp } =
    parseEntitlementSnapshot(input.entitlement);
  const plan = calculateWokeNativePaymentPlan({
    context,
    payerIdentity: input.payerIdentity,
    payerAuthority: input.payerAuthority,
    feeDestination: input.feeDestination,
    feeBasisPoints: input.expectedFeeBasisPoints,
    grossLamports: input.expectedPriceLamports,
    recipientSplits: input.recipientSplits,
  });
  const creatorAllocation = plan.recipientAllocations.find(
    (recipient) =>
      recipient.recipientIdentity === creatorIdentity &&
      recipient.destination === creatorDestination,
  );
  if (creatorAllocation === undefined) {
    throw new WokePaymentError(
      'invalid-recipient',
      'The subscription split snapshot does not contain the creator destination.',
    );
  }
  const additionalRecipients = plan.recipientAllocations.filter(
    (recipient) => recipient.recipientIdentity !== creatorIdentity,
  );
  const [configAddress, paymentConfigAddress, offeringAddress, receiptPda] = await Promise.all([
    deriveWokeProtocolConfigAddress(context),
    deriveWokePaymentConfigAddress(context),
    deriveWokeSubscriptionOfferingAddress(context, creatorIdentity, offeringNonce),
    deriveReceiptPda(context, plan.payerIdentity, receiptNonce),
  ]);
  const entitlementPda = await deriveEntitlementPda(context, offeringAddress, plan.payerIdentity);
  const accounts: AccountMeta[] = [
    meta(configAddress, AccountRole.READONLY),
    meta(paymentConfigAddress, AccountRole.READONLY),
    meta(plan.payerIdentity, AccountRole.READONLY),
    meta(creatorIdentity, AccountRole.READONLY),
    meta(offeringAddress, AccountRole.READONLY),
    meta(entitlementPda.address, AccountRole.WRITABLE),
    meta(receiptPda.address, AccountRole.WRITABLE),
    meta(plan.payerAuthority, AccountRole.WRITABLE_SIGNER),
    meta(creatorDestination, AccountRole.WRITABLE),
    meta(plan.feeDestination, AccountRole.WRITABLE),
    meta(rentPayer, AccountRole.WRITABLE_SIGNER),
    meta(SYSTEM_PROGRAM_ADDRESS, AccountRole.READONLY),
  ];
  for (let index = 0; index < MAX_ADDITIONAL_PAYMENT_RECIPIENTS; index += 1) {
    const recipient = additionalRecipients[index];
    if (recipient === undefined) {
      accounts.push(
        meta(context.programAddress, AccountRole.READONLY),
        meta(context.programAddress, AccountRole.READONLY),
      );
    } else {
      accounts.push(
        meta(recipient.recipientIdentity, AccountRole.READONLY),
        meta(recipient.destination, AccountRole.WRITABLE),
      );
    }
  }
  const writer = new BorshWriter(SETTLE_SUBSCRIPTION_DISCRIMINATOR)
    .fixed(receiptNonce)
    .u64(paymentPolicySequence)
    .u16(plan.feeBasisPoints)
    .address(plan.feeDestination)
    .u64(payerRootRotationCount)
    .u64(offeringStateSequence)
    .fixed(offeringManifestHash)
    .fixed(refundPolicyHash)
    .u64(plan.grossLamports)
    .u64(stateSequence);
  return {
    kind: 'weekly-subscription',
    context,
    instruction: instruction(context, accounts, writer.finish()),
    plan,
    configAddress,
    paymentConfigAddress,
    receiptAddress: receiptPda.address,
    receiptBump: receiptPda.bump,
    receiptNonce,
    paymentPolicySequence,
    payerRootRotationCount,
    creatorIdentity,
    creatorDestination,
    offeringAddress,
    offeringStateSequence,
    offeringManifestHash,
    refundPolicyHash,
    entitlementAddress: entitlementPda.address,
    entitlementBump: entitlementPda.bump,
    priorEntitlementStateSequence: stateSequence,
    priorSettlementCount: settlementCount,
    priorStartedAtTimestamp: startedAtTimestamp,
    priorValidUntilTimestamp: validUntilTimestamp,
  };
}

export interface ObservedWokeSystemTransfer {
  readonly programAddress: string;
  readonly source: string;
  readonly destination: string;
  readonly lamports: bigint;
}

export interface WokeTipSettledEvent {
  readonly kind: 'woke-tip-settled';
  readonly eventVersion: number;
  readonly config: string;
  readonly paymentConfig: string;
  readonly receipt: string;
  readonly payerIdentity: string;
  readonly payerAuthority: string;
  readonly recipientIdentity: string;
  readonly recipientDestination: string;
  readonly receiptNonce: Uint8Array;
  readonly paymentKind: 'woke-tip';
  readonly payerRootRotationCount: bigint;
  readonly paymentPolicySequence: bigint;
  readonly grossLamports: bigint;
  readonly feeBasisPoints: number;
  readonly feeDestination: string;
  readonly feeLamports: bigint;
  readonly distributableLamports: bigint;
  readonly recipientLamports: bigint;
  readonly paidAtTimestamp: bigint;
  readonly paidAtSlot: bigint;
}

export interface WokeSubscriptionSettledEvent {
  readonly kind: 'subscription-settled';
  readonly eventVersion: number;
  readonly config: string;
  readonly paymentConfig: string;
  readonly offering: string;
  readonly receipt: string;
  readonly entitlement: string;
  readonly creatorIdentity: string;
  readonly payerIdentity: string;
  readonly payerAuthority: string;
  readonly receiptNonce: Uint8Array;
  readonly paymentKind: 'weekly-subscription';
  readonly payerRootRotationCount: bigint;
  readonly paymentPolicySequence: bigint;
  readonly offeringStateSequence: bigint;
  readonly offeringManifestHash: Uint8Array;
  readonly refundPolicyHash: Uint8Array;
  readonly grossLamports: bigint;
  readonly feeBasisPoints: number;
  readonly feeDestination: string;
  readonly feeLamports: bigint;
  readonly distributableLamports: bigint;
  readonly recipientSplits: readonly WokeRecipientSplitInput[];
  readonly recipientAmounts: readonly bigint[];
  readonly entitlementStateSequence: bigint;
  readonly settlementCount: bigint;
  readonly entitlementFromTimestamp: bigint;
  readonly entitlementUntilTimestamp: bigint;
  readonly paidAtTimestamp: bigint;
  readonly paidAtSlot: bigint;
}

export type WokeSettlementEvent = WokeTipSettledEvent | WokeSubscriptionSettledEvent;

/**
 * A deliberately simulation-only shape. Callers must parse every System
 * Program `Transfer` opcode from `simulateTransaction` and every payment event
 * emitted by the WokeSocial program. System account-creation opcodes are not
 * transfers and must not be included.
 */
export interface WokePaymentSimulation {
  readonly source: 'simulateTransaction';
  readonly endpoint: string;
  readonly genesisHash: string;
  readonly programAddress: string;
  readonly error: null | unknown;
  readonly transfers: readonly ObservedWokeSystemTransfer[];
  readonly events: readonly WokeSettlementEvent[];
}

export type BuiltWokeSettlementInstruction =
  BuiltWokeTipInstruction | BuiltWokeSubscriptionSettlementInstruction;

export function assertWokePaymentSimulationMatches(
  built: BuiltWokeSettlementInstruction,
  simulation: WokePaymentSimulation,
): void {
  if (
    simulation.source !== 'simulateTransaction' ||
    simulation.endpoint !== built.context.endpoint ||
    simulation.genesisHash !== built.context.genesisHash ||
    simulation.programAddress !== built.context.programAddress
  ) {
    throw new WokePaymentError(
      'context-mismatch',
      'The simulation is not bound to the approved WokeNet endpoint, genesis, and program.',
    );
  }
  if (simulation.error !== null) {
    throw new WokePaymentError(
      'simulation-mismatch',
      'The legacy SOL settlement simulation failed.',
    );
  }

  const expectedTransfers = built.plan.transfers;
  if (simulation.transfers.length !== expectedTransfers.length) {
    throw new WokePaymentError(
      'simulation-mismatch',
      'The simulated SOL System transfer count differs from the approved plan.',
    );
  }
  for (const [index, expected] of expectedTransfers.entries()) {
    const observed = simulation.transfers[index];
    if (
      observed === undefined ||
      observed.programAddress !== WOKENET_SYSTEM_PROGRAM_ADDRESS ||
      observed.source !== expected.source ||
      observed.destination !== expected.destination ||
      observed.lamports !== expected.lamports
    ) {
      throw new WokePaymentError(
        'simulation-mismatch',
        `Simulated SOL System transfer ${String(index)} differs from the approved plan.`,
      );
    }
  }
  if (simulation.events.length !== 1) {
    throw new WokePaymentError(
      'invalid-event',
      'The simulation must emit exactly one legacy settlement event.',
    );
  }
  const event = simulation.events[0];
  if (event === undefined) {
    throw new WokePaymentError('invalid-event', 'The legacy settlement event is missing.');
  }
  if (built.kind === 'woke-tip') {
    assertTipEvent(built, event);
  } else {
    assertSubscriptionEvent(built, event);
  }
}

export interface WokePaymentReceiptRecord {
  readonly version: number;
  readonly config: string;
  readonly paymentConfig: string;
  readonly termsReference: string;
  readonly payerIdentity: string;
  readonly payerAuthority: string;
  readonly subjectIdentity: string;
  readonly primaryRecipientDestination: string;
  readonly feeDestination: string;
  readonly receiptNonce: Uint8Array;
  readonly kind: 'woke-tip' | 'weekly-subscription';
  readonly paymentPolicySequence: bigint;
  readonly termsStateSequence: bigint;
  readonly termsManifestHash: Uint8Array;
  readonly payerRootRotationCount: bigint;
  readonly grossLamports: bigint;
  readonly feeBasisPoints: number;
  readonly feeLamports: bigint;
  readonly distributableLamports: bigint;
  readonly recipientAmounts: readonly bigint[];
  readonly refundPolicyHash: Uint8Array;
  readonly entitlementFromTimestamp: bigint;
  readonly entitlementUntilTimestamp: bigint;
  readonly paidAtTimestamp: bigint;
  readonly paidAtSlot: bigint;
  readonly bump: number;
}

export interface WokeSubscriptionEntitlementRecord {
  readonly version: number;
  readonly config: string;
  readonly offering: string;
  readonly beneficiaryIdentity: string;
  readonly startedAtTimestamp: bigint;
  readonly validUntilTimestamp: bigint;
  readonly settlementCount: bigint;
  readonly lastReceipt: string;
  readonly stateSequence: bigint;
  readonly lastSettledAtSlot: bigint;
  readonly refundPolicyHash: Uint8Array;
  readonly bump: number;
}

export interface WokeFinalizedReadRequest {
  readonly endpoint: string;
  readonly genesisHash: string;
  readonly programAddress: string;
  readonly address: string;
  readonly commitment: 'finalized';
}

export interface WokeFinalizedAccount<T> extends WokeFinalizedReadRequest {
  readonly commitment: 'finalized';
  readonly owner: string;
  readonly slot: bigint;
  readonly data: T;
}

export interface WokePaymentAccountReader {
  readPaymentReceipt(
    request: WokeFinalizedReadRequest,
  ): Promise<WokeFinalizedAccount<WokePaymentReceiptRecord> | null>;
  readSubscriptionEntitlement(
    request: WokeFinalizedReadRequest,
  ): Promise<WokeFinalizedAccount<WokeSubscriptionEntitlementRecord> | null>;
}

export interface VerifiedWokeTipProof {
  readonly kind: 'woke-tip';
  readonly receipt: WokeFinalizedAccount<WokePaymentReceiptRecord>;
}

export interface VerifiedWokeSubscriptionProof {
  readonly kind: 'weekly-subscription';
  readonly receipt: WokeFinalizedAccount<WokePaymentReceiptRecord>;
  readonly entitlement: WokeFinalizedAccount<WokeSubscriptionEntitlementRecord>;
}

export async function verifyFinalizedWokeTipReceipt(
  built: BuiltWokeTipInstruction,
  reader: WokePaymentAccountReader,
): Promise<VerifiedWokeTipProof> {
  const receipt = await reader.readPaymentReceipt(finalizedRequest(built, built.receiptAddress));
  if (receipt === null) {
    throw new WokePaymentError(
      'account-not-found',
      'The finalized legacy SOL tip receipt was not found.',
    );
  }
  assertFinalizedEnvelope(built, built.receiptAddress, receipt);
  assertTipReceipt(built, receipt.data, receipt.slot);
  return { kind: 'woke-tip', receipt };
}

export async function verifyFinalizedWokeSubscriptionProof(
  built: BuiltWokeSubscriptionSettlementInstruction,
  reader: WokePaymentAccountReader,
): Promise<VerifiedWokeSubscriptionProof> {
  const [receipt, entitlement] = await Promise.all([
    reader.readPaymentReceipt(finalizedRequest(built, built.receiptAddress)),
    reader.readSubscriptionEntitlement(finalizedRequest(built, built.entitlementAddress)),
  ]);
  if (receipt === null || entitlement === null) {
    throw new WokePaymentError(
      'account-not-found',
      'The finalized legacy receipt and entitlement are both required.',
    );
  }
  assertFinalizedEnvelope(built, built.receiptAddress, receipt);
  assertFinalizedEnvelope(built, built.entitlementAddress, entitlement);
  assertSubscriptionReceipt(built, receipt.data, receipt.slot);
  assertSubscriptionEntitlement(built, receipt.data, entitlement.data, entitlement.slot);
  return { kind: 'weekly-subscription', receipt, entitlement };
}

function assertTipEvent(
  built: BuiltWokeTipInstruction,
  event: WokeSettlementEvent,
): asserts event is WokeTipSettledEvent {
  const allocation = built.plan.recipientAllocations[0];
  if (
    allocation === undefined ||
    event.kind !== 'woke-tip-settled' ||
    event.eventVersion !== PROTOCOL_VERSION ||
    event.config !== built.configAddress ||
    event.paymentConfig !== built.paymentConfigAddress ||
    event.receipt !== built.receiptAddress ||
    event.payerIdentity !== built.plan.payerIdentity ||
    event.payerAuthority !== built.plan.payerAuthority ||
    event.recipientIdentity !== built.recipientIdentity ||
    event.recipientDestination !== built.recipientDestination ||
    !equalBytes(event.receiptNonce, built.receiptNonce) ||
    event.paymentKind !== 'woke-tip' ||
    event.payerRootRotationCount !== built.payerRootRotationCount ||
    event.paymentPolicySequence !== built.paymentPolicySequence ||
    event.grossLamports !== built.plan.grossLamports ||
    event.feeBasisPoints !== built.plan.feeBasisPoints ||
    event.feeDestination !== built.plan.feeDestination ||
    event.feeLamports !== built.plan.feeLamports ||
    event.distributableLamports !== built.plan.distributableLamports ||
    event.recipientLamports !== allocation.lamports
  ) {
    throw new WokePaymentError(
      'invalid-event',
      'The WokeTipSettled event differs from the approved legacy SOL tip.',
    );
  }
  parseNonnegativeI64(event.paidAtTimestamp, 'tip paid-at timestamp');
  parseU64(event.paidAtSlot, 'tip paid-at slot');
}

function assertSubscriptionEvent(
  built: BuiltWokeSubscriptionSettlementInstruction,
  event: WokeSettlementEvent,
): asserts event is WokeSubscriptionSettledEvent {
  if (
    event.kind !== 'subscription-settled' ||
    event.eventVersion !== PROTOCOL_VERSION ||
    event.config !== built.configAddress ||
    event.paymentConfig !== built.paymentConfigAddress ||
    event.offering !== built.offeringAddress ||
    event.receipt !== built.receiptAddress ||
    event.entitlement !== built.entitlementAddress ||
    event.creatorIdentity !== built.creatorIdentity ||
    event.payerIdentity !== built.plan.payerIdentity ||
    event.payerAuthority !== built.plan.payerAuthority ||
    !equalBytes(event.receiptNonce, built.receiptNonce) ||
    event.paymentKind !== 'weekly-subscription' ||
    event.payerRootRotationCount !== built.payerRootRotationCount ||
    event.paymentPolicySequence !== built.paymentPolicySequence ||
    event.offeringStateSequence !== built.offeringStateSequence ||
    !equalBytes(event.offeringManifestHash, built.offeringManifestHash) ||
    !equalBytes(event.refundPolicyHash, built.refundPolicyHash) ||
    event.grossLamports !== built.plan.grossLamports ||
    event.feeBasisPoints !== built.plan.feeBasisPoints ||
    event.feeDestination !== built.plan.feeDestination ||
    event.feeLamports !== built.plan.feeLamports ||
    event.distributableLamports !== built.plan.distributableLamports ||
    event.entitlementStateSequence !== built.priorEntitlementStateSequence + 1n ||
    event.settlementCount !== built.priorSettlementCount + 1n ||
    !sameSplits(event.recipientSplits, built.plan.recipientAllocations) ||
    !sameBigints(
      event.recipientAmounts,
      built.plan.recipientAllocations.map((allocation) => allocation.lamports),
    )
  ) {
    throw new WokePaymentError(
      'invalid-event',
      'The SubscriptionSettled event differs from the approved legacy SOL settlement.',
    );
  }
  assertSubscriptionWindow(
    event.paidAtTimestamp,
    built.priorValidUntilTimestamp,
    event.entitlementFromTimestamp,
    event.entitlementUntilTimestamp,
    'invalid-event',
  );
  parseU64(event.paidAtSlot, 'subscription paid-at slot');
}

function assertTipReceipt(
  built: BuiltWokeTipInstruction,
  receipt: WokePaymentReceiptRecord,
  observedSlot: bigint,
): void {
  const allocation = built.plan.recipientAllocations[0];
  if (
    allocation === undefined ||
    receipt.version !== ACCOUNT_VERSION ||
    receipt.config !== built.configAddress ||
    receipt.paymentConfig !== built.paymentConfigAddress ||
    receipt.termsReference !== built.recipientIdentity ||
    receipt.payerIdentity !== built.plan.payerIdentity ||
    receipt.payerAuthority !== built.plan.payerAuthority ||
    receipt.subjectIdentity !== built.recipientIdentity ||
    receipt.primaryRecipientDestination !== built.recipientDestination ||
    receipt.feeDestination !== built.plan.feeDestination ||
    !equalBytes(receipt.receiptNonce, built.receiptNonce) ||
    receipt.kind !== 'woke-tip' ||
    receipt.paymentPolicySequence !== built.paymentPolicySequence ||
    receipt.termsStateSequence !== 0n ||
    !isZeroHash(receipt.termsManifestHash) ||
    receipt.payerRootRotationCount !== built.payerRootRotationCount ||
    receipt.grossLamports !== built.plan.grossLamports ||
    receipt.feeBasisPoints !== built.plan.feeBasisPoints ||
    receipt.feeLamports !== built.plan.feeLamports ||
    receipt.distributableLamports !== built.plan.distributableLamports ||
    !sameBigints(receipt.recipientAmounts, [allocation.lamports]) ||
    !isZeroHash(receipt.refundPolicyHash) ||
    receipt.entitlementFromTimestamp !== 0n ||
    receipt.entitlementUntilTimestamp !== 0n ||
    receipt.bump !== built.receiptBump
  ) {
    throw new WokePaymentError(
      'invalid-proof',
      'The finalized account is not the exact approved legacy SOL tip receipt.',
    );
  }
  assertPaidAt(receipt.paidAtTimestamp, receipt.paidAtSlot, observedSlot);
}

function assertSubscriptionReceipt(
  built: BuiltWokeSubscriptionSettlementInstruction,
  receipt: WokePaymentReceiptRecord,
  observedSlot: bigint,
): void {
  if (
    receipt.version !== ACCOUNT_VERSION ||
    receipt.config !== built.configAddress ||
    receipt.paymentConfig !== built.paymentConfigAddress ||
    receipt.termsReference !== built.offeringAddress ||
    receipt.payerIdentity !== built.plan.payerIdentity ||
    receipt.payerAuthority !== built.plan.payerAuthority ||
    receipt.subjectIdentity !== built.plan.payerIdentity ||
    receipt.primaryRecipientDestination !== built.creatorDestination ||
    receipt.feeDestination !== built.plan.feeDestination ||
    !equalBytes(receipt.receiptNonce, built.receiptNonce) ||
    receipt.kind !== 'weekly-subscription' ||
    receipt.paymentPolicySequence !== built.paymentPolicySequence ||
    receipt.termsStateSequence !== built.offeringStateSequence ||
    !equalBytes(receipt.termsManifestHash, built.offeringManifestHash) ||
    receipt.payerRootRotationCount !== built.payerRootRotationCount ||
    receipt.grossLamports !== built.plan.grossLamports ||
    receipt.feeBasisPoints !== built.plan.feeBasisPoints ||
    receipt.feeLamports !== built.plan.feeLamports ||
    receipt.distributableLamports !== built.plan.distributableLamports ||
    !sameBigints(
      receipt.recipientAmounts,
      built.plan.recipientAllocations.map((allocation) => allocation.lamports),
    ) ||
    !equalBytes(receipt.refundPolicyHash, built.refundPolicyHash) ||
    receipt.bump !== built.receiptBump
  ) {
    throw new WokePaymentError(
      'invalid-proof',
      'The finalized account is not the exact approved legacy SOL subscription receipt.',
    );
  }
  assertSubscriptionWindow(
    receipt.paidAtTimestamp,
    built.priorValidUntilTimestamp,
    receipt.entitlementFromTimestamp,
    receipt.entitlementUntilTimestamp,
    'invalid-proof',
  );
  assertPaidAt(receipt.paidAtTimestamp, receipt.paidAtSlot, observedSlot);
}

function assertSubscriptionEntitlement(
  built: BuiltWokeSubscriptionSettlementInstruction,
  receipt: WokePaymentReceiptRecord,
  entitlement: WokeSubscriptionEntitlementRecord,
  observedSlot: bigint,
): void {
  const expectedStartedAt = built.priorStartedAtTimestamp ?? receipt.entitlementFromTimestamp;
  if (
    entitlement.version !== ACCOUNT_VERSION ||
    entitlement.config !== built.configAddress ||
    entitlement.offering !== built.offeringAddress ||
    entitlement.beneficiaryIdentity !== built.plan.payerIdentity ||
    entitlement.startedAtTimestamp !== expectedStartedAt ||
    entitlement.validUntilTimestamp !== receipt.entitlementUntilTimestamp ||
    entitlement.settlementCount !== built.priorSettlementCount + 1n ||
    entitlement.lastReceipt !== built.receiptAddress ||
    entitlement.stateSequence !== built.priorEntitlementStateSequence + 1n ||
    entitlement.lastSettledAtSlot !== receipt.paidAtSlot ||
    !equalBytes(entitlement.refundPolicyHash, built.refundPolicyHash) ||
    entitlement.bump !== built.entitlementBump ||
    observedSlot < entitlement.lastSettledAtSlot
  ) {
    throw new WokePaymentError(
      'invalid-proof',
      'The finalized entitlement does not prove the approved legacy SOL subscription settlement.',
    );
  }
}

function finalizedRequest(
  built: WokeSettlementBase,
  accountAddress: string,
): WokeFinalizedReadRequest {
  return {
    endpoint: built.context.endpoint,
    genesisHash: built.context.genesisHash,
    programAddress: built.context.programAddress,
    address: accountAddress,
    commitment: 'finalized',
  };
}

function assertFinalizedEnvelope<T>(
  built: WokeSettlementBase,
  accountAddress: string,
  account: WokeFinalizedAccount<T>,
): void {
  if (
    account.commitment !== 'finalized' ||
    account.endpoint !== built.context.endpoint ||
    account.genesisHash !== built.context.genesisHash ||
    account.programAddress !== built.context.programAddress ||
    account.address !== accountAddress ||
    account.owner !== built.context.programAddress
  ) {
    throw new WokePaymentError(
      'context-mismatch',
      'The finalized account proof is not bound to the approved WokeNet Solana deployment.',
    );
  }
  parseU64(account.slot, 'finalized account slot');
}

interface ParsedRecipientSplit extends WokeRecipientSplitInput {
  readonly recipientIdentity: string;
  readonly destination: string;
  readonly identityBytes: Uint8Array;
}

function parseRecipientSplits(input: readonly WokeRecipientSplitInput[]): ParsedRecipientSplit[] {
  if (input.length < 1 || input.length > 3) {
    throw new WokePaymentError(
      'invalid-recipient',
      'The legacy SOL settlement layout requires between one and three recipient splits.',
    );
  }
  const recipients = input.map((candidate) => {
    const recipientIdentity = parseAddress(candidate.recipientIdentity, 'recipient identity');
    const destination = parseAddress(candidate.destination, 'recipient destination');
    if (
      !Number.isInteger(candidate.basisPoints) ||
      candidate.basisPoints < 1 ||
      candidate.basisPoints > Number(BASIS_POINTS_DENOMINATOR)
    ) {
      throw new WokePaymentError(
        'invalid-recipient',
        'Each legacy SOL recipient basis-point value must be an integer from 1 through 10,000.',
      );
    }
    return {
      recipientIdentity,
      destination,
      basisPoints: candidate.basisPoints,
      identityBytes: addressBytes(recipientIdentity),
    };
  });
  recipients.sort((left, right) => compareBytes(left.identityBytes, right.identityBytes));
  if (
    recipients.some(
      (recipient, index) =>
        index > 0 &&
        compareBytes(
          recipients[index - 1]?.identityBytes ?? new Uint8Array(),
          recipient.identityBytes,
        ) === 0,
    )
  ) {
    throw new WokePaymentError(
      'invalid-recipient',
      'Legacy SOL recipient identities must be unique.',
    );
  }
  const recipientRoles = recipients.flatMap((recipient) => [
    recipient.recipientIdentity,
    recipient.destination,
  ]);
  if (new Set(recipientRoles).size !== recipientRoles.length) {
    throw new WokePaymentError(
      'alias',
      'Legacy SOL recipient identities and destinations must all be distinct.',
    );
  }
  const total = recipients.reduce((sum, recipient) => sum + recipient.basisPoints, 0);
  if (total !== Number(BASIS_POINTS_DENOMINATOR)) {
    throw new WokePaymentError(
      'invalid-recipient',
      'Legacy SOL recipient splits must total exactly 10,000 basis points.',
    );
  }
  return recipients;
}

function allocateRecipientLamports(
  grossLamports: bigint,
  feeBasisPoints: number,
  recipients: readonly ParsedRecipientSplit[],
): readonly bigint[] {
  const gross = checkedU128(parsePositiveU64(grossLamports, 'gross SOL lamports'), 'gross');
  const fee =
    checkedU128Multiply(gross, BigInt(parseFeeBasisPoints(feeBasisPoints)), 'fee') /
    BASIS_POINTS_DENOMINATOR;
  const distributable = gross - fee;
  if (distributable < 1n) {
    throw new WokePaymentError('rounding-underflow', 'No SOL lamports remain for recipients.');
  }
  const working = recipients.map((recipient) => {
    const numerator = checkedU128Multiply(
      distributable,
      BigInt(recipient.basisPoints),
      'recipient allocation',
    );
    return {
      amount: numerator / BASIS_POINTS_DENOMINATOR,
      remainder: numerator % BASIS_POINTS_DENOMINATOR,
      identityBytes: recipient.identityBytes,
    };
  });
  let residual =
    distributable - working.reduce((sum, value) => checkedU128Add(sum, value.amount, 'sum'), 0n);
  for (const allocation of [...working].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    return compareBytes(left.identityBytes, right.identityBytes);
  })) {
    if (residual === 0n) break;
    allocation.amount += 1n;
    residual -= 1n;
  }
  if (residual !== 0n || working.some((allocation) => allocation.amount < 1n)) {
    throw new WokePaymentError(
      'rounding-underflow',
      'The amount cannot pay every legacy SOL recipient at least one lamport.',
    );
  }
  return working.map((allocation) => allocation.amount);
}

function assertGlobalPaymentAliases(
  payerIdentity: string,
  payerAuthority: string,
  feeDestination: string,
  recipients: readonly ParsedRecipientSplit[],
): void {
  const allRoles = [
    payerIdentity,
    payerAuthority,
    feeDestination,
    ...recipients.flatMap((recipient) => [recipient.recipientIdentity, recipient.destination]),
  ];
  if (new Set(allRoles).size !== allRoles.length) {
    throw new WokePaymentError(
      'alias',
      'Payer, fee, recipient identity, and recipient destination roles must not alias.',
    );
  }
}

function parseEntitlementSnapshot(snapshot: WokeEntitlementSnapshot): {
  stateSequence: bigint;
  settlementCount: bigint;
  startedAtTimestamp: bigint | null;
  validUntilTimestamp: bigint;
} {
  if (snapshot.kind === 'new') {
    return {
      stateSequence: 0n,
      settlementCount: 0n,
      startedAtTimestamp: null,
      validUntilTimestamp: 0n,
    };
  }
  if (snapshot.kind !== 'existing') {
    throw new WokePaymentError('invalid-wire-value', 'The entitlement snapshot kind is invalid.');
  }
  const startedAtTimestamp = parseNonnegativeI64(
    snapshot.startedAtTimestamp,
    'entitlement start timestamp',
  );
  const validUntilTimestamp = parseNonnegativeI64(
    snapshot.validUntilTimestamp,
    'entitlement valid-until timestamp',
  );
  if (startedAtTimestamp > validUntilTimestamp) {
    throw new WokePaymentError(
      'invalid-wire-value',
      'The entitlement start timestamp cannot follow its valid-until timestamp.',
    );
  }
  return {
    stateSequence: parseIncrementableU64(snapshot.stateSequence, 'entitlement state sequence'),
    settlementCount: parseIncrementableU64(
      snapshot.settlementCount,
      'entitlement settlement count',
    ),
    startedAtTimestamp,
    validUntilTimestamp,
  };
}

async function deriveReceiptPda(
  context: WokeNetContext,
  payerIdentity: string,
  receiptNonce: Uint8Array,
): Promise<{ address: string; bump: number }> {
  const payer = parseAddress(payerIdentity, 'payer identity');
  const nonce = parseNonce(receiptNonce, 'receipt nonce');
  return derivePda(context, [
    PDA_PREFIX,
    PDA_VERSION,
    PAYMENT_RECEIPT_SEED,
    addressBytes(payer),
    nonce,
  ]);
}

async function deriveEntitlementPda(
  context: WokeNetContext,
  offeringAddress: string,
  beneficiaryIdentity: string,
): Promise<{ address: string; bump: number }> {
  const offering = parseAddress(offeringAddress, 'subscription offering');
  const beneficiary = parseAddress(beneficiaryIdentity, 'entitlement beneficiary');
  return derivePda(context, [
    PDA_PREFIX,
    PDA_VERSION,
    SUBSCRIPTION_ENTITLEMENT_SEED,
    addressBytes(offering),
    addressBytes(beneficiary),
  ]);
}

async function derivePda(
  contextInput: WokeNetContext,
  seeds: readonly Uint8Array[],
): Promise<{ address: string; bump: number }> {
  const context = createWokeNetContext(contextInput);
  const [derivedAddress, bump] = await getProgramDerivedAddress({
    programAddress: address(context.programAddress),
    seeds: [...seeds],
  });
  return { address: derivedAddress, bump };
}

function instruction(
  context: ValidatedWokeNetContext,
  accounts: readonly AccountMeta[],
  data: Uint8Array,
): WokeInstruction {
  return {
    programAddress: address(context.programAddress),
    accounts,
    data,
  };
}

function meta(value: string | Address, role: AccountRole): AccountMeta {
  return { address: address(value), role };
}

function parseAddress(value: string, label: string): string {
  try {
    const parsed = address(value);
    if (parsed === WOKENET_SYSTEM_PROGRAM_ADDRESS) {
      throw new Error('default address');
    }
    return parsed;
  } catch (error) {
    throw new WokePaymentError(
      'invalid-address',
      `The ${label} must be a non-default 32-byte base58 address.`,
      { cause: error },
    );
  }
}

function addressBytes(value: string): Uint8Array {
  return Uint8Array.from(ADDRESS_ENCODER.encode(address(value)));
}

function parseFeeBasisPoints(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_PROTOCOL_FEE_BPS) {
    throw new WokePaymentError(
      'invalid-fee',
      `The legacy SOL protocol fee must be an integer from 0 through ${String(MAX_PROTOCOL_FEE_BPS)} basis points.`,
    );
  }
  return value;
}

function parsePositiveU64(value: bigint, label: string): bigint {
  const parsed = parseU64(value, label);
  if (parsed === 0n) {
    throw new WokePaymentError('amount-out-of-range', `The ${label} must be at least one lamport.`);
  }
  return parsed;
}

function parseU64(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > U64_MAX) {
    throw new WokePaymentError(
      'amount-out-of-range',
      `The ${label} must fit WokeNet's unsigned 64-bit range.`,
    );
  }
  return value;
}

function parseIncrementableU64(value: bigint, label: string): bigint {
  const parsed = parseU64(value, label);
  if (parsed === U64_MAX) {
    throw new WokePaymentError(
      'amount-out-of-range',
      `The ${label} cannot be incremented in the WokeSocial program.`,
    );
  }
  return parsed;
}

function parseNonnegativeI64(value: bigint, label: string): bigint {
  if (typeof value !== 'bigint' || value < 0n || value > I64_MAX) {
    throw new WokePaymentError(
      'invalid-wire-value',
      `The ${label} must fit the nonnegative signed 64-bit range.`,
    );
  }
  return value;
}

function checkedU128(value: bigint, label: string): bigint {
  if (value < 0n || value > U128_MAX) {
    throw new WokePaymentError(
      'amount-out-of-range',
      `The ${label} exceeds the WokeSocial program's unsigned 128-bit arithmetic domain.`,
    );
  }
  return value;
}

function checkedU128Multiply(left: bigint, right: bigint, label: string): bigint {
  return checkedU128(left * right, label);
}

function checkedU128Add(left: bigint, right: bigint, label: string): bigint {
  return checkedU128(left + right, label);
}

function parseNonce(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== NONCE_BYTES) {
    throw new WokePaymentError(
      'invalid-wire-value',
      `The ${label} must contain exactly ${String(NONCE_BYTES)} bytes.`,
    );
  }
  if (value.every((byte) => byte === 0)) {
    throw new WokePaymentError('invalid-wire-value', `The ${label} cannot be all zeroes.`);
  }
  return Uint8Array.from(value);
}

function parseNonzeroHash(value: Uint8Array, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength !== HASH_BYTES) {
    throw new WokePaymentError(
      'invalid-wire-value',
      `The ${label} must contain exactly ${String(HASH_BYTES)} bytes.`,
    );
  }
  if (value.every((byte) => byte === 0)) {
    throw new WokePaymentError('invalid-wire-value', `The ${label} cannot be all zeroes.`);
  }
  return Uint8Array.from(value);
}

function parseManifestUri(value: string): string {
  if (extractWokeManifestCid(value) === undefined) {
    throw new WokePaymentError(
      'invalid-wire-value',
      'The manifest URI does not satisfy the WokeSocial protocol URI policy.',
    );
  }
  return value;
}

function assertSubscriptionWindow(
  paidAt: bigint,
  priorValidUntil: bigint,
  from: bigint,
  until: bigint,
  errorCode: 'invalid-event' | 'invalid-proof',
): void {
  const paid = parseNonnegativeI64(paidAt, 'subscription paid-at timestamp');
  const prior = parseNonnegativeI64(priorValidUntil, 'prior entitlement timestamp');
  const expectedFrom = paid > prior ? paid : prior;
  const maximumUntil = paid + WEEK_SECONDS * MAX_SUBSCRIPTION_PREPAY_WEEKS;
  if (
    from !== expectedFrom ||
    until !== expectedFrom + WEEK_SECONDS ||
    until > I64_MAX ||
    until > maximumUntil
  ) {
    throw new WokePaymentError(
      errorCode,
      'The legacy SOL subscription window is not the exact one-week extension.',
    );
  }
}

function assertPaidAt(paidAtTimestamp: bigint, paidAtSlot: bigint, observedSlot: bigint): void {
  parseNonnegativeI64(paidAtTimestamp, 'paid-at timestamp');
  parseU64(paidAtSlot, 'paid-at slot');
  if (observedSlot < paidAtSlot) {
    throw new WokePaymentError(
      'invalid-proof',
      'The finalized account slot precedes its claimed legacy SOL settlement slot.',
    );
  }
}

function stripIdentityBytes(recipient: ParsedRecipientSplit): WokeRecipientSplitInput {
  return {
    recipientIdentity: recipient.recipientIdentity,
    destination: recipient.destination,
    basisPoints: recipient.basisPoints,
  };
}

function sameSplits(
  observed: readonly WokeRecipientSplitInput[],
  expected: readonly WokeRecipientAllocation[],
): boolean {
  return (
    observed.length === expected.length &&
    observed.every((split, index) => {
      const candidate = expected[index];
      return (
        candidate !== undefined &&
        split.recipientIdentity === candidate.recipientIdentity &&
        split.destination === candidate.destination &&
        split.basisPoints === candidate.basisPoints
      );
    })
  );
}

function sameBigints(left: readonly bigint[], right: readonly bigint[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return (
    left instanceof Uint8Array &&
    right instanceof Uint8Array &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isZeroHash(value: Uint8Array): boolean {
  return (
    value instanceof Uint8Array && value.length === HASH_BYTES && value.every((byte) => byte === 0)
  );
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftByte = left[index] ?? 0;
    const rightByte = right[index] ?? 0;
    if (leftByte !== rightByte) return leftByte - rightByte;
  }
  return left.length - right.length;
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

  address(value: string): this {
    return this.fixed(addressBytes(value));
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  u8(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new WokePaymentError(
        'invalid-wire-value',
        'A legacy settlement u8 wire value is invalid.',
      );
    }
    this.#bytes.push(value);
    return this;
  }

  u16(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new WokePaymentError(
        'invalid-wire-value',
        'A legacy settlement u16 wire value is invalid.',
      );
    }
    this.#bytes.push(value & 0xff, (value >>> 8) & 0xff);
    return this;
  }

  u32(value: number): this {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
      throw new WokePaymentError(
        'invalid-wire-value',
        'A legacy settlement u32 wire value is invalid.',
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
    let remaining = parseU64(value, 'u64 wire value');
    for (let index = 0; index < 8; index += 1) {
      this.#bytes.push(Number(remaining & 0xffn));
      remaining >>= 8n;
    }
    return this;
  }

  string(value: string): this {
    const encoded = new TextEncoder().encode(value);
    return this.u32(encoded.length).fixed(encoded);
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.#bytes);
  }
}
