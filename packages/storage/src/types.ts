export type StoragePermanence = 'deletion-compatible' | 'provider-dependent' | 'permanent';

export interface StoragePolicy {
  readonly permanence: StoragePermanence;
  readonly consentId?: string;
}

export interface StorageReceipt {
  readonly cid: string;
  readonly provider: string;
  readonly providerVersion: string;
  readonly locator: string;
  readonly byteLength: number;
  readonly publishedAt: string;
  readonly policy: StoragePolicy;
  readonly verified: true;
}

export interface StorageHealth {
  readonly provider: string;
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly detail?: string;
}

export interface ContentAddressedStorage {
  readonly name: string;
  readonly version: string;
  put(bytes: Uint8Array, policy: StoragePolicy): Promise<StorageReceipt>;
  get(cid: string): Promise<Uint8Array>;
  has(cid: string): Promise<boolean>;
  delete(cid: string): Promise<boolean>;
  health(): Promise<StorageHealth>;
}

export class StorageError extends Error {
  override readonly name = 'StorageError';

  constructor(
    message: string,
    readonly code:
      | 'invalid-cid'
      | 'not-found'
      | 'integrity-failure'
      | 'size-limit'
      | 'provider-failure'
      | 'replication-failure'
      | 'permanence-consent-required',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
