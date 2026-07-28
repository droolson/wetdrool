import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { IpfsHttpStorage } from '../src/index.js';

const apiUrl = process.env['IPFS_INTEGRATION_API_URL'] ?? 'http://127.0.0.1:5001';
const gatewayUrl = process.env['IPFS_INTEGRATION_GATEWAY_URL'] ?? 'http://127.0.0.1:8080';

describe('Kubo/IPFS HTTP storage integration', () => {
  it('publishes, verifies, retrieves, and unpins a unique object', async () => {
    const storage = new IpfsHttpStorage({
      apiUrl,
      gateways: [gatewayUrl],
      requestTimeoutMilliseconds: 15_000,
    });
    const bytes = new TextEncoder().encode(`wokesocial-ipfs-integration:${randomUUID()}`);
    let publishedCid: string | undefined;

    try {
      await expect(storage.health()).resolves.toMatchObject({
        provider: 'ipfs-http',
        ok: true,
      });

      const receipt = await storage.put(bytes, {
        permanence: 'provider-dependent',
      });
      publishedCid = receipt.cid;

      expect(receipt).toMatchObject({
        provider: 'ipfs-http',
        providerVersion: '1',
        locator: `ipfs://${receipt.cid}`,
        byteLength: bytes.byteLength,
        verified: true,
      });
      await expect(storage.has(receipt.cid)).resolves.toBe(true);
      await expect(storage.get(receipt.cid)).resolves.toEqual(bytes);
    } finally {
      if (publishedCid !== undefined) {
        await expect(storage.delete(publishedCid)).resolves.toBe(true);
      }
    }
  }, 30_000);
});
