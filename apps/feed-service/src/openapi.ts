import { z } from 'zod';

import { FEED_POLICY, FEED_POLICY_VERSION } from './policy.js';
import { rankRequestSchema } from './schemas.js';

const rankRequestJsonSchema = z.toJSONSchema(rankRequestSchema, {
  target: 'draft-2020-12',
});

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'WokeSocial Replaceable Feed API',
    version: '0.1.0',
    description:
      'Deterministically ranks signed projection summaries without claiming canonical authority or verifying content authenticity.',
  },
  paths: {
    '/healthz': {
      get: {
        summary: 'Process liveness',
        responses: { '200': { description: 'The process is alive' } },
      },
    },
    '/readyz': {
      get: {
        summary: 'Service readiness',
        responses: {
          '200': { description: 'The ranking service is ready' },
          '503': { description: 'A configured readiness dependency is unavailable' },
        },
      },
    },
    '/openapi.json': {
      get: {
        summary: 'OpenAPI document',
        responses: { '200': { description: 'This document' } },
      },
    },
    '/v1/policy': {
      get: {
        summary: 'Read the complete public scoring policy',
        responses: { '200': { description: `Policy ${FEED_POLICY_VERSION}` } },
      },
    },
    '/v1/provider': {
      get: {
        summary: 'Read the feed-provider capability descriptor',
        description:
          'Publishes the versioned replaceable-provider contract, supported modes, algorithms, and assurance limits.',
        responses: { '200': { description: 'Provider descriptor' } },
      },
    },
    '/v1/rank': {
      post: {
        summary: 'Rank signed projection summaries',
        description:
          'The caller supplies summaries, signatures, and explicit risk signals. The service proxies but does not verify them, and every response has canonical=false.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: rankRequestJsonSchema,
            },
          },
        },
        responses: {
          '200': {
            description:
              'A deterministic page with score components, explanations, filter counts, canonical=false, and no authenticity claim',
          },
          '400': { description: 'Invalid body or cursor' },
          '413': { description: 'Request body exceeds the byte limit' },
          '429': { description: 'Rate limit exceeded' },
        },
      },
    },
  },
  components: {
    schemas: {
      RankRequest: rankRequestJsonSchema,
      RankResponse: {
        type: 'object',
        additionalProperties: false,
        required: ['canonical', 'assurance', 'provider', 'engine', 'page', 'items'],
        properties: {
          canonical: { const: false },
          assurance: {
            type: 'object',
            description:
              'Explicitly states that projection signatures and content authenticity were not verified.',
          },
          provider: {
            type: 'object',
            description:
              'Provider/algorithm identity, source checkpoints, applied filter assertions, and deterministic response validity window.',
          },
          engine: {
            type: 'object',
            description:
              'Policy version, effective mode, personalization state, and deterministic asOf time.',
          },
          page: {
            type: 'object',
            description: 'Counts, filter outcomes, and an opaque continuity cursor.',
          },
          items: {
            type: 'array',
            description:
              'Proxied summaries with stable score components and human-readable explanations.',
          },
        },
      },
    },
  },
  'x-wokesocial-policy': {
    version: FEED_POLICY_VERSION,
    weights: FEED_POLICY,
    canonicalAuthority: false,
    verifiesProjectionSignatures: false,
    infersSensitiveTraits: false,
    infersRageBaitRisk: false,
  },
} as const;
