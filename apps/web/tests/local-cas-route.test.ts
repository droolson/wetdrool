import { mkdtemp, readFile, readdir, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getContentCid } from '@wokesocial/protocol';
import type { ContentAddressedStorage } from '@wokesocial/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  LOCAL_CAS_CONTENT_TYPE,
  LOCAL_CAS_EXPECTED_CID_HEADER,
  handleLocalCasWriteRequest,
} from '../lib/local-cas-route';
import { createCanonicalEnvelopeBytes } from './local-cas-fixture';

const ORIGIN = 'http://localhost:3000';
const ROUTE = `${ORIGIN}/api/localnet/cas`;
const bytes = createCanonicalEnvelopeBytes();

describe('localnet CAS route', () => {
  let rootDirectory: string;

  beforeEach(async () => {
    rootDirectory = await mkdtemp(join(tmpdir(), 'wokesocial-web-cas-'));
  });

  afterEach(async () => {
    await rm(rootDirectory, { force: true, recursive: true });
  });

  it('writes exact immutable bytes and returns a verified receipt', async () => {
    const cid = await getContentCid(bytes);
    const response = await handleLocalCasWriteRequest(requestFor(bytes, cid), {
      environment: environment(rootDirectory),
    });

    expect(response.status).toBe(201);
    expect(response.headers.get('etag')).toBe(`"${cid}"`);
    expect(await response.json()).toEqual({
      outcome: 'stored',
      receipt: {
        byteLength: bytes.byteLength,
        cid,
        locator: `local://${cid}`,
        policy: { permanence: 'deletion-compatible' },
        provider: 'local-filesystem',
        providerVersion: '1',
        schema: 'wokesocial.local-cas-receipt.v1',
        verified: true,
      },
    });
    const objectPath = join(rootDirectory, 'objects', cid.slice(1, 3), cid);
    expect(new Uint8Array(await readFile(objectPath))).toEqual(bytes);
    expect((await stat(objectPath)).mode & 0o777).toBe(0o600);
  });

  it('accepts Next-shaped localhost headers with a same-port 127.0.0.1 internal URL', async () => {
    const cid = await getContentCid(bytes);
    const response = await handleLocalCasWriteRequest(
      requestFor(bytes, cid, {
        headers: nextLoopbackForwardingHeaders(),
        url: 'http://127.0.0.1:3000/api/localnet/cas',
      }),
      {
        environment: environment(rootDirectory),
      },
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      outcome: 'stored',
      receipt: { cid, verified: true },
    });
  });

  it('treats an identical retry as already present without rewriting the object', async () => {
    const cid = await getContentCid(bytes);
    const first = await handleLocalCasWriteRequest(requestFor(bytes, cid), {
      environment: environment(rootDirectory),
    });
    const firstBody = await first.json();
    const objectPath = join(rootDirectory, 'objects', cid.slice(1, 3), cid);
    const oldTime = new Date('2020-01-01T00:00:00.000Z');
    await utimes(objectPath, oldTime, oldTime);

    const retry = await handleLocalCasWriteRequest(requestFor(bytes, cid), {
      environment: environment(rootDirectory),
    });
    const retryBody = await retry.json();

    expect(retry.status).toBe(200);
    expect(retryBody).toEqual({
      outcome: 'already-present',
      receipt: firstBody.receipt,
    });
    expect((await stat(objectPath)).mtime.toISOString()).toBe(oldTime.toISOString());
    expect(await readdir(join(rootDirectory, 'objects', cid.slice(1, 3)))).toEqual([cid]);
  });

  it('rejects a mismatched or traversal-shaped expected CID before writing', async () => {
    for (const expectedCid of [await getContentCid(new Uint8Array([1])), '../../outside']) {
      const response = await handleLocalCasWriteRequest(requestFor(bytes, expectedCid), {
        environment: environment(rootDirectory),
      });

      expect(response.status).toBe(expectedCid.startsWith('bafk') ? 422 : 400);
    }
    await expect(readdir(rootDirectory)).resolves.toEqual([]);
  });

  it('rejects declared and streamed bodies over the configured limit', async () => {
    const cid = await getContentCid(bytes);
    const declared = await handleLocalCasWriteRequest(
      requestFor(bytes, cid, {
        headers: { 'content-length': '999' },
      }),
      {
        environment: environment(rootDirectory, 8),
      },
    );
    const streamed = await handleLocalCasWriteRequest(requestFor(bytes, cid), {
      environment: environment(rootDirectory, 8),
    });

    expect(declared.status).toBe(413);
    expect(streamed.status).toBe(413);
    await expect(readdir(rootDirectory)).resolves.toEqual([]);
  });

  it('rejects a mismatched Content-Length and unsupported body metadata', async () => {
    const cid = await getContentCid(bytes);
    const lengthMismatch = await handleLocalCasWriteRequest(
      requestFor(bytes, cid, { headers: { 'content-length': String(bytes.byteLength + 1) } }),
      { environment: environment(rootDirectory) },
    );
    const jsonWrapper = await handleLocalCasWriteRequest(
      requestFor(bytes, cid, { headers: { 'content-type': 'application/json' } }),
      { environment: environment(rootDirectory) },
    );
    const compressed = await handleLocalCasWriteRequest(
      requestFor(bytes, cid, { headers: { 'content-encoding': 'gzip' } }),
      { environment: environment(rootDirectory) },
    );

    expect(lengthMismatch.status).toBe(400);
    expect(jsonWrapper.status).toBe(415);
    expect(compressed.status).toBe(415);
  });

  it('does not accept private-key, seed, recovery, or PRF request fields', async () => {
    const cid = await getContentCid(bytes);
    for (const name of [
      'x-wokesocial-private-key',
      'x-wokesocial-prf-output',
      'x-wokesocial-recovery-material',
      'x-wokesocial-seed',
    ]) {
      const response = await handleLocalCasWriteRequest(
        requestFor(bytes, cid, { headers: { [name]: 'must-not-cross-http' } }),
        { environment: environment(rootDirectory) },
      );
      expect(response.status, name).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: 'secret-field-rejected' },
      });
    }

    const forbiddenBody = new TextEncoder().encode(
      '{"privateKey":"must-not-cross-http","prf":"must-not-cross-http"}',
    );
    const forbiddenBodyResponse = await handleLocalCasWriteRequest(
      requestFor(forbiddenBody, await getContentCid(forbiddenBody)),
      { environment: environment(rootDirectory) },
    );
    expect(forbiddenBodyResponse.status).toBe(422);
    await expect(forbiddenBodyResponse.json()).resolves.toMatchObject({
      error: { code: 'invalid-envelope' },
    });
  });

  it('fails closed when disabled, remotely configured, remotely addressed, or proxied', async () => {
    const cid = await getContentCid(bytes);
    const disabled = await handleLocalCasWriteRequest(requestFor(bytes, cid), {
      environment: {},
    });
    const production = await handleLocalCasWriteRequest(requestFor(bytes, cid), {
      environment: { ...environment(rootDirectory), APP_ENV: 'production' },
    });
    const remoteConfiguration = await handleLocalCasWriteRequest(requestFor(bytes, cid), {
      environment: {
        ...environment(rootDirectory),
        WOKESOCIAL_LOCAL_CAS_ORIGIN: 'https://woke.social',
      },
    });
    const remoteRequest = await handleLocalCasWriteRequest(
      requestFor(bytes, cid, { url: 'http://remote.example/api/localnet/cas' }),
      { environment: environment(rootDirectory) },
    );
    const proxied = await handleLocalCasWriteRequest(
      requestFor(bytes, cid, { headers: { 'x-forwarded-for': '127.0.0.1' } }),
      { environment: environment(rootDirectory) },
    );

    expect(disabled.status).toBe(503);
    expect(production.status).toBe(503);
    expect(remoteConfiguration.status).toBe(503);
    expect(remoteRequest.status).toBe(403);
    expect(proxied.status).toBe(403);
  });

  it('rejects inconsistent internal URLs, browser hosts, and forwarding metadata', async () => {
    const cid = await getContentCid(bytes);
    const cases: readonly {
      readonly name: string;
      readonly headers?: Readonly<Record<string, string>>;
      readonly url?: string;
    }[] = [
      {
        name: 'internal port',
        headers: nextLoopbackForwardingHeaders(),
        url: 'http://127.0.0.1:3001/api/localnet/cas',
      },
      {
        name: 'internal path',
        headers: nextLoopbackForwardingHeaders(),
        url: 'http://127.0.0.1:3000/api/localnet/cas/other',
      },
      {
        name: 'internal query',
        headers: nextLoopbackForwardingHeaders(),
        url: 'http://127.0.0.1:3000/api/localnet/cas?forwarded=true',
      },
      {
        name: 'browser host alias',
        headers: {
          ...nextLoopbackForwardingHeaders(),
          host: '127.0.0.1:3000',
        },
        url: 'http://127.0.0.1:3000/api/localnet/cas',
      },
      {
        name: 'forwarded host',
        headers: {
          ...nextLoopbackForwardingHeaders(),
          'x-forwarded-host': '127.0.0.1:3000',
        },
        url: 'http://127.0.0.1:3000/api/localnet/cas',
      },
      {
        name: 'forwarded port',
        headers: {
          ...nextLoopbackForwardingHeaders(),
          'x-forwarded-port': '3001',
        },
        url: 'http://127.0.0.1:3000/api/localnet/cas',
      },
      {
        name: 'forwarded protocol',
        headers: {
          ...nextLoopbackForwardingHeaders(),
          'x-forwarded-proto': 'https',
        },
        url: 'http://127.0.0.1:3000/api/localnet/cas',
      },
      {
        name: 'forwarded remote address',
        headers: {
          ...nextLoopbackForwardingHeaders(),
          'x-forwarded-for': '192.0.2.1',
        },
        url: 'http://127.0.0.1:3000/api/localnet/cas',
      },
      {
        name: 'standard Forwarded header',
        headers: {
          ...nextLoopbackForwardingHeaders(),
          forwarded: 'for=127.0.0.1;proto=http',
        },
        url: 'http://127.0.0.1:3000/api/localnet/cas',
      },
      {
        name: 'unknown forwarding header',
        headers: {
          ...nextLoopbackForwardingHeaders(),
          'x-forwarded-server': 'localhost',
        },
        url: 'http://127.0.0.1:3000/api/localnet/cas',
      },
    ];

    for (const testCase of cases) {
      const response = await handleLocalCasWriteRequest(
        requestFor(bytes, cid, {
          ...(testCase.headers === undefined ? {} : { headers: testCase.headers }),
          ...(testCase.url === undefined ? {} : { url: testCase.url }),
        }),
        { environment: environment(rootDirectory) },
      );
      expect(response.status, testCase.name).toBe(403);
      await expect(response.json(), testCase.name).resolves.toMatchObject({
        error: { code: 'origin-not-allowed' },
      });
    }
    await expect(readdir(rootDirectory)).resolves.toEqual([]);
  });

  it('returns an integrity failure instead of trusting a dishonest storage readback', async () => {
    const cid = await getContentCid(bytes);
    const dishonestStorage: ContentAddressedStorage = {
      name: 'local-filesystem',
      version: '1',
      delete: async () => false,
      get: async () => new TextEncoder().encode('tampered'),
      has: async () => true,
      health: async () => ({
        checkedAt: '2026-07-29T00:00:00.000Z',
        ok: true,
        provider: 'local-filesystem',
      }),
      put: async () => {
        throw new Error('put must not be called for an existing CID');
      },
    };
    const response = await handleLocalCasWriteRequest(requestFor(bytes, cid), {
      environment: environment(rootDirectory),
      storageFactory: () => dishonestStorage,
    });

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'integrity-failure' },
    });
  });
});

function environment(rootDirectory: string, maximumObjectBytes = 262_144): Record<string, string> {
  return {
    APP_ENV: 'development',
    CONTENT_STORAGE_PATH: rootDirectory,
    NODE_ENV: 'test',
    WOKESOCIAL_LOCAL_CAS_MAX_BYTES: String(maximumObjectBytes),
    WOKESOCIAL_LOCAL_CAS_MODE: 'localnet',
    WOKESOCIAL_LOCAL_CAS_ORIGIN: ORIGIN,
  };
}

function requestFor(
  body: Uint8Array,
  expectedCid: string,
  options: {
    readonly headers?: Readonly<Record<string, string>>;
    readonly url?: string;
  } = {},
): Request {
  return new Request(options.url ?? ROUTE, {
    body: body.slice().buffer,
    headers: {
      'content-type': LOCAL_CAS_CONTENT_TYPE,
      [LOCAL_CAS_EXPECTED_CID_HEADER]: expectedCid,
      host: new URL(ORIGIN).host,
      origin: ORIGIN,
      'sec-fetch-site': 'same-origin',
      ...options.headers,
    },
    method: 'POST',
  });
}

function nextLoopbackForwardingHeaders(): Readonly<Record<string, string>> {
  return {
    'x-forwarded-for': '127.0.0.1',
    'x-forwarded-host': new URL(ORIGIN).host,
    'x-forwarded-port': new URL(ORIGIN).port,
    'x-forwarded-proto': 'http',
  };
}
