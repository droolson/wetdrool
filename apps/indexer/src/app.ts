import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  handleSchema,
  identityIdSchema,
  networkIdSchema,
  objectIdSchema,
  solanaPublicKeySchema,
} from '@wokesocial/protocol';

import type { FeedEntry, PostProjection } from './models.js';
import type { ProjectionStore } from './projection.js';
import { openApiDocument } from './openapi.js';

const feedQuerySchema = z
  .object({
    network: networkIdSchema,
    mode: z.enum(['chronological', 'following']).default('chronological'),
    viewer: identityIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .refine(
    (query) => query.mode !== 'following' || query.viewer !== undefined,
    'Following mode requires a viewer identity.',
  );

const homeFeedQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();
const postParamsSchema = z.object({ objectId: objectIdSchema }).strict();
const identityParamsSchema = z.object({ identityId: identityIdSchema }).strict();
const handleParamsSchema = z
  .object({
    handle: handleSchema.refine((handle) => !handle.includes('__')),
  })
  .strict();
const handleQuerySchema = z.object({ network: networkIdSchema }).strict();
const communityParamsSchema = z.object({ communityAddress: solanaPublicKeySchema }).strict();
const proposalParamsSchema = z.object({ proposalAddress: solanaPublicKeySchema }).strict();
const voteParamsSchema = z.object({ voteAddress: solanaPublicKeySchema }).strict();
const paymentOfferingParamsSchema = z.object({ offeringAddress: solanaPublicKeySchema }).strict();
const paymentReceiptParamsSchema = z.object({ receiptAddress: solanaPublicKeySchema }).strict();
const paymentEntitlementParamsSchema = z
  .object({ entitlementAddress: solanaPublicKeySchema })
  .strict();
const recoveryRequestParamsSchema = z
  .object({ recoveryRequestAddress: solanaPublicKeySchema })
  .strict();
const networkQuerySchema = z.object({ network: networkIdSchema }).strict();
const reactionsQuerySchema = z
  .object({
    network: networkIdSchema,
    postReference: solanaPublicKeySchema,
  })
  .strict();

export interface IndexerAppOptions {
  readonly projection: ProjectionStore;
  readonly logger?: boolean;
  readonly allowedOrigins?: readonly string[];
  readonly defaultNetworkId?: string;
}

export async function buildIndexerApp(options: IndexerAppOptions): Promise<FastifyInstance> {
  const defaultNetworkId =
    options.defaultNetworkId === undefined
      ? undefined
      : networkIdSchema.parse(options.defaultNetworkId);
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1_000_000,
    routerOptions: { maxParamLength: 512 },
    requestIdHeader: 'x-request-id',
  });

  await app.register(cors, {
    origin: options.allowedOrigins === undefined ? false : [...options.allowedOrigins],
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    void reply
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', 'no-store');
    return payload;
  });

  app.get('/healthz', async () => ({ ok: true }));
  app.get('/readyz', async (_request, reply) => {
    try {
      await options.projection.checkpoint('__readiness__');
      return { ok: true };
    } catch {
      void reply.code(503);
      return { ok: false };
    }
  });
  app.get('/openapi.json', async () => openApiDocument);

  app.get('/v1/feed/home', async (request, reply) => {
    if (defaultNetworkId === undefined) {
      void reply.code(503);
      return {
        error: {
          code: 'network-not-configured',
          message:
            'This indexer has no default network. Use /v1/feed with an explicit network query.',
        },
      };
    }

    const parsed = homeFeedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      void reply.code(400);
      return invalidQuery(parsed.error);
    }

    const entries = await options.projection.getFeed({
      networkId: defaultNetworkId,
      mode: 'chronological',
      limit: parsed.data.limit,
    });
    return {
      meta: await responseMeta(options.projection, defaultNetworkId),
      posts: entries.map(serializeConsumerPost),
    };
  });

  app.get('/v1/feed', async (request, reply) => {
    const parsed = feedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      void reply.code(400);
      return invalidQuery(parsed.error);
    }

    const feedQuery = {
      networkId: parsed.data.network,
      mode: parsed.data.mode,
      limit: parsed.data.limit,
      ...(parsed.data.viewer === undefined ? {} : { viewerIdentityId: parsed.data.viewer }),
      ...(parsed.data.before === undefined ? {} : { before: parsed.data.before }),
    };
    const entries = await options.projection.getFeed(feedQuery);
    return {
      canonical: false,
      projection: 'wokenet-open-indexer',
      entries: entries.map(serializeFeedEntry),
      nextCursor: entries.at(-1)?.post.createdAt,
    };
  });

  app.get<{ Params: { objectId: string } }>('/v1/posts/:objectId', async (request, reply) => {
    const parsedParams = postParamsSchema.safeParse(request.params);
    if (!parsedParams.success) {
      void reply.code(400);
      return {
        error: {
          code: 'invalid-object-id',
          message: 'The post object ID is invalid.',
        },
      };
    }
    const post = await options.projection.getPost(parsedParams.data.objectId);
    if (post === undefined || post.tombstonedAt !== undefined) {
      void reply.code(404);
      return {
        error: { code: 'not-found', message: 'Post was not found.' },
      };
    }

    const author = await options.projection.getIdentity(post.authorIdentityId);
    if (author === undefined) {
      void reply.code(503);
      return {
        error: {
          code: 'projection-incomplete',
          message: 'The post author is missing from this projection.',
        },
      };
    }
    const profile = await options.projection.getProfile(post.authorIdentityId);
    return {
      meta: await responseMeta(options.projection, post.networkId),
      post: serializeConsumerPost({
        post,
        author,
        ...(profile === undefined ? {} : { profile }),
        reason: { kind: 'chronological' },
      }),
    };
  });

  app.get<{ Params: { identityId: string } }>(
    '/v1/identities/:identityId/security',
    async (request, reply) => {
      const parsed = identityParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        void reply.code(400);
        return { error: { code: 'invalid-identity-id', message: 'Identity ID is invalid.' } };
      }
      const identity = await options.projection.getIdentity(parsed.data.identityId);
      if (identity === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Identity was not found.' } };
      }
      const delegations = await options.projection.getDelegations(identity.identityId);
      return {
        canonical: false,
        identity: {
          identityId: identity.identityId,
          rootAuthority: identity.rootAuthority,
          rootRotationCount: identity.rootRotationCount.toString(),
          updatedSlot: identity.updatedSlot.toString(),
        },
        delegations: delegations.map((delegation) => ({
          ...delegation,
          delegationSequence: delegation.delegationSequence.toString(),
          identitySequence: delegation.identitySequence.toString(),
          issuedAtRootRotationCount: delegation.issuedAtRootRotationCount.toString(),
          issuedAtSlot: delegation.issuedAtSlot.toString(),
          expiresAtSlot: delegation.expiresAtSlot.toString(),
          stateSequence: delegation.stateSequence.toString(),
          revokedAtSlot: delegation.revokedAtSlot?.toString(),
        })),
      };
    },
  );

  app.get<{ Params: { handle: string } }>('/v1/handles/:handle', async (request, reply) => {
    const parsedParams = handleParamsSchema.safeParse(request.params);
    const parsedQuery = handleQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      void reply.code(400);
      return {
        error: {
          code: 'invalid-handle-query',
          message: 'A normalized handle and explicit network are required.',
        },
      };
    }
    const handle = await options.projection.getHandle(
      parsedQuery.data.network,
      parsedParams.data.handle,
    );
    if (handle === undefined) {
      void reply.code(404);
      return { error: { code: 'not-found', message: 'Active handle was not found.' } };
    }
    return {
      canonical: false,
      handle: serializeBigInts(handle),
    };
  });

  app.get<{ Params: { identityId: string } }>(
    '/v1/identities/:identityId/handles',
    async (request, reply) => {
      const parsed = identityParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        void reply.code(400);
        return { error: { code: 'invalid-identity-id', message: 'Identity ID is invalid.' } };
      }
      const identity = await options.projection.getIdentity(parsed.data.identityId);
      if (identity === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Identity was not found.' } };
      }
      const handles = await options.projection.getHandlesByIdentity(identity.identityId);
      return {
        canonical: false,
        identityId: identity.identityId,
        handles: handles.map(serializeBigInts),
      };
    },
  );

  app.get<{ Params: { communityAddress: string }; Querystring: { network: string } }>(
    '/v1/communities/:communityAddress',
    async (request, reply) => {
      const parsedParams = communityParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-community-query',
            message: 'A WokeNet community address and explicit network are required.',
          },
        };
      }
      const community = await options.projection.getCommunity(
        parsedQuery.data.network,
        parsedParams.data.communityAddress,
      );
      if (community === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Community was not found.' } };
      }
      const memberships = await options.projection.getCommunityMemberships(
        community.networkId,
        community.communityAddress,
      );
      return {
        canonical: false,
        community: serializeBigInts(community),
        memberships: memberships.map(serializeBigInts),
      };
    },
  );

  app.get('/v1/reactions', async (request, reply) => {
    const parsed = reactionsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      void reply.code(400);
      return invalidQuery(parsed.error);
    }
    const reactions = await options.projection.getReactionsByPostReference(
      parsed.data.network,
      parsed.data.postReference,
    );
    return {
      canonical: false,
      reactions: reactions.map(serializeBigInts),
    };
  });

  app.get<{ Params: { identityId: string } }>(
    '/v1/recovery/identities/:identityId/policy',
    async (request, reply) => {
      const parsed = identityParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        void reply.code(400);
        return { error: { code: 'invalid-identity-id', message: 'Identity ID is invalid.' } };
      }
      const identity = await options.projection.getIdentity(parsed.data.identityId);
      if (identity === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Identity was not found.' } };
      }
      const policy = await options.projection.getRecoveryPolicy(identity.identityId);
      if (policy === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Recovery policy was not found.' } };
      }
      return {
        canonical: false,
        authoritativeSource: 'wokenet-account-state',
        policy: serializeBigInts(policy),
      };
    },
  );

  app.get<{ Params: { identityId: string } }>(
    '/v1/recovery/identities/:identityId/requests',
    async (request, reply) => {
      const parsed = identityParamsSchema.safeParse(request.params);
      if (!parsed.success) {
        void reply.code(400);
        return { error: { code: 'invalid-identity-id', message: 'Identity ID is invalid.' } };
      }
      const identity = await options.projection.getIdentity(parsed.data.identityId);
      if (identity === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Identity was not found.' } };
      }
      const requests = await options.projection.getRecoveryRequestsByIdentity(identity.identityId);
      return {
        canonical: false,
        authoritativeSource: 'wokenet-account-state',
        eligibilityEvaluated: false,
        identityId: identity.identityId,
        requests: requests.map(serializeBigInts),
      };
    },
  );

  app.get<{ Params: { recoveryRequestAddress: string }; Querystring: { network: string } }>(
    '/v1/recovery/requests/:recoveryRequestAddress',
    async (request, reply) => {
      const parsedParams = recoveryRequestParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-recovery-request-query',
            message: 'A WokeNet recovery request address and explicit network are required.',
          },
        };
      }
      const recoveryRequest = await options.projection.getRecoveryRequest(
        parsedQuery.data.network,
        parsedParams.data.recoveryRequestAddress,
      );
      if (recoveryRequest === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Recovery request was not found.' } };
      }
      return {
        canonical: false,
        authoritativeSource: 'wokenet-account-state',
        eligibilityEvaluated: false,
        request: serializeBigInts(recoveryRequest),
      };
    },
  );

  app.get<{ Params: { communityAddress: string }; Querystring: { network: string } }>(
    '/v1/communities/:communityAddress/proposals',
    async (request, reply) => {
      const parsedParams = communityParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-community-query',
            message: 'A WokeNet community address and explicit network are required.',
          },
        };
      }
      const community = await options.projection.getCommunity(
        parsedQuery.data.network,
        parsedParams.data.communityAddress,
      );
      if (community === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Community was not found.' } };
      }
      const proposals = await options.projection.getGovernanceProposalsByCommunity(
        community.networkId,
        community.communityAddress,
      );
      return {
        canonical: false,
        communityAddress: community.communityAddress,
        proposals: proposals.map(serializeBigInts),
      };
    },
  );

  app.get<{ Params: { proposalAddress: string }; Querystring: { network: string } }>(
    '/v1/governance/proposals/:proposalAddress',
    async (request, reply) => {
      const parsedParams = proposalParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-proposal-query',
            message: 'A WokeNet proposal address and explicit network are required.',
          },
        };
      }
      const proposal = await options.projection.getGovernanceProposal(
        parsedQuery.data.network,
        parsedParams.data.proposalAddress,
      );
      if (proposal === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Proposal was not found.' } };
      }
      return { canonical: false, proposal: serializeBigInts(proposal) };
    },
  );

  app.get<{ Params: { proposalAddress: string }; Querystring: { network: string } }>(
    '/v1/governance/proposals/:proposalAddress/votes',
    async (request, reply) => {
      const parsedParams = proposalParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-proposal-query',
            message: 'A WokeNet proposal address and explicit network are required.',
          },
        };
      }
      const proposal = await options.projection.getGovernanceProposal(
        parsedQuery.data.network,
        parsedParams.data.proposalAddress,
      );
      if (proposal === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Proposal was not found.' } };
      }
      const votes = await options.projection.getGovernanceVotesByProposal(
        proposal.networkId,
        proposal.proposalAddress,
      );
      return {
        canonical: false,
        proposalAddress: proposal.proposalAddress,
        votes: votes.map(serializeBigInts),
      };
    },
  );

  app.get<{ Params: { voteAddress: string }; Querystring: { network: string } }>(
    '/v1/governance/votes/:voteAddress',
    async (request, reply) => {
      const parsedParams = voteParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-vote-query',
            message: 'A WokeNet vote address and explicit network are required.',
          },
        };
      }
      const vote = await options.projection.getGovernanceVote(
        parsedQuery.data.network,
        parsedParams.data.voteAddress,
      );
      if (vote === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Vote was not found.' } };
      }
      return { canonical: false, vote: serializeBigInts(vote) };
    },
  );

  app.get<{ Querystring: { network: string } }>('/v1/payments/config', async (request, reply) => {
    const parsedQuery = networkQuerySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      void reply.code(400);
      return paymentQueryError('An explicit WokeNet identifier is required.');
    }
    const paymentConfig = await options.projection.getPaymentConfig(parsedQuery.data.network);
    if (paymentConfig === undefined) {
      void reply.code(404);
      return { error: { code: 'not-found', message: 'Payment configuration was not found.' } };
    }
    return {
      canonical: false,
      authoritativeSource: 'wokenet-account-state',
      paymentConfig: serializeBigInts(paymentConfig),
    };
  });

  app.get<{ Params: { offeringAddress: string }; Querystring: { network: string } }>(
    '/v1/payments/offerings/:offeringAddress',
    async (request, reply) => {
      const parsedParams = paymentOfferingParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return paymentQueryError(
          'A WokeNet subscription offering address and explicit network are required.',
        );
      }
      const offering = await options.projection.getSubscriptionOffering(
        parsedQuery.data.network,
        parsedParams.data.offeringAddress,
      );
      if (offering === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Subscription offering was not found.' } };
      }
      return {
        canonical: false,
        authoritativeSource: 'wokenet-account-state',
        offering: serializeBigInts(offering),
      };
    },
  );

  app.get<{
    Params: { identityId: string };
    Querystring: { network: string };
  }>('/v1/payments/identities/:identityId/offerings', async (request, reply) => {
    const parsedParams = identityParamsSchema.safeParse(request.params);
    const parsedQuery = networkQuerySchema.safeParse(request.query);
    if (
      !parsedParams.success ||
      !parsedQuery.success ||
      !parsedParams.data.identityId.startsWith(`wokesocialid:v1:${parsedQuery.data.network}:`)
    ) {
      void reply.code(400);
      return paymentQueryError('The creator identity must belong to the explicit network.');
    }
    const creator = await options.projection.getIdentity(parsedParams.data.identityId);
    if (creator === undefined || creator.networkId !== parsedQuery.data.network) {
      void reply.code(404);
      return { error: { code: 'not-found', message: 'Creator identity was not found.' } };
    }
    const offerings = await options.projection.getSubscriptionOfferingsByCreator(
      parsedQuery.data.network,
      creator.identityId,
    );
    return {
      canonical: false,
      authoritativeSource: 'wokenet-account-state',
      creatorIdentityId: creator.identityId,
      offerings: offerings.map(serializeBigInts),
    };
  });

  app.get<{ Params: { receiptAddress: string }; Querystring: { network: string } }>(
    '/v1/payments/receipts/:receiptAddress',
    async (request, reply) => {
      const parsedParams = paymentReceiptParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return paymentQueryError(
          'A WokeNet payment receipt address and explicit network are required.',
        );
      }
      const receipt = await options.projection.getPaymentReceipt(
        parsedQuery.data.network,
        parsedParams.data.receiptAddress,
      );
      if (receipt === undefined) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Payment receipt was not found.' } };
      }
      return {
        canonical: false,
        authoritativeSource: 'wokenet-account-state-and-finalized-events',
        settlementOutcomeInferred: false,
        receipt: serializeBigInts(receipt),
      };
    },
  );

  app.get<{ Params: { entitlementAddress: string }; Querystring: { network: string } }>(
    '/v1/payments/entitlements/:entitlementAddress',
    async (request, reply) => {
      const parsedParams = paymentEntitlementParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return paymentQueryError(
          'A WokeNet subscription entitlement address and explicit network are required.',
        );
      }
      const entitlement = await options.projection.getSubscriptionEntitlement(
        parsedQuery.data.network,
        parsedParams.data.entitlementAddress,
      );
      if (entitlement === undefined) {
        void reply.code(404);
        return {
          error: { code: 'not-found', message: 'Subscription entitlement was not found.' },
        };
      }
      return {
        canonical: false,
        authoritativeSource: 'wokenet-account-state-and-finalized-events',
        currentEligibilityEvaluated: false,
        entitlement: serializeBigInts(entitlement),
      };
    },
  );

  return app;
}

function invalidQuery(error: z.ZodError) {
  return {
    error: {
      code: 'invalid-query',
      message: 'Feed query is invalid.',
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  };
}

function paymentQueryError(message: string) {
  return { error: { code: 'invalid-payment-query', message } };
}

function serializeFeedEntry(entry: FeedEntry) {
  return {
    post: serializePost(entry.post),
    author: {
      ...entry.author,
      createdSlot: entry.author.createdSlot.toString(),
    },
    profile:
      entry.profile === undefined
        ? undefined
        : {
            ...entry.profile,
            updatedSlot: entry.profile.updatedSlot.toString(),
          },
    reason: entry.reason,
  };
}

function serializePost(post: PostProjection) {
  return {
    ...post,
    anchoredSlot: post.anchoredSlot.toString(),
  };
}

function serializeConsumerPost(entry: FeedEntry) {
  return {
    author: {
      displayName: entry.profile?.content.displayName ?? 'Unnamed member',
      handle: null,
      identityId: entry.author.identityId,
    },
    body: entry.post.content.body ?? null,
    bodyReference: entry.post.content.bodyReference ?? null,
    createdAt: entry.post.createdAt,
    id: entry.post.objectId,
    language: entry.post.content.language,
    verification: {
      anchor: {
        finality: 'finalized',
        slot: safeInteger(entry.post.anchoredSlot, 'post anchored slot'),
        transaction: entry.post.transactionSignature,
      },
      contentHash: entry.post.payloadHash,
      contentHashValid: true,
      manifestUri: `ipfs://${entry.post.cid}`,
      signatureValid: true,
      state: 'verified',
    },
  };
}

async function responseMeta(projection: ProjectionStore, networkId: string) {
  const checkpoint = await projection.checkpoint(networkId);
  return {
    checkpointSlot:
      checkpoint === undefined ? null : safeInteger(checkpoint, 'projection checkpoint slot'),
    indexedAt: new Date().toISOString(),
    source: 'WokeNet open indexer',
  };
}

function safeInteger(value: bigint, label: string): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError(`${label} cannot be represented as a non-negative JSON integer.`);
  }
  return result;
}

type Serialized<T> = T extends bigint
  ? string
  : T extends readonly (infer Item)[]
    ? readonly Serialized<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: Serialized<T[Key]> }
      : T;

function serializeBigInts<T>(value: T): Serialized<T> {
  if (typeof value === 'bigint') {
    return value.toString() as Serialized<T>;
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeBigInts(item)) as Serialized<T>;
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]),
    ) as Serialized<T>;
  }
  return value as Serialized<T>;
}
