import { getObjectId } from '@wokesocial/protocol';
import { afterEach, describe, expect, it } from 'vitest';

import { buildModerationApp, type ModerationAppOptions } from '../src/app.js';
import { ModerationService } from '../src/service.js';
import {
  knownKeyAuthorizer,
  makeAppeal,
  makeLabel,
  makeReport,
  postSubject,
  serviceNow,
} from './fixtures.js';
import { actionInput, operator } from './ledger-fixtures.js';

const apps: Awaited<ReturnType<typeof buildModerationApp>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function buildVerifiedApp(
  options: {
    readonly authorizeCaseRead?: (input: {
      reportId: string;
      authorization: string | undefined;
      purpose: string;
    }) => boolean;
    readonly authorizeOperator?: ModerationAppOptions['authorizeOperator'];
    readonly rateLimitMax?: number;
  } = {},
) {
  const app = await buildModerationApp({
    service: new ModerationService({
      authorizeObject: knownKeyAuthorizer,
      now: () => serviceNow,
    }),
    logger: false,
    ...(options.authorizeCaseRead === undefined
      ? {}
      : { authorizeCaseRead: options.authorizeCaseRead }),
    ...(options.authorizeOperator === undefined
      ? {}
      : { authorizeOperator: options.authorizeOperator }),
    ...(options.rateLimitMax === undefined ? {} : { rateLimitMax: options.rateLimitMax }),
  });
  apps.push(app);
  return app;
}

describe('moderation HTTP API', () => {
  it('advertises locked readiness and refuses writes by default', async () => {
    const app = await buildModerationApp({
      service: new ModerationService(),
      logger: false,
    });
    apps.push(app);

    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toMatchObject({
      ok: true,
      advisory: true,
      canonical: false,
      authorization: 'locked',
    });
    expect((await app.inject({ method: 'GET', url: '/readyz' })).statusCode).toBe(503);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/labels',
      payload: makeLabel(),
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: { code: 'locked' } });
  });

  it('ingests idempotently and queries active public signed labels', async () => {
    const app = await buildVerifiedApp();
    const label = makeLabel();

    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/labels',
          payload: label,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/v1/labels',
          payload: label,
        })
      ).statusCode,
    ).toBe(200);

    if (postSubject.kind !== 'object') {
      throw new Error('Unexpected fixture subject.');
    }
    const response = await app.inject({
      method: 'GET',
      url: `/v1/labels?subjectKind=object&subjectId=${encodeURIComponent(postSubject.object.id)}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      advisory: true,
      canonical: false,
      labels: [{ objectId: getObjectId(label.payload), envelope: label }],
    });
  });

  it('never echoes a restricted report or its evidence in an intake receipt', async () => {
    const app = await buildVerifiedApp();
    const report = makeReport();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: report,
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body).toMatchObject({
      objectId: getObjectId(report.payload),
      objectType: 'report',
      confidentiality: 'restricted',
    });
    expect(body).not.toHaveProperty('envelope');
    expect(body).not.toHaveProperty('cid');
    expect(response.body).not.toContain('targeted harassment');
  });

  it('requires explicit purpose-bound authorization before returning a case', async () => {
    const app = await buildVerifiedApp({
      authorizeCaseRead: ({ authorization, purpose }) =>
        authorization === 'Bearer operator-test' && purpose === 'appeal-review',
    });
    const report = makeReport();
    const reportResponse = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: report,
    });
    const reportId = reportResponse.json().objectId as string;
    const appeal = makeAppeal({ id: reportId });
    await app.inject({ method: 'POST', url: '/v1/appeals', payload: appeal });

    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/cases/${encodeURIComponent(reportId)}`,
        })
      ).statusCode,
    ).toBe(403);
    const authorized = await app.inject({
      method: 'GET',
      url: `/v1/cases/${encodeURIComponent(reportId)}`,
      headers: {
        authorization: 'Bearer operator-test',
        'x-moderation-purpose': 'appeal-review',
      },
    });
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toMatchObject({
      confidentiality: 'restricted',
      report,
      appeals: [appeal],
    });
  });

  it('rejects malformed subject queries and wrong signed object types', async () => {
    const app = await buildVerifiedApp();
    expect((await app.inject({ method: 'GET', url: '/v1/labels' })).statusCode).toBe(400);
    const response = await app.inject({
      method: 'POST',
      url: '/v1/labels',
      payload: makeReport(),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'invalid-object' } });
  });

  it('returns consistent advisory errors for unknown routes and unsupported bodies', async () => {
    const app = await buildVerifiedApp();
    const missing = await app.inject({ method: 'GET', url: '/not-a-moderation-route' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({
      advisory: true,
      canonical: false,
      error: { code: 'route-not-found' },
    });

    const unsupported = await app.inject({
      method: 'POST',
      url: '/v1/labels',
      headers: { 'content-type': 'text/plain' },
      payload: '{}',
    });
    expect(unsupported.statusCode).toBe(415);
    expect(unsupported.json()).toMatchObject({
      advisory: true,
      canonical: false,
      error: { code: 'unsupported-media-type' },
    });
  });

  it('sets API security headers and publishes no canonical-state claim', async () => {
    const app = await buildVerifiedApp();
    const response = await app.inject({ method: 'GET', url: '/v1/policy' });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.json()).toMatchObject({
      advisory: true,
      canonical: false,
      reportConfidentiality: 'restricted',
    });
  });

  it('publishes strict workflow request schemas in OpenAPI', async () => {
    const app = await buildVerifiedApp();
    const response = await app.inject({ method: 'GET', url: '/openapi.json' });
    expect(response.statusCode).toBe(200);
    const document = response.json();
    expect(document.info.version).toBe('0.2.0');
    expect(document.components.schemas.ModerationAction).toMatchObject({
      additionalProperties: false,
      required: expect.arrayContaining(['expectedVersion', 'target', 'policyId']),
    });
    expect(
      document.paths['/v1/cases/{reportId}/actions'].post.requestBody.content['application/json']
        .schema,
    ).toEqual({ $ref: '#/components/schemas/ModerationAction' });
    expect(
      document.paths['/v1/cases/{reportId}/reviews'].post.requestBody.content['application/json']
        .schema,
    ).toEqual({ $ref: '#/components/schemas/ActionReview' });
  });

  it('fails closed when operator authorization throws or omits the exact read scope', async () => {
    const report = makeReport();
    const throwing = await buildVerifiedApp({
      authorizeOperator: async () => {
        throw new Error('authorizer unavailable');
      },
    });
    const throwingReport = await throwing.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: report,
    });
    const throwingId = throwingReport.json().objectId as string;
    expect(
      (
        await throwing.inject({
          method: 'GET',
          url: `/v1/cases/${encodeURIComponent(throwingId)}`,
          headers: {
            authorization: 'Bearer unavailable',
            'x-moderation-purpose': 'policy-review',
          },
        })
      ).statusCode,
    ).toBe(403);

    const wrongScope = await buildVerifiedApp({
      authorizeOperator: () => operator('operator:triage-only', ['case.triage']),
    });
    const scopedReport = await wrongScope.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: makeReport(),
    });
    const scopedId = scopedReport.json().objectId as string;
    expect(
      (
        await wrongScope.inject({
          method: 'GET',
          url: `/v1/cases/${encodeURIComponent(scopedId)}`,
          headers: {
            authorization: 'Bearer wrong-scope',
            'x-moderation-purpose': 'policy-review',
          },
        })
      ).statusCode,
    ).toBe(403);
  });

  it('exposes strict purpose-authorized workflow APIs and audits allowed and denied access', async () => {
    const moderator = operator();
    const app = await buildVerifiedApp({
      authorizeOperator: ({ authorization }) =>
        authorization === 'Bearer moderator' ? moderator : false,
    });
    const reportResponse = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: makeReport(),
    });
    const reportId = reportResponse.json().objectId as string;
    const headers = {
      authorization: 'Bearer moderator',
      'x-moderation-purpose': 'policy-review',
    };

    const transition = await app.inject({
      method: 'POST',
      url: `/v1/cases/${encodeURIComponent(reportId)}/transitions`,
      headers,
      payload: {
        expectedVersion: 1,
        toState: 'under-review',
        reasonCode: 'triage.accepted',
      },
    });
    expect(transition.statusCode).toBe(200);
    expect(transition.json()).toMatchObject({ case: { state: 'under-review', version: 2 } });

    const action = await app.inject({
      method: 'POST',
      url: `/v1/cases/${encodeURIComponent(reportId)}/actions`,
      headers,
      payload: actionInput(2),
    });
    expect(action.statusCode).toBe(201);
    expect(action.json()).toMatchObject({
      action: { policyVersion: 1, ruleId: 'targeted-harassment' },
    });

    const denied = await app.inject({
      method: 'POST',
      url: `/v1/cases/${encodeURIComponent(reportId)}/actions`,
      headers: {
        authorization: 'Bearer denied',
        'x-moderation-purpose': 'policy-review',
      },
      payload: actionInput(3),
    });
    expect(denied.statusCode).toBe(403);

    const malformed = await app.inject({
      method: 'POST',
      url: `/v1/cases/${encodeURIComponent(reportId)}/actions`,
      headers,
      payload: { ...actionInput(3), unexpected: true },
    });
    expect(malformed.statusCode).toBe(400);

    const ledger = await app.inject({
      method: 'GET',
      url: `/v1/cases/${encodeURIComponent(reportId)}/ledger`,
      headers: {
        authorization: 'Bearer moderator',
        'x-moderation-purpose': 'audit-review',
      },
    });
    expect(ledger.statusCode).toBe(200);
    expect(ledger.json()).toMatchObject({
      confidentiality: 'restricted',
      ledger: {
        snapshot: { state: 'action-taken', version: 3 },
        access: expect.arrayContaining([
          expect.objectContaining({ operation: 'case.action', allowed: false }),
          expect.objectContaining({ operation: 'case.audit', allowed: true }),
        ]),
      },
    });
  });

  it('publishes only small-cell-suppressed transparency aggregates', async () => {
    const app = await buildVerifiedApp();
    const report = await app.inject({
      method: 'POST',
      url: '/v1/reports',
      payload: makeReport(),
    });
    const reportId = report.json().objectId as string;
    const response = await app.inject({
      method: 'GET',
      url:
        '/v1/transparency?from=2026-07-29T00%3A00%3A00.000Z' +
        '&to=2026-07-30T00%3A00%3A00.000Z&minimumCellSize=3',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      privacySafe: true,
      rawCasesIncluded: false,
      reportsByCategory: [{ category: 'other-or-suppressed', count: 1 }],
    });
    expect(response.body).not.toContain(reportId);
    expect(response.body).not.toContain('targeted harassment');
  });
});
