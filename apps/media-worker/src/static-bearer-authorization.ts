import { createHash, timingSafeEqual } from 'node:crypto';

import type { MediaWorkerAppOptions } from './app.js';

const minimumTokenBytes = 32;
const maximumTokenBytes = 128;
const minimumEncodedTokenCharacters = 43;
const maximumEncodedTokenCharacters = 171;
const maximumOwnedUploads = 100_000;
const bearerPattern = new RegExp(
  `^Bearer ([A-Za-z0-9_-]{${String(minimumEncodedTokenCharacters)},${String(
    maximumEncodedTokenCharacters,
  )}})$`,
  'u',
);

type AuthorizationInput = Parameters<NonNullable<MediaWorkerAppOptions['authorizeRequest']>>[0];

/**
 * A single-operator adapter for local deployments. The token authenticates one
 * process-local principal, and claim binds generated upload IDs to it.
 */
export class StaticBearerAuthorization {
  readonly #expectedDigest: Buffer;
  readonly #ownedUploads = new Set<string>();

  constructor(encodedToken: string) {
    assertStrongEncodedToken(encodedToken);
    this.#expectedDigest = digestToken(encodedToken);
  }

  readonly authorize = (input: AuthorizationInput): boolean => {
    if (!this.#authenticate(input.authorization)) {
      return false;
    }
    switch (input.action) {
      case 'create':
        return input.uploadId === undefined && input.declaration !== undefined;
      case 'claim':
        if (input.uploadId === undefined || input.declaration === undefined) {
          return false;
        }
        if (
          !this.#ownedUploads.has(input.uploadId) &&
          this.#ownedUploads.size >= maximumOwnedUploads
        ) {
          return false;
        }
        this.#ownedUploads.add(input.uploadId);
        return true;
      case 'read':
      case 'append':
      case 'cancel':
      case 'finalize':
        return input.uploadId !== undefined && this.#ownedUploads.has(input.uploadId);
    }
  };

  #authenticate(authorization: string | undefined): boolean {
    const match = authorization?.match(bearerPattern);
    const candidate = match?.[1] ?? '';
    const candidateDigest = digestToken(candidate);
    return (
      match !== null &&
      match !== undefined &&
      timingSafeEqual(candidateDigest, this.#expectedDigest)
    );
  }
}

export function assertStrongEncodedToken(encodedToken: string): void {
  if (
    !/^[A-Za-z0-9_-]+$/u.test(encodedToken) ||
    encodedToken.length < minimumEncodedTokenCharacters ||
    encodedToken.length > maximumEncodedTokenCharacters
  ) {
    throw new TypeError('Static bearer token must be canonical base64url data.');
  }
  const decoded = Buffer.from(encodedToken, 'base64url');
  if (
    decoded.byteLength < minimumTokenBytes ||
    decoded.byteLength > maximumTokenBytes ||
    decoded.toString('base64url') !== encodedToken
  ) {
    decoded.fill(0);
    throw new TypeError(
      `Static bearer token must encode ${String(minimumTokenBytes)} to ${String(
        maximumTokenBytes,
      )} bytes.`,
    );
  }
  decoded.fill(0);
}

function digestToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}
