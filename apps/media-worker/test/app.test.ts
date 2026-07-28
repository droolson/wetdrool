import { join } from 'node:path';

import { MemoryContentAddressedStorage } from '@wokesocial/storage';
import { afterEach, describe, expect, it } from 'vitest';

import { buildMediaWorkerApp } from '../src/app.js';
import { digestBytes } from '../src/digests.js';
import { MediaWorkerService } from '../src/service.js';
import {
  buildTestService,
  createTestRoot,
  fixedNow,
  pngFixture,
  removeTestRoot,
  uploadDeclaration,
} from './fixtures.js';

const apps: Awaited<ReturnType<typeof buildMediaWorkerApp>>[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(roots.splice(0).map(removeTestRoot));
});

async function makeApp(
  options: {
    readonly allowedOrigins?: readonly string[];
    readonly locked?: boolean;
    readonly rateLimitMax?: number;
  } = {},
) {
  const root = await createTestRoot();
  roots.push(root);
  const service =
    options.locked === true
      ? new MediaWorkerService({
          stagingRoot: join(root, 'staging'),
          temporaryRoot: join(root, 'temporary'),
          storage: new MemoryContentAddressedStorage(),
          clock: () => fixedNow,
        })
      : buildTestService(root);
  const app = await buildMediaWorkerApp({
    service,
    logger: false,
    authorizeRequest: () => true,
    ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
    ...(options.rateLimitMax === undefined ? {} : { rateLimitMax: options.rateLimitMax }),
  });
  apps.push(app);
  return { app, service };
}

describe('media worker HTTP API', () => {
  it('advertises honest liveness, policy, and locked readiness without a scanner', async () => {
    const { app } = await makeApp({ locked: true });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).json()).toEqual({
      ok: true,
      service: '@wokesocial/media-worker',
      canonical: false,
      signsForUsers: false,
    });
    const readiness = await app.inject({ method: 'GET', url: '/readyz' });
    expect(readiness.statusCode).toBe(503);
    expect(readiness.json()).toMatchObject({
      ok: false,
      scanner: { name: 'unavailable', available: false },
    });
    const policy = await app.inject({ method: 'GET', url: '/v1/policy' });
    expect(policy.json()).toMatchObject({
      canonical: false,
      signsForUsers: false,
      malwareScanning: 'locked',
      defaultStoragePermanence: 'deletion-compatible',
    });
    expect(policy.headers['x-content-type-options']).toBe('nosniff');
    expect(policy.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it('supports an exact-offset resumable upload and idempotent finalization', async () => {
    const { app } = await makeApp();
    const bytes = await pngFixture();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/uploads',
      payload: uploadDeclaration(bytes),
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().id as string;
    expect(created.headers.location).toBe(`/v1/uploads/${id}`);
    expect(created.headers['upload-offset']).toBe('0');

    const split = Math.floor(bytes.byteLength / 2);
    const first = bytes.slice(0, split);
    const second = bytes.slice(split);
    const firstPatch = await patch(app, id, 0, first);
    expect(firstPatch.statusCode).toBe(204);
    expect(firstPatch.headers['upload-offset']).toBe(String(split));

    const conflict = await patch(app, id, 0, second);
    expect(conflict.statusCode).toBe(409);
    expect(conflict.headers['upload-offset']).toBe(String(split));
    expect(conflict.json()).toMatchObject({ error: { code: 'conflict' } });

    expect((await patch(app, id, split, second)).statusCode).toBe(204);
    const head = await app.inject({ method: 'HEAD', url: `/v1/uploads/${id}` });
    expect(head.statusCode).toBe(200);
    expect(head.headers['upload-offset']).toBe(String(bytes.byteLength));

    const finalized = await app.inject({
      method: 'POST',
      url: `/v1/uploads/${id}/finalize`,
    });
    expect(finalized.statusCode).toBe(201);
    expect(finalized.json()).toMatchObject({
      unsigned: true,
      clientMustSign: true,
      manifestContent: { malwareScan: { status: 'passed' } },
    });
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/v1/uploads/${id}/finalize`,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('rejects a chunk with the wrong digest without advancing its offset', async () => {
    const { app } = await makeApp();
    const bytes = await pngFixture();
    const created = await app.inject({
      method: 'POST',
      url: '/v1/uploads',
      payload: uploadDeclaration(bytes),
    });
    const id = created.json().id as string;
    const response = await app.inject({
      method: 'PATCH',
      url: `/v1/uploads/${id}`,
      headers: {
        'content-type': 'application/offset+octet-stream',
        'upload-offset': '0',
        'upload-chunk-sha256': digestBytes(new Uint8Array([1])),
      },
      payload: Buffer.from(bytes),
    });
    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({ error: { code: 'chunk-hash-mismatch' } });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/v1/uploads/${id}`,
        })
      ).json().offset,
    ).toBe(0);
  });

  it('cancels incomplete uploads and keeps completed publications immutable', async () => {
    const { app } = await makeApp();
    const bytes = await pngFixture();
    const first = await app.inject({
      method: 'POST',
      url: '/v1/uploads',
      payload: uploadDeclaration(bytes),
    });
    const firstId = first.json().id as string;
    expect((await app.inject({ method: 'DELETE', url: `/v1/uploads/${firstId}` })).statusCode).toBe(
      204,
    );
    expect((await app.inject({ method: 'GET', url: `/v1/uploads/${firstId}` })).json().state).toBe(
      'cancelled',
    );

    const second = await app.inject({
      method: 'POST',
      url: '/v1/uploads',
      payload: uploadDeclaration(bytes),
    });
    const secondId = second.json().id as string;
    await patch(app, secondId, 0, bytes);
    await app.inject({ method: 'POST', url: `/v1/uploads/${secondId}/finalize` });
    const rejected = await app.inject({
      method: 'DELETE',
      url: `/v1/uploads/${secondId}`,
    });
    expect(rejected.statusCode).toBe(409);
  });

  it('returns bounded validation errors without reflecting upload bytes', async () => {
    const { app } = await makeApp();
    const response = await app.inject({
      method: 'POST',
      url: '/v1/uploads',
      payload: {
        declaredMediaType: 'text/html',
        totalBytes: 5,
        sha256: 'not-a-digest',
        extra: '<script>secret()</script>',
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain('<script>');
    expect(response.json()).toHaveProperty('error.code', 'invalid-request');

    const oversized = await app.inject({
      method: 'POST',
      url: '/v1/uploads',
      payload: {
        ...uploadDeclaration(await pngFixture()),
        extra: 'x'.repeat(65_000),
      },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json()).toHaveProperty('error.code', 'body-too-large');
  });

  it('locks upload state when no authorizer exists and rejects denied credentials', async () => {
    const rootWithoutAuthorization = await createTestRoot();
    roots.push(rootWithoutAuthorization);
    const service = buildTestService(rootWithoutAuthorization);
    const locked = await buildMediaWorkerApp({ service, logger: false });
    apps.push(locked);
    const bytes = await pngFixture();
    expect(
      (
        await locked.inject({
          method: 'POST',
          url: '/v1/uploads',
          payload: uploadDeclaration(bytes),
        })
      ).statusCode,
    ).toBe(503);

    const deniedRoot = await createTestRoot();
    roots.push(deniedRoot);
    const denied = await buildMediaWorkerApp({
      service: buildTestService(deniedRoot),
      logger: false,
      authorizeRequest: ({ authorization }) => authorization === 'Bearer permitted',
    });
    apps.push(denied);
    expect(
      (
        await denied.inject({
          method: 'POST',
          url: '/v1/uploads',
          payload: uploadDeclaration(bytes),
        })
      ).statusCode,
    ).toBe(403);

    const claimRoot = await createTestRoot();
    roots.push(claimRoot);
    const claimService = buildTestService(claimRoot);
    let rejectedClaimId: string | undefined;
    const claimDenied = await buildMediaWorkerApp({
      service: claimService,
      logger: false,
      authorizeRequest: ({ action, declaration, uploadId }) => {
        if (action === 'create') {
          return declaration?.storagePolicy.permanence === 'deletion-compatible';
        }
        if (action === 'claim') {
          rejectedClaimId = uploadId;
          return false;
        }
        return false;
      },
    });
    apps.push(claimDenied);
    expect(
      (
        await claimDenied.inject({
          method: 'POST',
          url: '/v1/uploads',
          payload: uploadDeclaration(bytes),
        })
      ).statusCode,
    ).toBe(403);
    expect(rejectedClaimId).toBeTypeOf('string');
    if (rejectedClaimId === undefined) {
      throw new Error('Expected the rejected upload claim identifier.');
    }
    expect(await claimService.getUpload(rejectedClaimId)).toMatchObject({
      state: 'cancelled',
      failureCode: 'cancelled',
    });
  });

  it('publishes an OpenAPI document covering the resumable and finalize endpoints', async () => {
    const { app } = await makeApp();
    const document = (await app.inject({ method: 'GET', url: '/openapi.json' })).json() as Record<
      string,
      unknown
    >;
    expect(document).toHaveProperty('openapi', '3.1.0');
    expect(document).toHaveProperty('paths./v1/uploads.post');
    expect(document).toHaveProperty('paths./v1/uploads/{uploadId}.patch');
    expect(document).toHaveProperty('paths./v1/uploads/{uploadId}.parameters.0.name', 'uploadId');
    expect(document).toHaveProperty('paths./v1/uploads/{uploadId}/finalize.post');
    expect(document).toHaveProperty(
      'paths./v1/uploads/{uploadId}/finalize.parameters.0.required',
      true,
    );
  });

  it('allows browser bearer authorization only for validated exact CORS origins', async () => {
    const { app } = await makeApp({ allowedOrigins: ['https://woke.social'] });
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/v1/uploads',
      headers: {
        origin: 'https://woke.social',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization, content-type',
      },
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('https://woke.social');
    expect(preflight.headers['access-control-allow-headers']).toContain('authorization');

    const rejectedRoot = await createTestRoot();
    roots.push(rejectedRoot);
    await expect(
      buildMediaWorkerApp({
        service: buildTestService(rejectedRoot),
        logger: false,
        authorizeRequest: () => true,
        allowedOrigins: ['*'],
      }),
    ).rejects.toBeDefined();
  });

  it('enforces the configured request rate limit', async () => {
    const { app } = await makeApp({ rateLimitMax: 1 });
    expect((await app.inject({ method: 'GET', url: '/healthz' })).statusCode).toBe(200);
    const limited = await app.inject({ method: 'GET', url: '/healthz' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: { code: 'rate-limit-exceeded' } });
  });
});

function patch(
  app: Awaited<ReturnType<typeof buildMediaWorkerApp>>,
  id: string,
  offset: number,
  bytes: Uint8Array,
) {
  return app.inject({
    method: 'PATCH',
    url: `/v1/uploads/${id}`,
    headers: {
      'content-type': 'application/offset+octet-stream',
      'upload-offset': String(offset),
      'upload-chunk-sha256': digestBytes(bytes),
    },
    payload: Buffer.from(bytes),
  });
}
