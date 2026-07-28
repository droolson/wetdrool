import { getContentCid } from '@socially-woke/protocol';
import { describe, expect, it, vi } from 'vitest';

import { IpfsHttpStorage, StorageError } from '../src/index.js';

describe('IPFS HTTP boundary', () => {
  it('rejects credential-bearing and ambiguous configured endpoints', () => {
    expect(
      () =>
        new IpfsHttpStorage({
          apiUrl: 'https://name:secret@ipfs.example',
          gateways: ['https://gateway.example'],
        }),
    ).toThrow(/credentials/);
    expect(
      () =>
        new IpfsHttpStorage({
          apiUrl: 'https://ipfs.example',
          gateways: ['https://gateway.example/?token=secret'],
        }),
    ).toThrow(/queries/);
  });

  it('verifies streamed bytes and refuses provider redirects', async () => {
    const bytes = new TextEncoder().encode('bounded IPFS object');
    const cid = await getContentCid(bytes);
    const request = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(bytes, {
        headers: { 'content-length': String(bytes.byteLength) },
        status: 200,
      }),
    );
    const storage = new IpfsHttpStorage({
      apiUrl: 'https://api.example',
      gateways: ['https://gateway.example'],
      fetch: request,
    });

    await expect(storage.get(cid)).resolves.toEqual(bytes);
    expect(request).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ redirect: 'error' }),
    );
  });

  it('cancels a chunked response as soon as the byte limit is exceeded', async () => {
    const expected = new TextEncoder().encode('expected object');
    const cid = await getContentCid(expected);
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Uint8Array.from([1, 2, 3]));
        controller.enqueue(Uint8Array.from([4, 5, 6]));
        controller.close();
      },
    });
    const storage = new IpfsHttpStorage({
      apiUrl: 'https://api.example',
      gateways: ['https://gateway.example'],
      maximumObjectBytes: 4,
      fetch: vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(oversized)),
    });

    await expect(storage.get(cid)).rejects.toEqual(
      expect.objectContaining({
        name: StorageError.name,
        message: expect.stringContaining('exceeds the 4-byte read limit'),
      }),
    );
  });
});
