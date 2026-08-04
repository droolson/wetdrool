import { randomUUID } from 'node:crypto';

import {
  digestSchema,
  identityIdSchema,
  networkIdSchema,
  unsigned64Schema,
} from '@wetdrool/protocol';
import { z } from 'zod';

import { HttpAuthorizerClient, parseHttpAuthorizerEndpoint } from './http-authorizer-client.js';
import { relayEventKindSchema } from './protocol.js';
import type {
  RelaySubscriptionAuthorization,
  RelaySubscriptionAuthorizationDecision,
} from './relay-server.js';

const authorizationInputSchema = z
  .object({
    identityId: identityIdSchema,
    topic: digestSchema,
    kinds: z.array(relayEventKindSchema).min(1).max(relayEventKindSchema.options.length),
  })
  .strict();
const authorizationResponseSchema = z
  .object({
    version: z.literal('wetdrool-relay-subscription-authorization-v1'),
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

export interface HttpRelaySubscriptionAuthorizerOptions {
  readonly endpoint: string;
  readonly readinessEndpoint: string;
  readonly bearerToken?: string;
  readonly timeoutMilliseconds: number;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => Date;
  readonly requestId?: () => string;
}

export class HttpRelaySubscriptionAuthorizer {
  readonly #endpoint: URL;
  readonly #readinessEndpoint: URL;
  readonly #client: HttpAuthorizerClient;
  readonly #now: () => Date;
  readonly #requestId: () => string;

  constructor(options: HttpRelaySubscriptionAuthorizerOptions) {
    this.#endpoint = parseHttpAuthorizerEndpoint(options.endpoint);
    this.#readinessEndpoint = parseHttpAuthorizerEndpoint(options.readinessEndpoint);
    this.#client = new HttpAuthorizerClient(options);
    this.#now = options.now ?? (() => new Date());
    this.#requestId = options.requestId ?? randomUUID;
  }

  readonly authorize = async (
    input: RelaySubscriptionAuthorization,
  ): Promise<RelaySubscriptionAuthorizationDecision> => {
    const kinds = [...new Set(input.kinds)].sort();
    const parsedInput = authorizationInputSchema.safeParse({ ...input, kinds });
    if (!parsedInput.success) {
      return false;
    }

    const requestId = this.#requestId();
    const requestedAt = this.#now().toISOString();
    try {
      const parsed = authorizationResponseSchema.safeParse(
        await this.#client.requestJson(this.#endpoint, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            version: 'wetdrool-relay-subscription-authorization-v1',
            requestId,
            identityId: parsedInput.data.identityId,
            topic: parsedInput.data.topic,
            kinds: parsedInput.data.kinds,
            requestedAt,
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
      const authorized =
        decision.networkId === networkIdFromIdentity(parsedInput.data.identityId) &&
        evaluatedAt <= now + 5_000 &&
        evaluatedAt >= now - 30_000 &&
        expiresAt > now &&
        expiresAt > evaluatedAt &&
        expiresAt <= evaluatedAt + 15_000 &&
        expiresAt <= now + 15_000 &&
        decision.authorized;
      return authorized ? { authorized: true, expiresAt } : false;
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
      throw new Error('Relay subscription authorizer is not ready.');
    }
  };
}

function networkIdFromIdentity(identityId: string): string {
  return identityId.split(':').slice(2, -1).join(':');
}
