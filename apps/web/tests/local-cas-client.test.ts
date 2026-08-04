import { getContentCid } from '@wetdrool/protocol';
import { describe, expect, it, vi } from 'vitest';

import { LocalCasBrowserClient, LocalCasBrowserClientError } from '../lib/local-cas-client';
import {
  LOCAL_CAS_CONTENT_TYPE,
  LOCAL_CAS_EXPECTED_CID_HEADER,
  LOCAL_CAS_ROUTE,
  type LocalCasWriteResult,
} from '../lib/local-cas-contract';
import { createCanonicalEnvelopeBytes } from './local-cas-fixture';

const bytes = createCanonicalEnvelopeBytes();

describe('local CAS browser client', () => {
  it('posts exact bytes and CID with a same-origin-only request policy', async () => {
    const cid = await getContentCid(bytes);
    const stored = resultFor(cid, bytes.byteLength, 'stored');
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    fetcher.mockResolvedValue(jsonResponse(stored, 201, cid));
    const client = new LocalCasBrowserClient({ fetch: fetcher });

    await expect(client.put(bytes, cid)).resolves.toEqual(stored);
    expect(fetcher).toHaveBeenCalledOnce();
    const [input, init] = fetcher.mock.calls[0] ?? [];
    expect(input).toBe(LOCAL_CAS_ROUTE);
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'content-type': LOCAL_CAS_CONTENT_TYPE,
        [LOCAL_CAS_EXPECTED_CID_HEADER]: cid,
      },
      method: 'POST',
      redirect: 'error',
      referrerPolicy: 'same-origin',
    });
    expect(new Uint8Array(init?.body as Uint8Array)).toEqual(bytes);
    expect(init?.body).not.toBe(bytes);
  });

  it('accepts an exact already-present retry receipt', async () => {
    const cid = await getContentCid(bytes);
    const replay = resultFor(cid, bytes.byteLength, 'already-present');
    const client = new LocalCasBrowserClient({
      fetch: async () => jsonResponse(replay, 200, cid),
    });

    await expect(client.put(bytes, cid)).resolves.toEqual(replay);
  });

  it('rejects an input CID mismatch before making a request', async () => {
    const fetcher = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
    const client = new LocalCasBrowserClient({ fetch: fetcher });

    await expect(client.put(bytes, await getContentCid(new Uint8Array([1])))).rejects.toMatchObject(
      {
        code: 'invalid-input',
      },
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'status/outcome mismatch',
      response: async (cid: string) =>
        jsonResponse(resultFor(cid, bytes.byteLength, 'already-present'), 201, cid),
    },
    {
      name: 'ETag mismatch',
      response: async (cid: string) =>
        jsonResponse(resultFor(cid, bytes.byteLength, 'stored'), 201, `${cid.slice(0, -1)}a`),
    },
    {
      name: 'receipt CID mismatch',
      response: async (cid: string) => {
        const otherCid = await getContentCid(new Uint8Array([2]));
        return jsonResponse(resultFor(otherCid, bytes.byteLength, 'stored'), 201, cid);
      },
    },
    {
      name: 'extra receipt field',
      response: async (cid: string) =>
        jsonResponse(
          {
            ...resultFor(cid, bytes.byteLength, 'stored'),
            receipt: {
              ...resultFor(cid, bytes.byteLength, 'stored').receipt,
              privateKey: 'not accepted',
            },
          },
          201,
          cid,
        ),
    },
    {
      name: 'response length mismatch',
      response: async (cid: string) => {
        const response = jsonResponse(resultFor(cid, bytes.byteLength, 'stored'), 201, cid);
        response.headers.set('content-length', '1');
        return response;
      },
    },
  ])('rejects an inconsistent $name response', async ({ response }) => {
    const cid = await getContentCid(bytes);
    const client = new LocalCasBrowserClient({ fetch: async () => response(cid) });

    await expect(client.put(bytes, cid)).rejects.toBeInstanceOf(LocalCasBrowserClientError);
    await expect(client.put(bytes, cid)).rejects.toMatchObject({
      code: 'invalid-response',
    });
  });

  it('bounds streamed JSON before parsing it', async () => {
    const cid = await getContentCid(bytes);
    const client = new LocalCasBrowserClient({
      fetch: async () =>
        new Response(JSON.stringify({ padding: 'x'.repeat(1000) }), {
          headers: { 'content-type': 'application/json' },
          status: 201,
        }),
      maximumResponseBytes: 64,
    });

    await expect(client.put(bytes, cid)).rejects.toMatchObject({
      code: 'response-too-large',
    });
  });

  it('surfaces bounded gateway failures without accepting them as receipts', async () => {
    const cid = await getContentCid(bytes);
    const client = new LocalCasBrowserClient({
      fetch: async () =>
        Response.json(
          {
            error: {
              code: 'local-cas-disabled',
              message: 'The localnet content write boundary is unavailable.',
            },
          },
          { status: 503 },
        ),
    });

    await expect(client.put(bytes, cid)).rejects.toMatchObject({
      code: 'gateway-rejected',
      message: 'The localnet content write boundary is unavailable.',
      status: 503,
    });
  });

  it('rejects absolute or protocol-relative endpoint overrides', () => {
    for (const endpoint of ['https://wetdrool.com/api/localnet/cas', '//remote.example/cas']) {
      expect(() => new LocalCasBrowserClient({ endpoint })).toThrow(LocalCasBrowserClientError);
    }
  });
});

function resultFor(
  cid: string,
  byteLength: number,
  outcome: LocalCasWriteResult['outcome'],
): LocalCasWriteResult {
  return {
    outcome,
    receipt: {
      byteLength,
      cid,
      locator: `local://${cid}`,
      policy: { permanence: 'deletion-compatible' },
      provider: 'local-filesystem',
      providerVersion: '1',
      schema: 'wetdrool.local-cas-receipt.v1',
      verified: true,
    },
  };
}

function jsonResponse(value: unknown, status: number, etag: string): Response {
  return Response.json(value, {
    headers: { etag: `"${etag}"` },
    status,
  });
}
