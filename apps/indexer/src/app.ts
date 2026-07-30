import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { z } from 'zod';

import { createTrustedProxyPolicy } from '@wokesocial/config/trusted-proxy';
import {
  RATE_LIMIT_BACKEND_UNAVAILABLE,
  RATE_LIMITER_CLOSED,
  createFastifyRateLimitStore,
  type RateLimiter,
} from '@wokesocial/rate-limit';
import {
  canonicalizeWokeName,
  handleSchema,
  identityIdSchema,
  networkIdSchema,
  objectIdSchema,
  solanaPublicKeySchema,
} from '@wokesocial/protocol';

import {
  COMMUNITY_DIRECTORY_RECIPE,
  decodeCommunityDirectoryCursor,
  encodeCommunityDirectoryCursor,
  MAX_COMMUNITY_CURSOR_LENGTH,
} from './community-cursor.js';
import {
  decodeFeedCursor,
  encodeFeedCursor,
  MAX_FEED_CURSOR_LENGTH,
  OPEN_INDEXER_FEED_RECIPE,
  type FeedCursorScope,
} from './feed-cursor.js';
import type {
  CommunityProjection,
  FeedEntry,
  PostProjection,
  PublicSearchResult,
  VerifiedCommunityProjection,
} from './models.js';
import { ProjectionError, type ProjectionStore } from './projection.js';
import { openApiDocument } from './openapi.js';
import { normalizePublicSearchTerm } from './public-search.js';
import type { IndexerRuntimeReadiness } from './runtime-readiness.js';

const feedQuerySchema = z
  .object({
    network: networkIdSchema.optional(),
    mode: z.enum(['chronological', 'following']).default('chronological'),
    viewer: identityIdSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
    before: z.string().min(1).max(MAX_FEED_CURSOR_LENGTH).optional(),
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
const searchTermSchema = z
  .string()
  .max(512, 'Raw search input cannot exceed 512 characters.')
  .transform(normalizePublicSearchTerm)
  .pipe(
    z.string().superRefine((term, context) => {
      const length = [...term].length;
      if (length < 3) {
        context.addIssue({
          code: 'too_small',
          origin: 'string',
          minimum: 3,
          inclusive: true,
          message: 'Normalized search queries must contain at least 3 characters.',
        });
      }
      if (length > 120) {
        context.addIssue({
          code: 'too_big',
          origin: 'string',
          maximum: 120,
          inclusive: true,
          message: 'Normalized search queries cannot exceed 120 characters.',
        });
      }
      if (/\p{Cc}/u.test(term)) {
        context.addIssue({
          code: 'custom',
          message: 'Control characters are not allowed.',
        });
      }
    }),
  );
const publicSearchQuerySchema = z
  .object({
    q: searchTermSchema,
    limit: z.coerce.number().int().min(1).max(50).default(30),
  })
  .strict();
const searchQuerySchema = publicSearchQuerySchema.extend({ network: networkIdSchema }).strict();
const postParamsSchema = z.object({ objectId: objectIdSchema }).strict();
const identityParamsSchema = z.object({ identityId: identityIdSchema }).strict();
const handleParamsSchema = z
  .object({
    handle: handleSchema.refine((handle) => !handle.includes('__')),
  })
  .strict();
const wokeNameParamsSchema = z.object({ name: z.string().min(1).max(64) }).strict();
const handleQuerySchema = z.object({ network: networkIdSchema }).strict();
const communityParamsSchema = z.object({ communityAddress: solanaPublicKeySchema }).strict();
const communityMembershipParamsSchema = z
  .object({ membershipAddress: solanaPublicKeySchema })
  .strict();
const communityDirectoryQuerySchema = z
  .object({
    network: networkIdSchema,
    limit: z.coerce.number().int().min(1).max(50).default(30),
    before: z.string().min(1).max(MAX_COMMUNITY_CURSOR_LENGTH).optional(),
  })
  .strict();
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
  readonly rateLimiter?: RateLimiter;
  readonly runtimeReadiness?: IndexerRuntimeReadiness;
  readonly trustedProxyCidrs?: readonly string[];
}

export async function buildIndexerApp(options: IndexerAppOptions): Promise<FastifyInstance> {
  const defaultNetworkId =
    options.defaultNetworkId === undefined
      ? undefined
      : networkIdSchema.parse(options.defaultNetworkId);
  const clientIpPolicy = createTrustedProxyPolicy(options.trustedProxyCidrs ?? []);
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: 1_000_000,
    connectionTimeout: 10_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 1_000,
    requestTimeout: 15_000,
    routerOptions: { maxParamLength: 512 },
    requestIdHeader: 'x-request-id',
    trustProxy: clientIpPolicy.trustProxy,
  });
  app.server.headersTimeout = 10_000;
  app.server.maxHeadersCount = 64;

  await app.register(cors, {
    origin: options.allowedOrigins === undefined ? false : [...options.allowedOrigins],
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });
  await app.register(rateLimit, {
    keyGenerator: (request) => clientIpPolicy.clientIp(request.raw),
    max: 120,
    ...(options.rateLimiter === undefined
      ? {}
      : {
          store: createFastifyRateLimitStore({
            limiter: options.rateLimiter,
            namespace: 'http:indexer',
          }),
        }),
    skipOnError: false,
    timeWindow: '1 minute',
  });
  if (options.rateLimiter !== undefined) {
    app.addHook('onClose', async () => options.rateLimiter?.close());
  }
  app.setErrorHandler((error, _request, reply) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === RATE_LIMIT_BACKEND_UNAVAILABLE || error.code === RATE_LIMITER_CLOSED)
    ) {
      void reply.code(503).send({
        error: {
          code: 'dependency-unavailable',
          message: 'A required service dependency is unavailable.',
        },
      });
      return;
    }
    void reply.send(error);
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    void reply
      .header('x-content-type-options', 'nosniff')
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', 'no-store');
    return payload;
  });

  app.get('/healthz', { config: { rateLimit: false } }, async () => ({ ok: true }));
  app.get('/readyz', { config: { rateLimit: false } }, async (_request, reply) => {
    const rateLimitHealth = await options.rateLimiter?.readiness();
    if (rateLimitHealth !== undefined && !rateLimitHealth.ready) {
      void reply.code(503);
      return { ok: false, reason: 'rate-limit-unavailable' };
    }
    const runtimeStatus = options.runtimeReadiness?.status();
    if (runtimeStatus !== undefined && !runtimeStatus.ok) {
      void reply.code(503);
      return runtimeStatus;
    }
    try {
      if (options.projection.readiness === undefined) {
        await options.projection.checkpoint('__readiness__');
      } else {
        await options.projection.readiness();
      }
      return { ok: true };
    } catch {
      void reply.code(503);
      return { ok: false };
    }
  });
  app.get('/openapi.json', async () => openApiDocument);

  app.get(
    '/v1/search/public',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (defaultNetworkId === undefined) {
        void reply.code(503);
        return {
          error: {
            code: 'network-not-configured',
            message:
              'This indexer has no default network. Use /v1/search with an explicit network query.',
          },
        };
      }
      const parsed = publicSearchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        void reply.code(400);
        return invalidQuery(parsed.error, 'Search query is invalid.');
      }
      try {
        return await publicSearchResponse(
          options.projection,
          defaultNetworkId,
          parsed.data.q,
          parsed.data.limit,
        );
      } catch (error) {
        return searchFailure(reply, error);
      }
    },
  );

  app.get(
    '/v1/search',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = searchQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        void reply.code(400);
        return invalidQuery(parsed.error, 'Search query is invalid.');
      }
      try {
        return await publicSearchResponse(
          options.projection,
          parsed.data.network,
          parsed.data.q,
          parsed.data.limit,
        );
      } catch (error) {
        return searchFailure(reply, error);
      }
    },
  );

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

    const snapshot = await options.projection.getFeedSnapshot({
      networkId: defaultNetworkId,
      mode: 'chronological',
      limit: parsed.data.limit,
    });
    const authorHandles = await canonicalAuthorHandles(options.projection, snapshot.entries);
    return {
      meta: responseMetaForCheckpoint(snapshot.checkpoint),
      posts: snapshot.entries.map((entry) =>
        serializeConsumerPost(entry, authorHandles.get(entry.author.identityId) ?? null),
      ),
    };
  });

  app.get('/v1/feed', async (request, reply) => {
    const parsed = feedQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      void reply.code(400);
      return invalidQuery(parsed.error);
    }

    const networkId = parsed.data.network ?? defaultNetworkId;
    if (networkId === undefined) {
      void reply.code(503);
      return {
        error: {
          code: 'network-not-configured',
          message:
            'This indexer has no default network. Supply an explicit network query or configure one.',
        },
      };
    }
    let cursorScope: FeedCursorScope;
    if (parsed.data.mode === 'following') {
      const viewerIdentityId = parsed.data.viewer;
      if (viewerIdentityId === undefined) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-query',
            message: 'Following mode requires a viewer identity.',
            issues: [],
          },
        };
      }
      if (!viewerIdentityId.startsWith(`wokesocialid:v1:${networkId}:`)) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-query',
            message: 'The following viewer must belong to the resolved WokeNet Solana deployment.',
            issues: [
              {
                path: 'viewer',
                message: 'Viewer identity network does not match the resolved feed network.',
              },
            ],
          },
        };
      }
      cursorScope = {
        networkId,
        mode: 'following',
        viewerIdentityId,
      };
    } else {
      cursorScope = {
        networkId,
        mode: 'chronological',
        viewerIdentityId: null,
      };
    }

    let continuation;
    try {
      continuation =
        parsed.data.before === undefined
          ? undefined
          : decodeFeedCursor(parsed.data.before, cursorScope);
    } catch {
      void reply.code(400);
      return {
        error: {
          code: 'invalid-feed-cursor',
          message: 'The feed cursor is invalid or unsupported.',
        },
      };
    }
    const feedQuery = {
      networkId,
      mode: parsed.data.mode,
      // Read one additional entry so nextCursor means that another page is
      // known to exist, rather than merely echoing the last entry on this page.
      limit: parsed.data.limit + 1,
      ...(parsed.data.viewer === undefined ? {} : { viewerIdentityId: parsed.data.viewer }),
      ...(continuation === undefined ? {} : { before: continuation }),
    };
    const snapshot = await options.projection.getFeedSnapshot(feedQuery);
    const page = snapshot.entries.slice(0, parsed.data.limit);
    const lastEntry = page.at(-1);
    const authorHandles = await canonicalAuthorHandles(options.projection, page);
    return {
      canonical: false,
      projection: 'wokenet-open-indexer',
      recipe: OPEN_INDEXER_FEED_RECIPE,
      mode: parsed.data.mode,
      network: networkId,
      meta: responseMetaForCheckpoint(snapshot.checkpoint),
      entries: page.map((entry) =>
        serializeFeedEntry(entry, authorHandles.get(entry.author.identityId) ?? null),
      ),
      viewer: cursorScope.viewerIdentityId,
      nextCursor:
        snapshot.entries.length > parsed.data.limit && lastEntry !== undefined
          ? encodeFeedCursor(lastEntry.post, cursorScope)
          : null,
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
    const entry: FeedEntry = {
      post,
      author,
      ...(profile === undefined ? {} : { profile }),
      reason: { kind: 'chronological' },
    };
    const authorHandles = await canonicalAuthorHandles(options.projection, [entry]);
    return {
      meta: await responseMeta(options.projection, post.networkId),
      post: serializeConsumerPost(entry, authorHandles.get(author.identityId) ?? null),
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
          active: identity.active,
          identitySequence: identity.identitySequence.toString(),
          updatedSlot: identity.updatedSlot.toString(),
          deactivatedSlot: identity.deactivatedSlot?.toString(),
          deactivatedAt: identity.deactivatedAt,
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

  app.get<{ Params: { name: string } }>('/v1/woke-names/:name', async (request, reply) => {
    const parsedParams = wokeNameParamsSchema.safeParse(request.params);
    const parsedQuery = handleQuerySchema.safeParse(request.query);
    if (!parsedParams.success || !parsedQuery.success) {
      void reply.code(400);
      return {
        error: {
          code: 'invalid-woke-name-query',
          message: 'A canonical .woke name and explicit WokeNet identifier are required.',
        },
      };
    }

    let wokeName;
    try {
      wokeName = canonicalizeWokeName(parsedParams.data.name);
    } catch {
      void reply.code(400);
      return {
        error: {
          code: 'invalid-woke-name-query',
          message: 'The .woke name is invalid or confusable.',
        },
      };
    }

    const handle = await options.projection.getHandle(parsedQuery.data.network, wokeName.handle);
    if (handle === undefined) {
      void reply.code(404);
      return { error: { code: 'not-found', message: 'Active .woke claim was not found.' } };
    }
    const identity = await options.projection.getIdentity(handle.identityId);
    const checkpoint = await options.projection.checkpoint(parsedQuery.data.network);
    if (
      identity === undefined ||
      identity.networkId !== parsedQuery.data.network ||
      checkpoint === undefined ||
      checkpoint < handle.claimedSlot ||
      checkpoint < identity.updatedSlot
    ) {
      void reply.code(503);
      return {
        error: {
          code: 'projection-incomplete',
          message: 'The indexer has not finalized the complete .woke resolution proof.',
        },
      };
    }
    if (!identity.active) {
      void reply.code(404);
      return { error: { code: 'not-found', message: 'Active .woke claim was not found.' } };
    }

    return {
      canonical: false,
      projection: 'wokenet-open-indexer',
      network: parsedQuery.data.network,
      namespace: wokeName.namespace,
      namespaceVersion: wokeName.version,
      name: wokeName.name,
      handle: wokeName.handle,
      destination: {
        chain: 'solana',
        address: identity.rootAuthority,
        nativeAddress: false,
        semantics: 'current-identity-root-authority',
      },
      identity: {
        identityId: identity.identityId,
        identityAddress: identity.identityAddress,
        rootAuthority: identity.rootAuthority,
        rootRotationCount: identity.rootRotationCount.toString(),
        active: identity.active,
        identitySequence: identity.identitySequence.toString(),
        updatedSlot: identity.updatedSlot.toString(),
      },
      claim: {
        handleClaimAddress: handle.handleClaimAddress,
        handleHash: handle.handleHash,
        identitySequence: handle.identitySequence.toString(),
        claimedSlot: handle.claimedSlot.toString(),
        claimedAt: handle.claimedAt,
      },
      meta: responseMetaForCheckpoint(checkpoint),
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

  app.get(
    '/v1/communities',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const parsed = communityDirectoryQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        void reply.code(400);
        return invalidQuery(parsed.error, 'Community directory query is invalid.');
      }
      let before;
      try {
        before =
          parsed.data.before === undefined
            ? undefined
            : decodeCommunityDirectoryCursor(parsed.data.before, parsed.data.network);
      } catch {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-community-cursor',
            message: 'Community directory cursor is invalid for this network and recipe.',
          },
        };
      }
      const snapshot = await options.projection.listPublicCommunities({
        networkId: parsed.data.network,
        limit: parsed.data.limit,
        ...(before === undefined ? {} : { before }),
      });
      return {
        canonical: false,
        projection: 'wokenet-open-indexer',
        recipe: COMMUNITY_DIRECTORY_RECIPE,
        network: parsed.data.network,
        meta: responseMetaForCheckpoint(snapshot.checkpoint),
        communities: snapshot.communities.map(serializeCommunity),
        nextCursor:
          snapshot.next === undefined
            ? null
            : encodeCommunityDirectoryCursor(snapshot.next, parsed.data.network),
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
      if (!isDirectlyReadableCommunity(community)) {
        void reply.code(404);
        return { error: { code: 'not-found', message: 'Community was not found.' } };
      }
      return {
        canonical: false,
        projection: 'wokenet-open-indexer',
        network: parsedQuery.data.network,
        meta: await responseMeta(options.projection, parsedQuery.data.network),
        community: serializeCommunity(community),
      };
    },
  );

  app.get<{ Params: { membershipAddress: string }; Querystring: { network: string } }>(
    '/v1/community-memberships/:membershipAddress',
    async (request, reply) => {
      const parsedParams = communityMembershipParamsSchema.safeParse(request.params);
      const parsedQuery = networkQuerySchema.safeParse(request.query);
      if (!parsedParams.success || !parsedQuery.success) {
        void reply.code(400);
        return {
          error: {
            code: 'invalid-community-membership-query',
            message: 'A canonical Solana membership address and explicit network are required.',
          },
        };
      }
      const snapshot = await options.projection.getDiscoverableCommunityMembership(
        parsedQuery.data.network,
        parsedParams.data.membershipAddress,
      );
      if (snapshot === undefined) {
        void reply.code(404);
        return {
          error: {
            code: 'not-found',
            message: 'Community membership was not found.',
          },
        };
      }
      const membership = snapshot.membership;
      return {
        canonical: false,
        projection: 'wokenet-open-indexer',
        network: parsedQuery.data.network,
        meta: responseMetaForCheckpoint(snapshot.checkpoint),
        membership: {
          communityAddress: membership.communityAddress,
          membershipAddress: membership.membershipAddress,
          action: membership.action,
          state: membership.state,
          roles: membership.roles,
          stateSequence: membership.stateSequence.toString(),
          memberActionSequence: membership.memberActionSequence.toString(),
          membershipPolicySequence: membership.membershipPolicySequence.toString(),
          communityMembershipSequence: membership.communityMembershipSequence.toString(),
          activeSinceMembershipSequence: membership.activeSinceMembershipSequence.toString(),
          updatedSlot: membership.updatedSlot.toString(),
          updatedAt: membership.updatedAt,
        },
        proof: {
          kind: 'wokesocial-program-event',
          finality: 'finalized',
          transactionSignature: membership.transactionSignature,
          transactionIndex: membership.transactionIndex ?? null,
          logIndex: membership.logIndex,
          slot: membership.updatedSlot.toString(),
        },
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
      if (!isDirectlyReadableCommunity(community)) {
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
      const community =
        proposal === undefined
          ? undefined
          : await options.projection.getCommunity(proposal.networkId, proposal.communityAddress);
      if (proposal === undefined || !isDirectlyReadableCommunity(community)) {
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
      const community =
        proposal === undefined
          ? undefined
          : await options.projection.getCommunity(proposal.networkId, proposal.communityAddress);
      if (proposal === undefined || !isDirectlyReadableCommunity(community)) {
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
      const community =
        vote === undefined
          ? undefined
          : await options.projection.getCommunity(vote.networkId, vote.communityAddress);
      if (vote === undefined || !isDirectlyReadableCommunity(community)) {
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

function invalidQuery(error: z.ZodError, message = 'Feed query is invalid.') {
  return {
    error: {
      code: 'invalid-query',
      message,
      issues: error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    },
  };
}

async function publicSearchResponse(
  projection: ProjectionStore,
  networkId: string,
  query: string,
  limit: number,
) {
  const snapshot = await projection.searchPublic({
    networkId,
    term: query,
    limit,
  });
  const authorHandles = await canonicalAuthorHandles(
    projection,
    snapshot.results.flatMap((result) => (result.kind === 'post' ? [result.entry] : [])),
  );
  return {
    canonical: false,
    network: networkId,
    meta: responseMetaForCheckpoint(snapshot.checkpoint),
    query,
    ranking: {
      deterministic: true,
      version: 'public-match-v2',
    },
    scope: 'public-finalized-projection',
    results: snapshot.results.map((result) => serializePublicSearchResult(result, authorHandles)),
  };
}

function serializePublicSearchResult(
  result: PublicSearchResult,
  authorHandles: ReadonlyMap<string, string | null>,
) {
  switch (result.kind) {
    case 'community':
      return {
        kind: result.kind,
        matchedBy: result.matchedBy,
        community: serializeCommunity(result.community),
      };
    case 'person':
      return {
        kind: result.kind,
        matchedBy: result.matchedBy,
        identityId: result.identityId,
        displayName: result.displayName || 'Unnamed member',
        bio: result.bio,
        handle: result.handle ?? null,
        updatedAt: result.updatedAt,
      };
    case 'post':
      return {
        kind: result.kind,
        matchedBy: result.matchedBy,
        post: {
          ...serializeConsumerPost(
            result.entry,
            authorHandles.get(result.entry.author.identityId) ?? null,
          ),
          visibility: 'public' as const,
        },
      };
  }
}

function serializeCommunity(community: VerifiedCommunityProjection) {
  return serializeBigInts(community);
}

function isDirectlyReadableCommunity(
  community: CommunityProjection | undefined,
): community is VerifiedCommunityProjection {
  return (
    community !== undefined &&
    community.manifestVerified &&
    (community.content.visibility === 'public' || community.content.visibility === 'unlisted')
  );
}

function searchFailure(reply: FastifyReply, error: unknown) {
  if (
    error instanceof ProjectionError &&
    (error.code === 'search-capacity' || error.code === 'search-timeout')
  ) {
    void reply.code(503).header('retry-after', '1');
    return {
      error: {
        code: 'search-unavailable',
        message: 'Public search is temporarily at capacity. Retry shortly.',
      },
    };
  }
  throw error;
}

function paymentQueryError(message: string) {
  return { error: { code: 'invalid-payment-query', message } };
}

function serializeFeedEntry(entry: FeedEntry, authorHandle: string | null) {
  return {
    post: serializePost(entry.post),
    author: serializeBigInts(entry.author),
    authorHandle,
    profile: entry.profile === undefined ? undefined : serializeBigInts(entry.profile),
    reason: entry.reason,
  };
}

/**
 * Resolves each active author's canonical active handle — the lexically first
 * active claim, matching the person-search convention — once per response. A
 * deactivated identity intentionally resolves to no handle so this projection
 * agrees with fail-closed `.woke` resolution and person discovery.
 */
async function canonicalAuthorHandles(
  projection: ProjectionStore,
  entries: readonly FeedEntry[],
): Promise<ReadonlyMap<string, string | null>> {
  const handles = new Map<string, string | null>();
  for (const entry of entries) {
    const identityId = entry.author.identityId;
    if (handles.has(identityId)) continue;
    if (!entry.author.active) {
      handles.set(identityId, null);
      continue;
    }
    const claims = await projection.getHandlesByIdentity(identityId);
    handles.set(identityId, claims[0]?.handle ?? null);
  }
  return handles;
}

function serializePost(post: PostProjection) {
  return {
    ...post,
    anchoredSlot: post.anchoredSlot.toString(),
  };
}

function serializeConsumerPost(entry: FeedEntry, authorHandle: string | null) {
  return {
    author: {
      active: entry.author.active,
      displayName: entry.profile?.content.displayName || 'Unnamed member',
      handle: authorHandle,
      identityId: entry.author.identityId,
    },
    body: entry.post.content.body ?? null,
    bodyReference: entry.post.content.bodyReference ?? null,
    createdAt: entry.post.createdAt,
    id: entry.post.objectId,
    language: entry.post.content.language,
    media: entry.post.content.media,
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
  return responseMetaForCheckpoint(await projection.checkpoint(networkId));
}

function responseMetaForCheckpoint(checkpoint: bigint | undefined) {
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
