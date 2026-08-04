import {
  deriveRandomWokeName,
  identityIdSchema,
  solanaPublicKeySchema,
} from '@wetdrool/protocol';
import { derivePrimaryWokeIdentityCoordinates } from '@wetdrool/sdk';
import bs58 from 'bs58';

import type { SynchronizedBundle } from './auth/auth-api';
import { decodeBase64Url } from './auth/passkey-codec';
import type { LocalnetPublicationRuntime } from './localnet-publication-config';

export type SolanaDestinationErrorCode =
  'bundle-conflict' | 'bundle-missing' | 'invalid-public-key';

export class SolanaDestinationError extends Error {
  override readonly name = 'SolanaDestinationError';

  constructor(
    readonly code: SolanaDestinationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/**
 * The exact coordinates a disclosure was derived for. A cached disclosure is
 * valid only while every binding value still matches; any difference means the
 * cached destination is stale and must be discarded, never reused.
 */
export interface SolanaDestinationBinding {
  readonly accountId: string;
  readonly networkId: string;
  readonly programAddress: string;
  readonly publicKey: string;
}

/**
 * The deliberate pre-signature view of the underlying Solana destination. A
 * `.drool` name is DroolNet metadata; the values below are what a signature
 * actually targets on the configured deployment.
 */
export interface SolanaDestinationDisclosure {
  readonly binding: SolanaDestinationBinding;
  readonly genesisHash: string;
  readonly identityAddress: string;
  readonly identityId: string;
  readonly networkId: string;
  readonly programAddress: string;
  readonly rootAuthority: string;
  readonly wokeNameCandidate: string;
}

/**
 * Extracts the one synchronized root public key from the account's
 * ciphertext-only key wrappers. Every wrapper must agree on the exact same
 * canonical 32-byte key; disagreement or absence fails closed rather than
 * disclosing a destination that the fresh passkey ceremony might not match.
 */
export function readSynchronizedRootPublicKey(bundles: readonly SynchronizedBundle[]): string {
  let agreed: string | undefined;
  for (const synchronized of bundles) {
    const publicKey = bundlePublicKey(synchronized.bundle);
    if (publicKey === undefined) {
      throw new SolanaDestinationError(
        'invalid-public-key',
        'A synchronized key wrapper did not contain one canonical 32-byte public key.',
      );
    }
    if (agreed !== undefined && agreed !== publicKey) {
      throw new SolanaDestinationError(
        'bundle-conflict',
        'The synchronized key wrappers disagree about the root public key. No destination is disclosed until the account state is repaired.',
      );
    }
    agreed = publicKey;
  }
  if (agreed === undefined) {
    throw new SolanaDestinationError(
      'bundle-missing',
      'No synchronized key wrapper exists for this account, so no Solana destination can be disclosed.',
    );
  }
  return agreed;
}

export interface DeriveSolanaDestinationInput {
  readonly accountId: string;
  readonly publicKey: string;
  readonly runtime: LocalnetPublicationRuntime;
}

/**
 * Derives the exact destination the next signature would target: the root
 * authority, its deterministic primary identity account on the configured
 * DroolNet deployment, and the deterministic anonymous `.drool` candidate. The
 * derivation is pure and never claims that any account exists onchain.
 */
export async function deriveSolanaDestinationDisclosure(
  input: DeriveSolanaDestinationInput,
): Promise<SolanaDestinationDisclosure> {
  const rootAuthority = rootAuthorityFromPublicKey(input.publicKey);
  const coordinates = await derivePrimaryWokeIdentityCoordinates(
    input.runtime.context,
    rootAuthority,
  );
  const identityId = identityIdSchema.parse(
    `wetdroolid:v1:${input.runtime.networkId}:${coordinates.identityAddress}`,
  );
  return Object.freeze({
    binding: Object.freeze({
      accountId: input.accountId,
      networkId: input.runtime.networkId,
      programAddress: input.runtime.context.programAddress,
      publicKey: input.publicKey,
    }),
    genesisHash: input.runtime.context.genesisHash,
    identityAddress: coordinates.identityAddress,
    identityId,
    networkId: input.runtime.networkId,
    programAddress: input.runtime.context.programAddress,
    rootAuthority,
    wokeNameCandidate: deriveRandomWokeName(rootAuthority).name,
  });
}

export interface SolanaDestinationCache {
  invalidate(): void;
  peek(): SolanaDestinationDisclosure | null;
  resolve(input: DeriveSolanaDestinationInput): Promise<SolanaDestinationDisclosure>;
}

export interface SolanaDestinationCacheDependencies {
  readonly derive?: typeof deriveSolanaDestinationDisclosure;
}

/**
 * Caches at most one disclosure and returns it only while the account, key,
 * deployment, and program bindings all still match exactly. Any binding change
 * discards the stale entry before recomputing, so a rotated key, a different
 * account, or a different deployment can never surface a previous destination.
 */
export function createSolanaDestinationCache(
  dependencies: SolanaDestinationCacheDependencies = {},
): SolanaDestinationCache {
  const derive = dependencies.derive ?? deriveSolanaDestinationDisclosure;
  let cached: SolanaDestinationDisclosure | null = null;
  return {
    invalidate(): void {
      cached = null;
    },
    peek(): SolanaDestinationDisclosure | null {
      return cached;
    },
    async resolve(input: DeriveSolanaDestinationInput): Promise<SolanaDestinationDisclosure> {
      if (cached !== null && bindingMatches(cached.binding, input)) {
        return cached;
      }
      cached = null;
      const disclosure = await derive(input);
      cached = disclosure;
      return disclosure;
    },
  };
}

function bindingMatches(
  binding: SolanaDestinationBinding,
  input: DeriveSolanaDestinationInput,
): boolean {
  return (
    binding.accountId === input.accountId &&
    binding.publicKey === input.publicKey &&
    binding.networkId === input.runtime.networkId &&
    binding.programAddress === input.runtime.context.programAddress
  );
}

function rootAuthorityFromPublicKey(publicKey: string): string {
  let decoded: Uint8Array | undefined;
  try {
    decoded = decodeBase64Url(publicKey, 32);
    if (decoded.length !== 32) {
      throw new TypeError('The synchronized public key must be exactly 32 bytes.');
    }
    const rootAuthority = bs58.encode(decoded);
    const parsed = solanaPublicKeySchema.safeParse(rootAuthority);
    if (!parsed.success) {
      throw new TypeError('The synchronized public key is not a canonical Solana authority.');
    }
    return parsed.data;
  } catch (error) {
    throw new SolanaDestinationError(
      'invalid-public-key',
      'The synchronized public key could not be disclosed as a canonical Solana destination.',
      { cause: error },
    );
  } finally {
    decoded?.fill(0);
  }
}

function bundlePublicKey(bundle: unknown): string | undefined {
  if (typeof bundle !== 'object' || bundle === null) return undefined;
  const publicKey = (bundle as { readonly publicKey?: unknown }).publicKey;
  if (typeof publicKey !== 'string') return undefined;
  try {
    const decoded = decodeBase64Url(publicKey, 32);
    const exact = decoded.length === 32;
    decoded.fill(0);
    return exact ? publicKey : undefined;
  } catch {
    return undefined;
  }
}
