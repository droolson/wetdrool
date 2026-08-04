export const moderationOpenApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'WetDrool replaceable moderation service',
    version: '0.2.0',
    description:
      'Non-authoritative signed moderation labels plus an encrypted, auditable restricted case ledger.',
  },
  components: {
    securitySchemes: {
      operatorBearer: {
        type: 'http',
        scheme: 'bearer',
        description:
          'Deployment-provided operator authorization. The service stores no bearer credential.',
      },
    },
    schemas: {
      CaseTransition: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion', 'toState', 'reasonCode'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          toState: {
            enum: [
              'received',
              'awaiting-triage',
              'under-review',
              'information-requested',
              'action-taken',
              'no-action',
              'referred',
              'appealed',
              'closed',
            ],
          },
          reasonCode: { type: 'string', pattern: '^[a-z][a-z0-9.-]{1,63}$' },
          note: { type: 'string', minLength: 1, maxLength: 2000 },
        },
      },
      ModerationSubject: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'identity'],
            properties: {
              kind: { const: 'identity' },
              identity: { type: 'string', minLength: 1, maxLength: 220 },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'object'],
            properties: {
              kind: { const: 'object' },
              object: {
                type: 'object',
                additionalProperties: false,
                required: ['id'],
                properties: { id: { type: 'string', minLength: 1, maxLength: 220 } },
              },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['kind', 'community'],
            properties: {
              kind: { const: 'community' },
              community: {
                type: 'object',
                additionalProperties: false,
                required: ['id'],
                properties: { id: { type: 'string', minLength: 1, maxLength: 220 } },
              },
            },
          },
        ],
      },
      ModerationAction: {
        type: 'object',
        additionalProperties: false,
        required: [
          'expectedVersion',
          'kind',
          'target',
          'scope',
          'policyId',
          'policyVersion',
          'ruleId',
          'reasonCategory',
          'consequences',
          'appealEligible',
        ],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          kind: {
            enum: [
              'guidance',
              'context-label',
              'downrank',
              'posting-cooldown',
              'temporary-restriction',
              'community-removal',
              'membership-suspension',
              'membership-removal',
              'emergency-safety',
            ],
          },
          target: { $ref: '#/components/schemas/ModerationSubject' },
          targetHash: { type: 'string' },
          scope: { enum: ['community', 'operator'] },
          policyId: { type: 'string' },
          policyVersion: { type: 'integer', minimum: 1 },
          ruleId: { type: 'string', pattern: '^[a-z][a-z0-9-]{1,63}$' },
          reasonCategory: {
            enum: [
              'spam',
              'harassment',
              'doxxing-risk',
              'nonconsensual-intimate-media',
              'child-safety',
              'threat',
              'impersonation',
              'illegal-content',
              'self-harm-concern',
              'community-rule',
              'technical-abuse',
              'other',
            ],
          },
          moderatorNote: { type: 'string', minLength: 1, maxLength: 4000 },
          consequences: {
            type: 'array',
            minItems: 1,
            maxItems: 8,
            uniqueItems: true,
            items: {
              enum: [
                'warn',
                'blur',
                'downrank',
                'hide',
                'restrict-replies',
                'restrict-posting',
                'remove-community-content',
                'suspend-membership',
                'remove-membership',
              ],
            },
          },
          effectiveAt: { type: 'string', format: 'date-time' },
          expiresAt: { type: 'string', format: 'date-time' },
          reviewDueAt: { type: 'string', format: 'date-time' },
          appealEligible: { type: 'boolean' },
          appealDeadline: { type: 'string', format: 'date-time' },
          supersedesActionId: { type: 'string', format: 'uuid' },
        },
        allOf: [
          {
            if: {
              properties: {
                kind: {
                  enum: [
                    'posting-cooldown',
                    'temporary-restriction',
                    'membership-suspension',
                    'emergency-safety',
                  ],
                },
              },
              required: ['kind'],
            },
            then: { required: ['expiresAt'] },
          },
          {
            if: {
              properties: { kind: { const: 'emergency-safety' } },
              required: ['kind'],
            },
            then: { required: ['reviewDueAt'] },
            else: { not: { required: ['reviewDueAt'] } },
          },
          {
            if: {
              properties: { appealEligible: { const: true } },
              required: ['appealEligible'],
            },
            then: { required: ['appealDeadline'] },
            else: { not: { required: ['appealDeadline'] } },
          },
        ],
      },
      ActionReview: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion', 'actionId', 'outcome', 'rationale'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          actionId: { type: 'string', format: 'uuid' },
          appealId: { type: 'string' },
          outcome: { enum: ['upheld', 'modified', 'reversed'] },
          rationale: { type: 'string', minLength: 1, maxLength: 4000 },
          restoration: { type: 'string', minLength: 1, maxLength: 2000 },
          conflictOverrideReason: { type: 'string', minLength: 12, maxLength: 2000 },
        },
      },
      LegalHold: {
        type: 'object',
        additionalProperties: false,
        required: ['expectedVersion', 'active', 'reason'],
        properties: {
          expectedVersion: { type: 'integer', minimum: 1 },
          active: { type: 'boolean' },
          reason: { type: 'string', minLength: 12, maxLength: 2000 },
        },
      },
    },
  },
  paths: {
    '/healthz': {
      get: { summary: 'Process liveness', responses: { '200': { description: 'Alive' } } },
    },
    '/readyz': {
      get: {
        summary: 'Authorization readiness',
        responses: {
          '200': { description: 'Ready' },
          '503': { description: 'Locked or dependency unavailable' },
        },
      },
    },
    '/v1/labels': {
      get: {
        summary: 'List active signed labels for one exact subject',
        parameters: [
          {
            in: 'query',
            name: 'subjectKind',
            required: true,
            schema: { enum: ['identity', 'object', 'community'] },
          },
          { in: 'query', name: 'subjectId', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Advisory active labels' } },
      },
      post: {
        summary: 'Ingest an authorized signed moderation-label envelope',
        responses: {
          '201': { description: 'Accepted' },
          '403': { description: 'Signing key or provider is not authorized' },
          '503': { description: 'Service is locked without an authorizer' },
        },
      },
    },
    '/v1/reports': {
      post: {
        summary: 'Ingest a restricted signed report envelope',
        responses: {
          '202': { description: 'Accepted without echoing evidence' },
          '403': { description: 'Signing key is not authorized' },
        },
      },
    },
    '/v1/appeals': {
      post: {
        summary: 'Ingest a restricted signed appeal for an existing decision',
        responses: {
          '202': { description: 'Accepted without echoing evidence' },
          '409': { description: 'Decision is not present' },
        },
      },
    },
    '/v1/cases/{reportId}': {
      get: {
        summary: 'Read a restricted report case after purpose-bound operator authorization',
        security: [{ operatorBearer: [] }],
        parameters: [
          { in: 'path', name: 'reportId', required: true, schema: { type: 'string' } },
          {
            in: 'header',
            name: 'x-moderation-purpose',
            required: true,
            schema: { type: 'string', maxLength: 160 },
          },
        ],
        responses: {
          '200': { description: 'Restricted case' },
          '403': { description: 'Case access denied' },
          '404': { description: 'Case not found' },
        },
      },
    },
    '/v1/cases/{reportId}/ledger': {
      get: {
        summary: 'Read the restricted append-only case ledger',
        security: [{ operatorBearer: [] }],
        parameters: [
          { in: 'path', name: 'reportId', required: true, schema: { type: 'string' } },
          {
            in: 'header',
            name: 'x-moderation-purpose',
            required: true,
            schema: { type: 'string', minLength: 3, maxLength: 160 },
          },
        ],
        responses: {
          '200': { description: 'Purpose-authorized case, action, review, and access history' },
          '403': { description: 'Missing case.audit permission or purpose-bound authorization' },
          '404': { description: 'Case not found' },
        },
      },
    },
    '/v1/cases/{reportId}/transitions': {
      post: {
        summary: 'Apply an optimistic, scoped case-state transition',
        security: [{ operatorBearer: [] }],
        parameters: [
          { in: 'path', name: 'reportId', required: true, schema: { type: 'string' } },
          {
            in: 'header',
            name: 'x-moderation-purpose',
            required: true,
            schema: { type: 'string', minLength: 3, maxLength: 160 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/CaseTransition' } },
          },
        },
        responses: {
          '200': { description: 'Transition recorded' },
          '403': { description: 'Operator scope denied' },
          '409': { description: 'Stale version or invalid transition' },
        },
      },
    },
    '/v1/cases/{reportId}/actions': {
      post: {
        summary: 'Append a policy-bound moderation action',
        description:
          'The strict runtime schema requires target, scope, policy/rule, consequences, appeal metadata, and bounded emergency/temporary times.',
        security: [{ operatorBearer: [] }],
        parameters: [
          { in: 'path', name: 'reportId', required: true, schema: { type: 'string' } },
          {
            in: 'header',
            name: 'x-moderation-purpose',
            required: true,
            schema: { type: 'string', minLength: 3, maxLength: 160 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ModerationAction' } },
          },
        },
        responses: {
          '201': { description: 'Action appended' },
          '400': { description: 'Strict action validation failed' },
          '403': { description: 'case.act or case.emergency scope denied' },
          '409': { description: 'Stale case version or conflicting supersession' },
        },
      },
    },
    '/v1/cases/{reportId}/reviews': {
      post: {
        summary: 'Append an independent appeal or emergency-action review',
        description:
          'Self-review is rejected unless a separately scoped conflict.override assertion and a reason are both present.',
        security: [{ operatorBearer: [] }],
        parameters: [
          { in: 'path', name: 'reportId', required: true, schema: { type: 'string' } },
          {
            in: 'header',
            name: 'x-moderation-purpose',
            required: true,
            schema: { type: 'string', minLength: 3, maxLength: 160 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ActionReview' } },
          },
        },
        responses: {
          '201': { description: 'Review appended' },
          '403': { description: 'Review or conflict-override scope denied' },
          '404': { description: 'Action or appeal not found in this case' },
          '409': { description: 'Self-review, duplicate review, or stale version' },
        },
      },
    },
    '/v1/cases/{reportId}/legal-hold': {
      post: {
        summary: 'Append and apply a reasoned legal-hold state change',
        security: [{ operatorBearer: [] }],
        parameters: [
          { in: 'path', name: 'reportId', required: true, schema: { type: 'string' } },
          {
            in: 'header',
            name: 'x-moderation-purpose',
            required: true,
            schema: { type: 'string', minLength: 3, maxLength: 160 },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/LegalHold' } },
          },
        },
        responses: {
          '200': { description: 'Legal-hold event recorded' },
          '403': { description: 'case.legal-hold scope denied' },
          '409': { description: 'Stale version or unchanged hold state' },
        },
      },
    },
    '/v1/transparency': {
      get: {
        summary: 'Read privacy-safe aggregate moderation metrics',
        description:
          'Windows are bounded to 366 days. Small categories are combined and no report, subject, actor, evidence, note, or object identifier is returned.',
        parameters: [
          {
            in: 'query',
            name: 'from',
            required: true,
            schema: { type: 'string', format: 'date-time' },
          },
          {
            in: 'query',
            name: 'to',
            required: true,
            schema: { type: 'string', format: 'date-time' },
          },
          {
            in: 'query',
            name: 'minimumCellSize',
            schema: { type: 'integer', minimum: 3, maximum: 100 },
          },
        ],
        responses: {
          '200': { description: 'Small-cell-suppressed aggregate report' },
          '400': { description: 'Invalid or excessive time window' },
        },
      },
    },
  },
} as const;
