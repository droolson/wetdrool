import bs58 from 'bs58';

export const MAX_PROTOCOL_FEE_BPS = 1_000;
export const BASIS_POINTS_DENOMINATOR = 10_000;
export const WEEK_SECONDS = 604_800n;
export const MAX_SUBSCRIPTION_PREPAY_WEEKS = 52n;
const MAX_U64 = 18_446_744_073_709_551_615n;
const MAX_I64 = 9_223_372_036_854_775_807n;

export interface PaymentSplitInput {
  readonly recipientIdentityId: string;
  readonly recipientIdentityAddress: string;
  readonly destination: string;
  readonly basisPoints: number;
}

export interface PaymentAllocation {
  readonly feeLamports: bigint;
  readonly distributableLamports: bigint;
  readonly recipientAmounts: readonly bigint[];
}

export class PaymentInvariantError extends Error {
  override readonly name = 'PaymentInvariantError';
}

export function calculatePaymentAllocation(
  grossLamports: bigint,
  feeBps: number,
  splits: readonly PaymentSplitInput[],
): PaymentAllocation {
  if (grossLamports <= 0n || grossLamports > MAX_U64) {
    throw new PaymentInvariantError('Payment amount must be a positive u64.');
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > MAX_PROTOCOL_FEE_BPS) {
    throw new PaymentInvariantError('Payment fee is outside the supported range.');
  }
  validatePaymentSplits(splits);

  const feeLamports = (grossLamports * BigInt(feeBps)) / BigInt(BASIS_POINTS_DENOMINATOR);
  const distributableLamports = grossLamports - feeLamports;
  if (distributableLamports <= 0n) {
    throw new PaymentInvariantError('Payment rounds to no distributable value.');
  }

  const recipientAmounts = splits.map(
    (split) =>
      (distributableLamports * BigInt(split.basisPoints)) / BigInt(BASIS_POINTS_DENOMINATOR),
  );
  const remainders = splits.map(
    (split) =>
      (distributableLamports * BigInt(split.basisPoints)) % BigInt(BASIS_POINTS_DENOMINATOR),
  );
  let residual =
    distributableLamports - recipientAmounts.reduce((total, amount) => total + amount, 0n);
  const remainderOrder = splits
    .map((split, index) => ({ index, remainder: remainders[index] ?? 0n, split }))
    .sort(
      (left, right) =>
        compareBigInt(right.remainder, left.remainder) ||
        comparePublicKeys(
          left.split.recipientIdentityAddress,
          right.split.recipientIdentityAddress,
        ),
    );
  for (const { index } of remainderOrder) {
    if (residual === 0n) break;
    recipientAmounts[index] = (recipientAmounts[index] ?? 0n) + 1n;
    residual -= 1n;
  }
  if (
    residual !== 0n ||
    recipientAmounts.some((amount) => amount <= 0n) ||
    feeLamports + recipientAmounts.reduce((total, amount) => total + amount, 0n) !== grossLamports
  ) {
    throw new PaymentInvariantError('Payment allocation violates conservation.');
  }
  return { feeLamports, distributableLamports, recipientAmounts };
}

export function validatePaymentSplits(splits: readonly PaymentSplitInput[]): void {
  if (splits.length < 1 || splits.length > 3) {
    throw new PaymentInvariantError('Payment must contain between one and three recipients.');
  }
  let basisPointTotal = 0;
  const destinations = new Set<string>();
  for (const [index, split] of splits.entries()) {
    if (
      !Number.isInteger(split.basisPoints) ||
      split.basisPoints <= 0 ||
      split.basisPoints > BASIS_POINTS_DENOMINATOR
    ) {
      throw new PaymentInvariantError('Payment split basis points are invalid.');
    }
    assertPublicKey(split.recipientIdentityAddress, 'Payment recipient identity');
    assertPublicKey(split.destination, 'Payment destination');
    basisPointTotal += split.basisPoints;
    if (destinations.has(split.destination)) {
      throw new PaymentInvariantError('Payment destinations must be distinct.');
    }
    destinations.add(split.destination);
    const previous = splits[index - 1];
    if (
      previous !== undefined &&
      comparePublicKeys(previous.recipientIdentityAddress, split.recipientIdentityAddress) >= 0
    ) {
      throw new PaymentInvariantError('Payment recipients must be strictly ordered.');
    }
  }
  if (basisPointTotal !== BASIS_POINTS_DENOMINATOR) {
    throw new PaymentInvariantError('Payment split basis points must total 10,000.');
  }
}

export function calculateSubscriptionWindow(
  paidAtTimestamp: bigint,
  priorValidUntilTimestamp: bigint,
): { readonly fromTimestamp: bigint; readonly untilTimestamp: bigint } {
  if (
    paidAtTimestamp < 0n ||
    priorValidUntilTimestamp < 0n ||
    paidAtTimestamp > MAX_I64 ||
    priorValidUntilTimestamp > MAX_I64
  ) {
    throw new PaymentInvariantError('Payment timestamps must be non-negative i64 values.');
  }
  const fromTimestamp =
    paidAtTimestamp > priorValidUntilTimestamp ? paidAtTimestamp : priorValidUntilTimestamp;
  const untilTimestamp = fromTimestamp + WEEK_SECONDS;
  const maximumValidUntil = paidAtTimestamp + WEEK_SECONDS * MAX_SUBSCRIPTION_PREPAY_WEEKS;
  if (untilTimestamp > MAX_I64) {
    throw new PaymentInvariantError('Subscription window exceeds the supported timestamp range.');
  }
  if (untilTimestamp > maximumValidUntil) {
    throw new PaymentInvariantError('Subscription prepayment exceeds 52 weeks.');
  }
  return { fromTimestamp, untilTimestamp };
}

function comparePublicKeys(left: string, right: string): number {
  return Buffer.compare(bs58.decode(left), bs58.decode(right));
}

function assertPublicKey(value: string, label: string): void {
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(value);
  } catch {
    throw new PaymentInvariantError(`${label} is not valid base58.`);
  }
  if (decoded.byteLength !== 32) {
    throw new PaymentInvariantError(`${label} must decode to exactly 32 bytes.`);
  }
}

function compareBigInt(left: bigint, right: bigint): number {
  return left === right ? 0 : left < right ? -1 : 1;
}
