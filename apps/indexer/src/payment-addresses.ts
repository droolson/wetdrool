import { address, getProgramDerivedAddress } from '@solana/kit';
import bs58 from 'bs58';

const PDA_PREFIX = Uint8Array.from(Buffer.from('wetdrool', 'ascii'));
const PDA_VERSION = Uint8Array.of(1);
const PAYMENT_CONFIG_SEED = Uint8Array.from(Buffer.from('payment_config', 'ascii'));
const SUBSCRIPTION_OFFERING_SEED = Uint8Array.from(Buffer.from('subscription_offering', 'ascii'));
const PAYMENT_RECEIPT_SEED = Uint8Array.from(Buffer.from('payment_receipt', 'ascii'));
const SUBSCRIPTION_ENTITLEMENT_SEED = Uint8Array.from(
  Buffer.from('subscription_entitlement', 'ascii'),
);

export async function derivePaymentConfigAddress(programId: string): Promise<string> {
  const [paymentConfigAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [PDA_PREFIX, PDA_VERSION, PAYMENT_CONFIG_SEED],
  });
  return paymentConfigAddress;
}

export async function deriveSubscriptionOfferingAddress(
  programId: string,
  creatorIdentityAddress: string,
  offeringNonce: Uint8Array,
): Promise<string> {
  assertNonce(offeringNonce);
  const [offeringAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      SUBSCRIPTION_OFFERING_SEED,
      bs58.decode(creatorIdentityAddress),
      offeringNonce,
    ],
  });
  return offeringAddress;
}

export async function derivePaymentReceiptAddress(
  programId: string,
  payerIdentityAddress: string,
  receiptNonce: Uint8Array,
): Promise<string> {
  assertNonce(receiptNonce);
  const [receiptAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      PAYMENT_RECEIPT_SEED,
      bs58.decode(payerIdentityAddress),
      receiptNonce,
    ],
  });
  return receiptAddress;
}

export async function deriveSubscriptionEntitlementAddress(
  programId: string,
  offeringAddress: string,
  beneficiaryIdentityAddress: string,
): Promise<string> {
  const [entitlementAddress] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      PDA_PREFIX,
      PDA_VERSION,
      SUBSCRIPTION_ENTITLEMENT_SEED,
      bs58.decode(offeringAddress),
      bs58.decode(beneficiaryIdentityAddress),
    ],
  });
  return entitlementAddress;
}

function assertNonce(nonce: Uint8Array): void {
  if (nonce.byteLength !== 16) {
    throw new Error('Payment nonce must contain exactly 16 bytes.');
  }
  if (nonce.every((byte) => byte === 0)) {
    throw new Error('Payment nonce cannot be zero.');
  }
}
