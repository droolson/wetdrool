import {
  MAX_RECIPIENT_SPLITS,
  paymentAssetSchema,
  recipientSplitSchema,
  solanaPublicKeySchema,
  type PaymentAsset,
} from '@wokesocial/protocol';

const BASIS_POINTS_DENOMINATOR = 10_000n;
const U64_MAX = 18_446_744_073_709_551_615n;

export type PaymentPlanErrorCode =
  | 'amount-out-of-range'
  | 'duplicate-destination'
  | 'invalid-fee'
  | 'invalid-recipient'
  | 'rounding-underflow'
  | 'simulation-mismatch'
  | 'unsupported-asset';

export class PaymentPlanError extends Error {
  override readonly name = 'PaymentPlanError';

  constructor(
    readonly code: PaymentPlanErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ResolvedRecipientSplit {
  readonly recipient: string;
  readonly destination: string;
  readonly basisPoints: number;
}

export interface ProtocolFee {
  readonly basisPoints: number;
  readonly destination: string;
}

export interface PaymentPlanInput {
  readonly asset: PaymentAsset;
  readonly grossAmount: string;
  readonly allowedAssets: readonly PaymentAsset[];
  readonly protocolFee: ProtocolFee;
  readonly recipientSplits: readonly ResolvedRecipientSplit[];
}

export interface PlannedTransfer {
  readonly kind: 'protocol-fee' | 'recipient';
  readonly asset: PaymentAsset;
  readonly destination: string;
  readonly amount: string;
  readonly recipient?: string;
  readonly basisPoints?: number;
}

export interface PaymentPlan {
  readonly asset: PaymentAsset;
  readonly grossAmount: string;
  readonly protocolFeeAmount: string;
  readonly distributableAmount: string;
  readonly roundingPolicy: 'largest-remainder-recipient-id';
  readonly transfers: readonly PlannedTransfer[];
}

export interface ObservedTransfer {
  readonly asset: PaymentAsset;
  readonly destination: string;
  readonly amount: string;
}

/**
 * Calculates an exact integer-base-unit transfer plan. The protocol fee is
 * deducted from the gross amount with floor rounding. Recipient rounding uses
 * the Hamilton/largest-remainder method with recipient-ID lexical tie-breaking,
 * so input array order cannot redirect the residual units.
 */
export function calculatePaymentPlan(input: PaymentPlanInput): PaymentPlan {
  const asset = paymentAssetSchema.parse(input.asset);
  assertAllowedAsset(asset, input.allowedAssets);
  const grossAmount = parseBaseUnitAmount(input.grossAmount, 'gross amount');
  const protocolFee = parseProtocolFee(input.protocolFee);
  const recipients = parseRecipients(input.recipientSplits);

  const protocolFeeAmount =
    (grossAmount * BigInt(protocolFee.basisPoints)) / BASIS_POINTS_DENOMINATOR;
  const distributableAmount = grossAmount - protocolFeeAmount;
  if (distributableAmount < 1n) {
    throw new PaymentPlanError(
      'rounding-underflow',
      'The protocol fee leaves no base units for recipients.',
    );
  }

  const allocations = recipients.map((recipient) => {
    const numerator = distributableAmount * BigInt(recipient.basisPoints);
    return {
      recipient,
      amount: numerator / BASIS_POINTS_DENOMINATOR,
      remainder: numerator % BASIS_POINTS_DENOMINATOR,
    };
  });
  let residual =
    distributableAmount - allocations.reduce((sum, allocation) => sum + allocation.amount, 0n);
  const residualOrder = [...allocations].sort((left, right) => {
    if (left.remainder !== right.remainder) {
      return left.remainder > right.remainder ? -1 : 1;
    }
    return compareAscii(left.recipient.recipient, right.recipient.recipient);
  });
  for (const allocation of residualOrder) {
    if (residual === 0n) {
      break;
    }
    allocation.amount += 1n;
    residual -= 1n;
  }
  if (residual !== 0n || allocations.some((allocation) => allocation.amount < 1n)) {
    throw new PaymentPlanError(
      'rounding-underflow',
      'The amount is too small to pay every declared recipient at least one base unit.',
    );
  }

  const transfers: PlannedTransfer[] = [];
  if (protocolFeeAmount > 0n) {
    transfers.push({
      kind: 'protocol-fee',
      asset,
      destination: protocolFee.destination,
      amount: protocolFeeAmount.toString(),
      basisPoints: protocolFee.basisPoints,
    });
  }
  transfers.push(
    ...allocations
      .sort((left, right) => compareAscii(left.recipient.recipient, right.recipient.recipient))
      .map((allocation): PlannedTransfer => ({
        kind: 'recipient',
        asset,
        destination: allocation.recipient.destination,
        amount: allocation.amount.toString(),
        recipient: allocation.recipient.recipient,
        basisPoints: allocation.recipient.basisPoints,
      })),
  );

  const plannedTotal = transfers.reduce((sum, transfer) => sum + BigInt(transfer.amount), 0n);
  if (plannedTotal !== grossAmount) {
    throw new PaymentPlanError('rounding-underflow', 'The transfer plan does not conserve value.');
  }

  return {
    asset,
    grossAmount: grossAmount.toString(),
    protocolFeeAmount: protocolFeeAmount.toString(),
    distributableAmount: distributableAmount.toString(),
    roundingPolicy: 'largest-remainder-recipient-id',
    transfers,
  };
}

/**
 * Compares a parsed transaction simulation with the exact proposed transfers.
 * Callers must extract only native/token transfer instructions; transaction
 * fees and unrelated balance changes must not be passed as observations.
 */
export function assertPaymentSimulationMatches(
  plan: PaymentPlan,
  observedTransfers: readonly ObservedTransfer[],
): void {
  const expected = plan.transfers.map((transfer) =>
    observationKey({
      asset: transfer.asset,
      destination: transfer.destination,
      amount: transfer.amount,
    }),
  );
  let observed: string[];
  try {
    observed = observedTransfers.map((transfer) => {
      const asset = paymentAssetSchema.parse(transfer.asset);
      const destination = solanaPublicKeySchema.parse(transfer.destination);
      const amount = parseBaseUnitAmount(transfer.amount, 'observed transfer amount');
      return observationKey({ asset, destination, amount: amount.toString() });
    });
  } catch (error) {
    throw new PaymentPlanError(
      'simulation-mismatch',
      'The simulation contained an invalid asset, recipient, or amount.',
      { cause: error },
    );
  }

  expected.sort(compareAscii);
  observed.sort(compareAscii);
  if (
    expected.length !== observed.length ||
    expected.some((transfer, index) => transfer !== observed[index])
  ) {
    throw new PaymentPlanError(
      'simulation-mismatch',
      'The simulated asset, recipient, amount, or transfer count differs from the approved plan.',
    );
  }
}

function assertAllowedAsset(asset: PaymentAsset, allowedAssets: readonly PaymentAsset[]): void {
  const requested = assetKey(asset);
  const allowed = allowedAssets.some((candidate) => {
    const parsed = paymentAssetSchema.safeParse(candidate);
    return parsed.success && assetKey(parsed.data) === requested;
  });
  if (!allowed) {
    throw new PaymentPlanError(
      'unsupported-asset',
      'The exact asset mint, decimals, and token program are not allowlisted.',
    );
  }
}

function parseProtocolFee(fee: ProtocolFee): ProtocolFee {
  if (
    !Number.isInteger(fee.basisPoints) ||
    fee.basisPoints < 0 ||
    fee.basisPoints >= Number(BASIS_POINTS_DENOMINATOR)
  ) {
    throw new PaymentPlanError(
      'invalid-fee',
      'Protocol fee basis points must be an integer from 0 through 9,999.',
    );
  }
  try {
    return {
      basisPoints: fee.basisPoints,
      destination: solanaPublicKeySchema.parse(fee.destination),
    };
  } catch (error) {
    throw new PaymentPlanError('invalid-fee', 'The protocol fee destination is invalid.', {
      cause: error,
    });
  }
}

function parseRecipients(input: readonly ResolvedRecipientSplit[]): ResolvedRecipientSplit[] {
  if (input.length < 1 || input.length > MAX_RECIPIENT_SPLITS) {
    throw new PaymentPlanError(
      'invalid-recipient',
      `Payment plans require between 1 and ${String(MAX_RECIPIENT_SPLITS)} recipient splits.`,
    );
  }
  const recipients = input.map((candidate) => {
    try {
      const split = recipientSplitSchema.parse({
        recipient: candidate.recipient,
        basisPoints: candidate.basisPoints,
      });
      return {
        recipient: split.recipient,
        basisPoints: split.basisPoints,
        destination: solanaPublicKeySchema.parse(candidate.destination),
      };
    } catch (error) {
      throw new PaymentPlanError('invalid-recipient', 'A recipient split is invalid.', {
        cause: error,
      });
    }
  });
  if (new Set(recipients.map((recipient) => recipient.recipient)).size !== recipients.length) {
    throw new PaymentPlanError('invalid-recipient', 'Recipient identities must be unique.');
  }
  if (new Set(recipients.map((recipient) => recipient.destination)).size !== recipients.length) {
    throw new PaymentPlanError(
      'duplicate-destination',
      'Each recipient identity must resolve to a distinct destination.',
    );
  }
  if (
    recipients.reduce((sum, recipient) => sum + recipient.basisPoints, 0) !==
    Number(BASIS_POINTS_DENOMINATOR)
  ) {
    throw new PaymentPlanError(
      'invalid-recipient',
      'Recipient splits must total exactly 10,000 basis points.',
    );
  }
  return recipients;
}

function parseBaseUnitAmount(value: string, label: string): bigint {
  if (!/^[1-9]\d{0,19}$/u.test(value)) {
    throw new PaymentPlanError(
      'amount-out-of-range',
      `The ${label} must be a positive canonical integer.`,
    );
  }
  const amount = BigInt(value);
  if (amount > U64_MAX) {
    throw new PaymentPlanError(
      'amount-out-of-range',
      `The ${label} exceeds WokeNet's unsigned 64-bit transfer range.`,
    );
  }
  return amount;
}

function assetKey(asset: PaymentAsset): string {
  return asset.kind === 'woke'
    ? 'woke'
    : `spl:${asset.mint}:${String(asset.decimals)}:${asset.tokenProgram}`;
}

function observationKey(transfer: ObservedTransfer): string {
  return `${assetKey(transfer.asset)}\u0000${transfer.destination}\u0000${transfer.amount}`;
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
