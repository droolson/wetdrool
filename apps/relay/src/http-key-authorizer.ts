import { randomUUID } from 'node:crypto';

import { networkIdSchema, unsigned64Schema } from '@wokesocial/protocol';
import { z } from 'zod';

import { HttpAuthorizerClient, parseHttpAuthorizerEndpoint } from './http-authorizer-client.js';
import type { RelayKeyAuthorization, RelayKeyAuthorizer } from './protocol.js';

const authorizationResponseSchema = z
  .object({
    version: z.literal('wokesocial-relay-key-authorization-v1'),
    requestId: z.uuid(),
    authorized: z.boolean(),
    finalized: z.literal(true),
    networkId: networkIdSchema,
    checkpointSlot: unsigned64Schema,
    evaluatedAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .strict();
const readinessResponseSchema = z.object({ ok: z.literal(true) }).passthrough();

export interface HttpRelayKeyAuthorizerOptions {
  readonly endpoint: string;
  readonly readinessEndpoint: string;
  readonly bearerToken?: string;
  readonly timeoutMilliseconds: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly requestId?: () => string;
}

/**
 * Fail-closed adapter for an independently replaceable finalized-state
 * authorizer. The remote response is nonce-bound, short-lived, network-bound,
 * size-bounded, and must explicitly attest finalized evaluation.
 */
export class HttpRelayKeyAuthorizer {
  readonly #endpoint: URL;
  readonly #readinessEndpoint: URL;
  readonly #client: HttpAuthorizerClient;
  readonly #now: () => Date;
  readonly #requestId: () => string;

  constructor(options: HttpRelayKeyAuthorizerOptions) {
    this.#endpoint = parseHttpAuthorizerEndpoint(options.endpoint);
    this.#readinessEndpoint = parseHttpAuthorizerEndpoint(options.readinessEndpoint);
    this.#client = new HttpAuthorizerClient(options);
    this.#now = options.now ?? (() => new Date());
    this.#requestId = options.requestId ?? randomUUID;
  }

  readonly authorize: RelayKeyAuthorizer = async (input) => {
    const requestId = this.#requestId();
    try {
      const parsed = authorizationResponseSchema.safeParse(
        await this.#client.requestJson(this.#endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            version: 'wokesocial-relay-key-authorization-v1',
            requestId,
            identityId: input.identityId,
            keyId: input.keyId,
            purpose: input.purpose,
            issuedAt: input.issuedAt,
          }),
        }),
      );
      if (!parsed.success || parsed.data.requestId !== requestId) {
        return false;
      }
      const decision = parsed.data;
      const now = this.#now().getTime();
      const evaluatedAt = Date.parse(decision.evaluatedAt);
      const expiresAt = Date.parse(decision.expiresAt);
      return (
        decision.networkId === networkIdFromIdentity(input.identityId) &&
        evaluatedAt <= now + 5_000 &&
        evaluatedAt >= now - 30_000 &&
        expiresAt > now &&
        expiresAt > evaluatedAt &&
        expiresAt <= evaluatedAt + 15_000 &&
        expiresAt <= now + 15_000 &&
        decision.authorized
      );
    } catch {
      return false;
    }
  };

  readonly readinessCheck = async (): Promise<void> => {
    try {
      readinessResponseSchema.parse(
        await this.#client.requestJson(this.#readinessEndpoint, {
          method: 'GET',
          headers: { accept: 'application/json' },
        }),
      );
    } catch {
      throw new Error('Relay key authorizer is not ready.');
    }
  };
}

function networkIdFromIdentity(identityId: RelayKeyAuthorization['identityId']): string {
  return identityId.split(':').slice(2, -1).join(':');
}
