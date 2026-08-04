import { strict as assert } from "node:assert";

import { web3 } from "@coral-xyz/anchor";

import type { Phase2Context } from "./phase2_test_helpers";

const { PublicKey, SystemProgram, Transaction } = web3;

const PDA_PREFIX = Buffer.from("wetdrool");
const PDA_VERSION = Buffer.from([1]);
const PAYMENT_CONFIG_SEED = Buffer.from("payment_config");
const SUBSCRIPTION_OFFERING_SEED = Buffer.from("subscription_offering");
const PAYMENT_RECEIPT_SEED = Buffer.from("payment_receipt");
const SUBSCRIPTION_ENTITLEMENT_SEED = Buffer.from("subscription_entitlement");

export const PAYMENT_CONFIG_SPACE = 133;
export const SUBSCRIPTION_OFFERING_SPACE = 622;
export const PAYMENT_RECEIPT_SPACE = 457;
export const SUBSCRIPTION_ENTITLEMENT_SPACE = 210;
export const WEEK_SECONDS = 604_800;
export const UPGRADEABLE_LOADER_PROGRAM_ID = new PublicKey(
  "BPFLoaderUpgradeab1e11111111111111111111111",
);

export interface PaymentSplitFixture {
  basisPoints: number;
  destination: web3.PublicKey;
  identity: web3.PublicKey;
}

export interface NativeAllocationFixture {
  distributableLamports: bigint;
  feeLamports: bigint;
  orderedSplits: PaymentSplitFixture[];
  recipientAmounts: bigint[];
}

export function derivePaymentConfig(programId: web3.PublicKey): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [PDA_PREFIX, PDA_VERSION, PAYMENT_CONFIG_SEED],
    programId,
  )[0];
}

export function deriveProgramData(programId: web3.PublicKey): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [programId.toBuffer()],
    UPGRADEABLE_LOADER_PROGRAM_ID,
  )[0];
}

export function deriveSubscriptionOffering(
  programId: web3.PublicKey,
  creatorIdentity: web3.PublicKey,
  offeringNonce: number[],
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      SUBSCRIPTION_OFFERING_SEED,
      creatorIdentity.toBuffer(),
      Buffer.from(offeringNonce),
    ],
    programId,
  )[0];
}

export function derivePaymentReceipt(
  programId: web3.PublicKey,
  payerIdentity: web3.PublicKey,
  receiptNonce: number[],
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      PAYMENT_RECEIPT_SEED,
      payerIdentity.toBuffer(),
      Buffer.from(receiptNonce),
    ],
    programId,
  )[0];
}

export function deriveSubscriptionEntitlement(
  programId: web3.PublicKey,
  offering: web3.PublicKey,
  beneficiaryIdentity: web3.PublicKey,
): web3.PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      PDA_PREFIX,
      PDA_VERSION,
      SUBSCRIPTION_ENTITLEMENT_SEED,
      offering.toBuffer(),
      beneficiaryIdentity.toBuffer(),
    ],
    programId,
  )[0];
}

function comparePublicKeys(
  left: web3.PublicKey,
  right: web3.PublicKey,
): number {
  return Buffer.compare(left.toBuffer(), right.toBuffer());
}

export function calculateNativeAllocation(
  grossLamports: bigint,
  feeBps: number,
  splits: PaymentSplitFixture[],
): NativeAllocationFixture {
  assert.ok(grossLamports > 0n);
  assert.ok(feeBps >= 0 && feeBps <= 1_000);
  assert.ok(splits.length >= 1 && splits.length <= 3);
  assert.equal(
    splits.reduce((total, split) => total + split.basisPoints, 0),
    10_000,
  );

  const orderedSplits = [...splits].sort((left, right) =>
    comparePublicKeys(left.identity, right.identity),
  );
  const feeLamports = (grossLamports * BigInt(feeBps)) / 10_000n;
  const distributableLamports = grossLamports - feeLamports;
  const recipientAmounts = orderedSplits.map(
    (split) =>
      (distributableLamports * BigInt(split.basisPoints)) / 10_000n,
  );
  const remainders = orderedSplits.map(
    (split) =>
      (distributableLamports * BigInt(split.basisPoints)) % 10_000n,
  );
  let residual =
    distributableLamports -
    recipientAmounts.reduce((total, amount) => total + amount, 0n);
  const remainderOrder = orderedSplits
    .map((split, index) => ({ index, remainder: remainders[index] ?? 0n, split }))
    .sort(
      (left, right) =>
        (left.remainder === right.remainder
          ? 0
          : left.remainder > right.remainder
            ? -1
            : 1) || comparePublicKeys(left.split.identity, right.split.identity),
    );
  for (const { index } of remainderOrder) {
    if (residual === 0n) {
      break;
    }
    recipientAmounts[index] = (recipientAmounts[index] ?? 0n) + 1n;
    residual -= 1n;
  }

  assert.equal(residual, 0n);
  assert.ok(recipientAmounts.every((amount) => amount > 0n));
  assert.equal(
    feeLamports +
      recipientAmounts.reduce((total, amount) => total + amount, 0n),
    grossLamports,
  );
  return {
    distributableLamports,
    feeLamports,
    orderedSplits,
    recipientAmounts,
  };
}

export async function fundSystemAccounts(
  context: Phase2Context,
  destinations: { address: web3.PublicKey; lamports: number }[],
): Promise<void> {
  const transaction = new Transaction();
  for (const destination of destinations) {
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: context.provider.wallet.publicKey,
        toPubkey: destination.address,
        lamports: destination.lamports,
      }),
    );
  }
  await context.provider.sendAndConfirm(transaction, [], {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
}

export async function readBalances(
  context: Phase2Context,
  addresses: web3.PublicKey[],
): Promise<Map<string, number>> {
  const balances = await Promise.all(
    addresses.map((address) =>
      context.provider.connection.getBalance(address, "confirmed"),
    ),
  );
  return new Map(
    addresses.map((address, index) => [
      address.toBase58(),
      balances[index] ?? 0,
    ]),
  );
}

export function balanceAt(
  balances: Map<string, number>,
  address: web3.PublicKey,
): number {
  const balance = balances.get(address.toBase58());
  assert.notEqual(balance, undefined, `missing balance for ${address.toBase58()}`);
  return balance ?? 0;
}
