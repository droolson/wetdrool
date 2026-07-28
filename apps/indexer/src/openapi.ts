const networkParameter = {
  name: 'network',
  in: 'query',
  required: true,
  description:
    'Canonical sovereign WokeNet identifier. Both base58 segments must decode to exactly 32 bytes.',
  schema: {
    type: 'string',
    maxLength: 96,
    pattern: '^wokenet:v1:[1-9A-HJ-NP-Za-km-z]+:[1-9A-HJ-NP-Za-km-z]+$',
  },
} as const;

const solanaPublicKeyParameterSchema = {
  type: 'string',
  minLength: 32,
  maxLength: 44,
  pattern: '^[1-9A-HJ-NP-Za-km-z]{32,44}$',
  description: 'Base58 value that must decode to exactly 32 bytes.',
} as const;

const searchParameters = [
  {
    name: 'q',
    in: 'query',
    required: true,
    description:
      'NFKC-normalized public search term with locale-independent ASCII A–Z folding. Non-ASCII text is case-sensitive. The canonical value must contain 3–120 Unicode code points; control characters are rejected and the normalized term is echoed in the response. Contains matching requires an ASCII alphanumeric run of at least three characters; other valid terms are exact/prefix-only.',
    schema: {
      type: 'string',
      minLength: 1,
      maxLength: 512,
      'x-normalizedMinLength': 3,
      'x-normalizedMaxLength': 120,
    },
  },
  {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1, maximum: 50, default: 30 },
  },
] as const;

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'WokeNet Open Indexer API',
    version: '0.1.0',
    description:
      'A rebuildable convenience projection. Responses are not canonical protocol state.',
  },
  paths: {
    '/healthz': {
      get: {
        summary: 'Process liveness',
        responses: { '200': { description: 'Process is alive' } },
      },
    },
    '/readyz': {
      get: {
        summary: 'Projection readiness',
        responses: {
          '200': { description: 'Projection dependencies are ready' },
          '503': { description: 'A dependency is unavailable' },
        },
      },
    },
    '/v1/feed/home': {
      get: {
        summary: 'Read the configured network’s chronological home feed',
        description:
          'Returns only posts whose manifest signature, content hash, and finalized WokeNet anchor were verified during ingestion.',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
          },
        ],
        responses: {
          '200': {
            description: 'Consumer-safe verified post summaries and projection checkpoint metadata',
          },
          '400': { description: 'Invalid query' },
          '503': { description: 'The operator has not configured a default network' },
        },
      },
    },
    '/v1/feed': {
      get: {
        summary: 'Read a chronological or following projection',
        description:
          'Low-level replaceable projection endpoint. The network is always explicit and responses are not canonical protocol state.',
        parameters: [
          networkParameter,
          {
            name: 'mode',
            in: 'query',
            schema: { type: 'string', enum: ['chronological', 'following'] },
          },
          { name: 'viewer', in: 'query', schema: { type: 'string' } },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', minimum: 1, maximum: 100 },
          },
          { name: 'before', in: 'query', schema: { type: 'string', format: 'date-time' } },
        ],
        responses: {
          '200': {
            description: 'Verified, non-tombstoned projected posts',
          },
          '400': { description: 'Invalid query' },
        },
      },
    },
    '/v1/search/public': {
      get: {
        summary: 'Search the configured network’s public projection',
        description:
          'Searches current public profile fields, canonical active handles, and verified non-tombstoned public posts. Communities remain excluded until a signed public manifest is verified. Private fields are never indexed.',
        parameters: searchParameters,
        responses: {
          '200': {
            description:
              'Bounded results with checkpoint metadata and the deterministic public-match-v1 ranking version',
          },
          '400': { description: 'Invalid or unknown query input' },
          '429': { description: 'Search rate limit exceeded' },
          '503': {
            description:
              'The operator has not configured a default network or bounded search capacity is temporarily exhausted',
          },
        },
      },
    },
    '/v1/search': {
      get: {
        summary: 'Search one explicit WokeNet public projection',
        description:
          'Low-level replaceable search endpoint. The index is rebuildable and is not canonical protocol state.',
        parameters: [networkParameter, ...searchParameters],
        responses: {
          '200': {
            description: 'Bounded current-profile and verified-public-post results',
          },
          '400': { description: 'Invalid or unknown query input' },
          '429': { description: 'Search rate limit exceeded' },
          '503': { description: 'Bounded search capacity is temporarily exhausted' },
        },
      },
    },
    '/v1/posts/{objectId}': {
      get: {
        summary: 'Read one verified post projection',
        parameters: [
          {
            name: 'objectId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': {
            description:
              'Consumer-safe post summary with signature, content-hash, finalized-anchor, and checkpoint metadata',
          },
          '400': { description: 'Invalid protocol object identifier' },
          '404': { description: 'Post not found or tombstoned' },
          '503': { description: 'The projection is incomplete' },
        },
      },
    },
    '/v1/identities/{identityId}/security': {
      get: {
        summary: 'Read projected root-rotation and delegation state',
        description:
          'Returns current projected security state. Historical authorization is evaluated at each event position during ingestion.',
        parameters: [
          {
            name: 'identityId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Current root epoch and projected delegations' },
          '400': { description: 'Invalid identity identifier' },
          '404': { description: 'Identity not found' },
        },
      },
    },
    '/v1/handles/{handle}': {
      get: {
        summary: 'Resolve an active normalized global handle',
        description:
          'Returns the current finalized handle projection for one explicit WokeNet identifier. This convenience projection is rebuildable and is not canonical protocol state.',
        parameters: [
          {
            name: 'handle',
            in: 'path',
            required: true,
            schema: {
              type: 'string',
              pattern: '^(?!.*__)[a-z0-9][a-z0-9_]{1,28}[a-z0-9]$',
            },
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Active projected handle claim' },
          '400': { description: 'Invalid handle or network' },
          '404': { description: 'No active claim exists' },
        },
      },
    },
    '/v1/identities/{identityId}/handles': {
      get: {
        summary: 'List active global handles projected for an identity',
        parameters: [
          {
            name: 'identityId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Lexically ordered active handle claims' },
          '400': { description: 'Invalid identity identifier' },
          '404': { description: 'Identity not found' },
        },
      },
    },
    '/v1/communities/{communityAddress}': {
      get: {
        summary: 'Read a community, governance strategy anchor, and memberships',
        description:
          'Community manifest metadata is anchored but is explicitly marked unverified until the portable protocol defines a community envelope schema.',
        parameters: [
          {
            name: 'communityAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Projected community and membership state' },
          '400': { description: 'Invalid community address or network' },
          '404': { description: 'Community not found' },
        },
      },
    },
    '/v1/communities/{communityAddress}/proposals': {
      get: {
        summary: 'List governance proposals projected for a community',
        description:
          'Returns a deterministic rebuildable projection. Proposal manifests are anchored but not interpreted by the indexer.',
        parameters: [
          {
            name: 'communityAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Projected proposals ordered by creation slot and address' },
          '400': { description: 'Invalid community address or network' },
          '404': { description: 'Community not found' },
        },
      },
    },
    '/v1/recovery/identities/{identityId}/policy': {
      get: {
        summary: 'Read the current projected recovery policy for an identity',
        description:
          'This is a deterministic finalized-event projection, not authoritative account state. Clients must read and validate the WokeNet accounts before signing or executing recovery instructions.',
        parameters: [
          {
            name: 'identityId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Current projected policy configuration and active flag' },
          '400': { description: 'Invalid identity identifier' },
          '404': { description: 'Identity or recovery policy not found' },
        },
      },
    },
    '/v1/recovery/identities/{identityId}/requests': {
      get: {
        summary: 'List projected recovery requests for an identity',
        description:
          'Returns event-derived lifecycle records in deterministic request order. Pending means no terminal event was indexed; it does not assert that a request remains executable.',
        parameters: [
          {
            name: 'identityId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
        ],
        responses: {
          '200': { description: 'Projected requests ordered by request slot and address' },
          '400': { description: 'Invalid identity identifier' },
          '404': { description: 'Identity not found' },
        },
      },
    },
    '/v1/recovery/requests/{recoveryRequestAddress}': {
      get: {
        summary: 'Read one projected recovery request lifecycle',
        description:
          'This endpoint reports finalized events and never evaluates current on-chain execution eligibility. WokeNet account state remains authoritative.',
        parameters: [
          {
            name: 'recoveryRequestAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Projected request snapshot, approvals, and terminal event' },
          '400': { description: 'Invalid recovery request address or network' },
          '404': { description: 'Recovery request not found' },
        },
      },
    },
    '/v1/governance/proposals/{proposalAddress}': {
      get: {
        summary: 'Read one projected governance proposal',
        parameters: [
          {
            name: 'proposalAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Current proposal tally and terminal outcome, if finalized' },
          '400': { description: 'Invalid proposal address or network' },
          '404': { description: 'Proposal not found' },
        },
      },
    },
    '/v1/governance/proposals/{proposalAddress}/votes': {
      get: {
        summary: 'List projected votes for one governance proposal',
        parameters: [
          {
            name: 'proposalAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Votes ordered by proposal state sequence and vote address' },
          '400': { description: 'Invalid proposal address or network' },
          '404': { description: 'Proposal not found' },
        },
      },
    },
    '/v1/governance/votes/{voteAddress}': {
      get: {
        summary: 'Read one projected governance vote',
        parameters: [
          {
            name: 'voteAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Projected vote and its post-event tally' },
          '400': { description: 'Invalid vote address or network' },
          '404': { description: 'Vote not found' },
        },
      },
    },
    '/v1/reactions': {
      get: {
        summary: 'Read projected reactions for an on-chain post reference',
        parameters: [
          networkParameter,
          {
            name: 'postReference',
            in: 'query',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
        ],
        responses: {
          '200': { description: 'Active and inactive projected reaction states' },
          '400': { description: 'Invalid query' },
        },
      },
    },
    '/v1/payments/config': {
      get: {
        summary: 'Read the projected payment configuration',
        description:
          'Returns a rebuildable exact-network projection of the WokeNet payment-config account. The response is not canonical protocol state.',
        parameters: [networkParameter],
        responses: {
          '200': { description: 'Current projected payment policy and authority' },
          '400': { description: 'Invalid or missing network' },
          '404': { description: 'Payment configuration not found' },
        },
      },
    },
    '/v1/payments/offerings/{offeringAddress}': {
      get: {
        summary: 'Read one projected subscription offering',
        description:
          'Returns event-derived terms for one exact-network offering. Clients must read the WokeNet account before constructing a payment.',
        parameters: [
          {
            name: 'offeringAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Projected offering terms and recipient splits' },
          '400': { description: 'Invalid offering address or network' },
          '404': { description: 'Offering not found' },
        },
      },
    },
    '/v1/payments/identities/{identityId}/offerings': {
      get: {
        summary: 'List projected subscription offerings for one creator',
        description:
          'The identity identifier and required network must match exactly. Results are a rebuildable convenience projection.',
        parameters: [
          {
            name: 'identityId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Projected offerings ordered deterministically' },
          '400': { description: 'Identity and network do not match or are invalid' },
          '404': { description: 'Creator identity not found' },
        },
      },
    },
    '/v1/payments/receipts/{receiptAddress}': {
      get: {
        summary: 'Read one permanent projected payment receipt',
        description:
          'Returns a finalized-event and WokeNet account projection for one exact network. The indexer does not infer a broader settlement or refund outcome and never reports success on its own authority.',
        parameters: [
          {
            name: 'receiptAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Permanent projected receipt with raw-event provenance' },
          '400': { description: 'Invalid receipt address or network' },
          '404': { description: 'Receipt not found' },
        },
      },
    },
    '/v1/payments/entitlements/{entitlementAddress}': {
      get: {
        summary: 'Read one projected subscription entitlement',
        description:
          'Returns the latest finalized projected entitlement state for one exact network. Current eligibility is not evaluated; clients must compare time and authoritative WokeNet state.',
        parameters: [
          {
            name: 'entitlementAddress',
            in: 'path',
            required: true,
            schema: solanaPublicKeyParameterSchema,
          },
          networkParameter,
        ],
        responses: {
          '200': { description: 'Latest projected entitlement state with event provenance' },
          '400': { description: 'Invalid entitlement address or network' },
          '404': { description: 'Entitlement not found' },
        },
      },
    },
  },
} as const;
