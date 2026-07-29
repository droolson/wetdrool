import { sha256 } from '@noble/hashes/sha2.js';
import bs58 from 'bs58';
import { z } from 'zod';

import { handleSchema, solanaPublicKeySchema } from './schema-primitives.js';

export const WOKE_NAME_NAMESPACE_VERSION = 1 as const;
export const WOKE_NAME_SUFFIX = '.woke' as const;
export const WOKE_RANDOM_HANDLE_PREFIX = 'anon_' as const;
export const WOKE_RANDOM_HANDLE_ENTROPY_BITS = 80 as const;

const RANDOM_BYTES = WOKE_RANDOM_HANDLE_ENTROPY_BITS / 8;
const CROCKFORD_BASE32 = '0123456789abcdefghjkmnpqrstvwxyz';
const RANDOM_DERIVATION_DOMAIN = new TextEncoder().encode('wokesocial:woke-name:random:v1\u0000');

const RESERVED_CUSTOM_HANDLES = new Set([
  'admin',
  'appeals',
  'billing',
  'help',
  'legal',
  'moderation',
  'moderator',
  'official',
  'privacy',
  'safety',
  'security',
  'status',
  'support',
  'trust',
  'woke',
  'wokeai',
  'wokenet',
  'wokesocial',
]);

export type WokeNameErrorCode =
  'confusable' | 'invalid-format' | 'invalid-root-authority' | 'reserved-custom-name';

export class WokeNameError extends Error {
  override readonly name = 'WokeNameError';

  constructor(
    readonly code: WokeNameErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export const wokeHandleSchema = handleSchema.refine(
  (handle) => !handle.startsWith('_') && !handle.endsWith('_') && !handle.includes('__'),
  'WokeNet handles cannot start or end with an underscore or contain repeated underscores.',
);

export const wokeNameSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9_]{1,28}[a-z0-9])?\.woke$/u)
  .refine(
    (name) => wokeHandleSchema.safeParse(name.slice(0, -WOKE_NAME_SUFFIX.length)).success,
    'A .woke name must contain one canonical WokeNet handle.',
  );

export interface CanonicalWokeName {
  readonly namespace: 'woke';
  readonly version: typeof WOKE_NAME_NAMESPACE_VERSION;
  readonly handle: string;
  readonly name: string;
}

export interface RandomWokeName extends CanonicalWokeName {
  readonly kind: 'random';
  readonly derivation: 'solana-root-sha256-crockford80-v1';
  readonly entropyBits: typeof WOKE_RANDOM_HANDLE_ENTROPY_BITS;
}

/**
 * Converts a UI name or handle into the exact lowercase ASCII value committed
 * by the v1 WokeNet handle account.
 *
 * Unicode is deliberately rejected rather than silently folded. Display names
 * remain Unicode-capable, while payment/signature destinations stay resistant
 * to homoglyph substitution.
 */
export function canonicalizeWokeName(input: string): CanonicalWokeName {
  if (
    input.length === 0 ||
    input.trim() !== input ||
    [...input].some((character) => (character.codePointAt(0) ?? 0) > 0x7f) ||
    input.normalize('NFKC') !== input
  ) {
    throw new WokeNameError(
      'confusable',
      'A .woke name must use unpadded canonical ASCII without Unicode confusables.',
    );
  }

  let handle = input.toLowerCase();
  if (handle.startsWith('@')) handle = handle.slice(1);
  if (handle.endsWith(WOKE_NAME_SUFFIX)) {
    handle = handle.slice(0, -WOKE_NAME_SUFFIX.length);
  }
  if (!wokeHandleSchema.safeParse(handle).success) {
    throw new WokeNameError(
      'invalid-format',
      'A .woke name must contain 3–30 lowercase letters, digits, or single underscores.',
    );
  }
  return Object.freeze({
    namespace: 'woke',
    version: WOKE_NAME_NAMESPACE_VERSION,
    handle,
    name: `${handle}${WOKE_NAME_SUFFIX}`,
  });
}

/**
 * Derives the registration name from public root material only. No private key,
 * WebAuthn PRF output, email, legal identity, clock, or server state enters the
 * derivation.
 */
export function deriveRandomWokeName(rootAuthorityInput: string): RandomWokeName {
  const parsed = solanaPublicKeySchema.safeParse(rootAuthorityInput);
  if (!parsed.success) {
    throw new WokeNameError(
      'invalid-root-authority',
      'Random .woke allocation requires one canonical 32-byte Solana public key.',
    );
  }

  let rootAuthority: Uint8Array;
  try {
    rootAuthority = bs58.decode(parsed.data);
  } catch {
    throw new WokeNameError(
      'invalid-root-authority',
      'Random .woke allocation requires one canonical 32-byte Solana public key.',
    );
  }
  if (rootAuthority.byteLength !== 32) {
    rootAuthority.fill(0);
    throw new WokeNameError(
      'invalid-root-authority',
      'Random .woke allocation requires one canonical 32-byte Solana public key.',
    );
  }

  const domainBound = new Uint8Array(
    RANDOM_DERIVATION_DOMAIN.byteLength + rootAuthority.byteLength,
  );
  domainBound.set(RANDOM_DERIVATION_DOMAIN);
  domainBound.set(rootAuthority, RANDOM_DERIVATION_DOMAIN.byteLength);
  const digest = sha256(domainBound);
  const randomPart = encodeCrockfordBase32(digest.subarray(0, RANDOM_BYTES));
  domainBound.fill(0);
  rootAuthority.fill(0);
  digest.fill(0);

  const handle = `${WOKE_RANDOM_HANDLE_PREFIX}${randomPart}`;
  if (!wokeHandleSchema.safeParse(handle).success) {
    throw new WokeNameError('invalid-format', 'Derived random .woke handle was invalid.');
  }
  return Object.freeze({
    namespace: 'woke',
    version: WOKE_NAME_NAMESPACE_VERSION,
    kind: 'random',
    derivation: 'solana-root-sha256-crockford80-v1',
    entropyBits: WOKE_RANDOM_HANDLE_ENTROPY_BITS,
    handle,
    name: `${handle}${WOKE_NAME_SUFFIX}`,
  });
}

export function assertCustomWokeNameAllowed(input: string): CanonicalWokeName {
  const canonical = canonicalizeWokeName(input);
  if (
    canonical.handle.startsWith(WOKE_RANDOM_HANDLE_PREFIX) ||
    RESERVED_CUSTOM_HANDLES.has(canonical.handle)
  ) {
    throw new WokeNameError(
      'reserved-custom-name',
      'This handle is reserved for anonymous allocation, safety, or platform operations.',
    );
  }
  return canonical;
}

export function isReservedCustomWokeName(input: string): boolean {
  try {
    const canonical = canonicalizeWokeName(input);
    return (
      canonical.handle.startsWith(WOKE_RANDOM_HANDLE_PREFIX) ||
      RESERVED_CUSTOM_HANDLES.has(canonical.handle)
    );
  } catch {
    return false;
  }
}

function encodeCrockfordBase32(bytes: Uint8Array): string {
  let accumulator = 0;
  let availableBits = 0;
  let output = '';
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    availableBits += 8;
    while (availableBits >= 5) {
      availableBits -= 5;
      output += CROCKFORD_BASE32[(accumulator >>> availableBits) & 31];
      accumulator &= (1 << availableBits) - 1;
    }
  }
  if (availableBits !== 0) {
    output += CROCKFORD_BASE32[(accumulator << (5 - availableBits)) & 31];
  }
  return output;
}
