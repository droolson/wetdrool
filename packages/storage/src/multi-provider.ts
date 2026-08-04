import { isCanonicalRawSha256Cid } from '@wetdrool/protocol';

import {
  type ContentAddressedStorage,
  type StorageHealth,
  type StoragePolicy,
  type StorageReceipt,
  StorageError,
} from './types.js';

export interface MultiProviderOptions {
  readonly providers: readonly ContentAddressedStorage[];
  readonly minimumReplicas?: number;
}

export interface ReplicatedPublication {
  readonly cid: string;
  readonly receipts: readonly StorageReceipt[];
  readonly failures: readonly {
    readonly provider: string;
    readonly message: string;
  }[];
}

export class MultiProviderStorage {
  readonly #providers: readonly ContentAddressedStorage[];
  readonly #minimumReplicas: number;

  constructor(options: MultiProviderOptions) {
    if (options.providers.length === 0) {
      throw new TypeError('At least one storage provider is required.');
    }
    this.#minimumReplicas = options.minimumReplicas ?? 1;
    if (this.#minimumReplicas < 1 || this.#minimumReplicas > options.providers.length) {
      throw new TypeError('minimumReplicas is outside the provider range.');
    }
    this.#providers = [...options.providers];
  }

  async publish(bytes: Uint8Array, policy: StoragePolicy): Promise<ReplicatedPublication> {
    const results = await Promise.allSettled(
      this.#providers.map((provider) => provider.put(bytes, policy)),
    );
    const receipts: StorageReceipt[] = [];
    const failures: { provider: string; message: string }[] = [];

    results.forEach((result, index) => {
      const provider = this.#providers[index];
      if (provider === undefined) {
        throw new RangeError('Storage result has no matching provider.');
      }
      if (result.status === 'fulfilled') {
        if (isCanonicalRawSha256Cid(result.value.cid)) {
          receipts.push(result.value);
        } else {
          failures.push({
            provider: provider.name,
            message: 'Provider returned a noncanonical content CID.',
          });
        }
      } else {
        failures.push({
          provider: provider.name,
          message:
            result.reason instanceof Error ? result.reason.message : 'Unknown provider failure',
        });
      }
    });

    const cids = new Set(receipts.map((receipt) => receipt.cid));
    if (receipts.length < this.#minimumReplicas || cids.size !== 1) {
      throw new StorageError(
        `Publication reached ${receipts.length}/${this.#minimumReplicas} required replicas.`,
        'replication-failure',
      );
    }

    const firstReceipt = receipts[0];
    if (firstReceipt === undefined) {
      throw new StorageError(
        'Publication produced no verified storage receipt.',
        'replication-failure',
      );
    }
    return {
      cid: firstReceipt.cid,
      receipts,
      failures,
    };
  }

  async get(cid: string): Promise<Uint8Array> {
    if (!isCanonicalRawSha256Cid(cid)) {
      throw new StorageError(
        'Only canonical base32 CIDv1 raw SHA-256 identifiers are accepted.',
        'invalid-cid',
      );
    }
    const failures: string[] = [];
    for (const provider of this.#providers) {
      try {
        return await provider.get(cid);
      } catch (error) {
        failures.push(
          `${provider.name}: ${error instanceof Error ? error.message : 'unknown failure'}`,
        );
      }
    }
    throw new StorageError(
      `No provider returned verified content (${failures.join('; ')}).`,
      'not-found',
    );
  }

  health(): Promise<readonly StorageHealth[]> {
    return Promise.all(this.#providers.map((provider) => provider.health()));
  }
}
