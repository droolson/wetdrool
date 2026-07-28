import { describe, expect, it } from 'vitest';

import {
  ArweavePermanentStorage,
  type PermanentDataUploader,
  type PermanentUploadReceipt,
  type PermanentUploadRequest,
} from '../src/index.js';

const bytes = new TextEncoder().encode('canonical permanent envelope');
const tamperedBytes = new TextEncoder().encode('tampered permanent envelope');
const transactionId = Buffer.alloc(32, 0x5a).toString('base64url');
const confirmedAt = '2026-07-28T15:30:00.000Z';
const consentId = 'consent:permanent:2026-07-28:0001';
const permanentPolicy = { permanence: 'permanent' as const, consentId };

describe('Arweave-compatible permanent storage', () => {
  it('requires explicit permanence consent before invoking an uploader', async () => {
    let uploadCalls = 0;
    const uploader = makeUploader(async (request) => {
      uploadCalls += 1;
      return receiptFor(request);
    });
    const storage = makeStorage({ uploader, gatewayBytes: bytes });

    await expect(storage.put(bytes, { permanence: 'permanent' })).rejects.toMatchObject({
      code: 'permanence-consent-required',
    });
    await expect(
      storage.put(bytes, {
        permanence: 'deletion-compatible',
        consentId,
      }),
    ).rejects.toMatchObject({
      code: 'permanence-consent-required',
    });
    expect(uploadCalls).toBe(0);
  });

  it('uploads, verifies the receipt and read-back, resolves after restart, and never claims deletion', async () => {
    const uploadRequests: PermanentUploadRequest[] = [];
    const uploader = makeUploader(async (request) => {
      uploadRequests.push(request);
      return receiptFor(request);
    });
    const storage = makeStorage({ uploader, gatewayBytes: bytes });

    const receipt = await storage.put(bytes, permanentPolicy);

    expect(uploadRequests).toHaveLength(1);
    expect(uploadRequests[0]).toMatchObject({
      contentCid: receipt.cid,
      contentSha256: receipt.contentSha256,
      byteLength: bytes.byteLength,
      consentId,
    });
    expect(uploadRequests[0]?.tags).toEqual(
      expect.arrayContaining([
        { name: 'Socially-Woke-CID', value: receipt.cid },
        {
          name: 'Socially-Woke-SHA256',
          value: receipt.contentSha256,
        },
      ]),
    );
    expect(receipt).toMatchObject({
      provider: 'arweave-permanent',
      providerVersion: '1',
      locator: `ar://${transactionId}`,
      byteLength: bytes.byteLength,
      publishedAt: confirmedAt,
      policy: permanentPolicy,
      verified: true,
      transactionId,
      uploader: 'contract-test-uploader',
      uploaderVersion: '1',
      confirmation: 'confirmed',
    });
    await expect(storage.get(receipt.cid)).resolves.toEqual(bytes);
    await expect(storage.delete(receipt.cid)).resolves.toBe(false);
    await expect(storage.has(receipt.cid)).resolves.toBe(true);
    await expect(storage.health()).resolves.toEqual({
      provider: 'arweave-permanent',
      ok: true,
      checkedAt: confirmedAt,
    });

    const restarted = makeStorage({
      uploader,
      gatewayBytes: bytes,
      resolveTransactionId: async (cid) => (cid === receipt.cid ? transactionId : undefined),
    });
    await expect(restarted.get(receipt.cid)).resolves.toEqual(bytes);
  });

  it('rejects a tampered or unconfirmed provider receipt before gateway read-back', async () => {
    let gatewayCalls = 0;
    const uploader = makeUploader(async (request) => ({
      ...receiptFor(request),
      contentSha256: `${request.contentSha256}tampered`,
      status: 'pending',
    }));
    const storage = makeStorage({
      uploader,
      gatewayBytes: bytes,
      onGatewayCall: () => {
        gatewayCalls += 1;
      },
    });

    await expect(storage.put(bytes, permanentPolicy)).rejects.toMatchObject({
      code: 'integrity-failure',
    });
    expect(gatewayCalls).toBe(0);
  });

  it('rejects gateway data that does not exactly match the receipt CID and hash', async () => {
    const uploader = makeUploader(async (request) => receiptFor(request));
    const storage = makeStorage({ uploader, gatewayBytes: tamperedBytes });

    await expect(storage.put(bytes, permanentPolicy)).rejects.toMatchObject({
      code: 'integrity-failure',
    });
  });

  it('bounds streamed gateway reads even when content-length is absent', async () => {
    const uploader = makeUploader(async (request) => receiptFor(request));
    const storage = makeStorage({
      uploader,
      gatewayBytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7]),
      includeContentLength: false,
      maximumObjectBytes: 6,
    });
    const smallBytes = new Uint8Array([1, 2, 3, 4, 5]);

    await expect(storage.put(smallBytes, permanentPolicy)).rejects.toMatchObject({
      code: 'size-limit',
    });
  });

  it('turns an uploader timeout into a bounded provider failure', async () => {
    const uploader = makeUploader(
      (request) =>
        new Promise<PermanentUploadReceipt>((_resolve, reject) => {
          request.signal.addEventListener(
            'abort',
            () => {
              reject(request.signal.reason);
            },
            { once: true },
          );
        }),
    );
    const storage = makeStorage({
      uploader,
      gatewayBytes: bytes,
      requestTimeoutMilliseconds: 5,
    });

    await expect(storage.put(bytes, permanentPolicy)).rejects.toMatchObject({
      code: 'provider-failure',
    });
  });

  it('reports gateway errors and uploader health failures truthfully', async () => {
    const uploader = makeUploader(
      async (request) => receiptFor(request),
      async () => ({ ok: false, detail: 'signer unavailable' }),
    );
    const storage = makeStorage({
      uploader,
      gatewayBytes: bytes,
      gatewayStatus: 503,
    });

    await expect(storage.put(bytes, permanentPolicy)).rejects.toMatchObject({
      code: 'provider-failure',
    });
    await expect(storage.health()).resolves.toEqual({
      provider: 'arweave-permanent',
      ok: false,
      checkedAt: confirmedAt,
      detail:
        'uploader contract-test-uploader: signer unavailable; https://arweave.example: HTTP 503',
    });
  });
});

function receiptFor(request: PermanentUploadRequest): PermanentUploadReceipt {
  return {
    transactionId,
    contentCid: request.contentCid,
    contentSha256: request.contentSha256,
    byteLength: request.byteLength,
    consentId: request.consentId,
    status: 'confirmed',
    confirmedAt,
  };
}

function makeUploader(
  upload: PermanentDataUploader['upload'],
  health: PermanentDataUploader['health'] = async () => ({ ok: true }),
): PermanentDataUploader {
  return {
    name: 'contract-test-uploader',
    version: '1',
    upload,
    health,
  };
}

function makeStorage(options: {
  readonly uploader: PermanentDataUploader;
  readonly gatewayBytes: Uint8Array;
  readonly gatewayStatus?: number;
  readonly includeContentLength?: boolean;
  readonly maximumObjectBytes?: number;
  readonly requestTimeoutMilliseconds?: number;
  readonly onGatewayCall?: () => void;
  readonly resolveTransactionId?: (cid: string, signal: AbortSignal) => Promise<string | undefined>;
}): ArweavePermanentStorage {
  const fetcher: typeof globalThis.fetch = async (input) => {
    options.onGatewayCall?.();
    const url =
      input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const status = options.gatewayStatus ?? 200;
    if (url.pathname === '/info') {
      return new Response('{}', {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }

    const headers = new Headers({ 'content-type': 'application/octet-stream' });
    if (options.includeContentLength !== false) {
      headers.set('content-length', String(options.gatewayBytes.byteLength));
    }
    return new Response(Uint8Array.from(options.gatewayBytes).buffer, {
      status,
      headers,
    });
  };

  return new ArweavePermanentStorage({
    uploader: options.uploader,
    gateways: ['https://arweave.example/'],
    ...(options.resolveTransactionId === undefined
      ? {}
      : {
          locatorResolver: {
            resolveTransactionId: options.resolveTransactionId,
          },
        }),
    ...(options.maximumObjectBytes === undefined
      ? {}
      : { maximumObjectBytes: options.maximumObjectBytes }),
    ...(options.requestTimeoutMilliseconds === undefined
      ? {}
      : {
          requestTimeoutMilliseconds: options.requestTimeoutMilliseconds,
        }),
    clock: () => new Date(confirmedAt),
    fetch: fetcher,
  });
}
