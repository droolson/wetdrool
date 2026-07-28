import { getContentCid, verifyContentCid } from '@socially-woke/protocol';

import {
  type ContentAddressedStorage,
  type StorageHealth,
  type StoragePolicy,
  type StorageReceipt,
  StorageError,
} from './types.js';

export class MemoryContentAddressedStorage implements ContentAddressedStorage {
  readonly name = 'memory';
  readonly version = '1';

  readonly #objects = new Map<string, Uint8Array>();

  constructor(private readonly clock: () => Date = () => new Date()) {}

  async put(bytes: Uint8Array, policy: StoragePolicy): Promise<StorageReceipt> {
    if (policy.permanence === 'permanent' && policy.consentId === undefined) {
      throw new StorageError(
        'Permanent publication requires a recorded consent identifier.',
        'permanence-consent-required',
      );
    }
    const cid = await getContentCid(bytes);
    this.#objects.set(cid, bytes.slice());
    return {
      cid,
      provider: this.name,
      providerVersion: this.version,
      locator: `memory:${cid}`,
      byteLength: bytes.byteLength,
      publishedAt: this.clock().toISOString(),
      policy,
      verified: true,
    };
  }

  async get(cid: string): Promise<Uint8Array> {
    const bytes = this.#objects.get(cid);
    if (bytes === undefined) {
      throw new StorageError(`Content ${cid} was not found.`, 'not-found');
    }
    if (!(await verifyContentCid(bytes, cid))) {
      throw new StorageError(`Content ${cid} failed integrity verification.`, 'integrity-failure');
    }
    return bytes.slice();
  }

  async has(cid: string): Promise<boolean> {
    const bytes = this.#objects.get(cid);
    return bytes !== undefined && verifyContentCid(bytes, cid);
  }

  async delete(cid: string): Promise<boolean> {
    return this.#objects.delete(cid);
  }

  async health(): Promise<StorageHealth> {
    return {
      provider: this.name,
      ok: true,
      checkedAt: this.clock().toISOString(),
    };
  }
}
