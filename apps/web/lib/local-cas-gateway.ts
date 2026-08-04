import { isCanonicalRawSha256Cid, verifyContentCid, verifyEnvelope } from '@wetdrool/protocol';
import {
  LocalContentAddressedStorage,
  type ContentAddressedStorage,
  type StorageReceipt,
} from '@wetdrool/storage';

import { LOCAL_CAS_RECEIPT_SCHEMA, type LocalCasWriteResult } from './local-cas-contract';
import type { LocalCasConfig } from './local-cas-config';

const DELETION_COMPATIBLE_POLICY = {
  permanence: 'deletion-compatible',
} as const;

export class LocalCasGatewayError extends Error {
  override readonly name = 'LocalCasGatewayError';

  constructor(
    message: string,
    readonly code:
      'cid-mismatch' | 'integrity-failure' | 'invalid-cid' | 'invalid-envelope' | 'storage-failure',
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export type LocalCasStorageFactory = (config: LocalCasConfig) => ContentAddressedStorage;

export const createLocalCasStorage: LocalCasStorageFactory = (config) =>
  new LocalContentAddressedStorage({
    maximumObjectBytes: config.maximumObjectBytes,
    rootDirectory: config.rootDirectory,
  });

export class LocalCasGateway {
  constructor(
    private readonly storage: ContentAddressedStorage,
    private readonly maximumObjectBytes: number,
  ) {}

  async put(bytes: Uint8Array, expectedCid: string): Promise<LocalCasWriteResult> {
    if (!isCanonicalRawSha256Cid(expectedCid)) {
      throw new LocalCasGatewayError(
        'The expected CID is not a canonical raw SHA-256 CID.',
        'invalid-cid',
      );
    }
    if (bytes.byteLength === 0 || bytes.byteLength > this.maximumObjectBytes) {
      throw new LocalCasGatewayError(
        'The object byte length is outside the configured local CAS boundary.',
        'storage-failure',
      );
    }

    let computedCid: string;
    try {
      computedCid = (await verifyEnvelope(bytes)).cid;
    } catch (error) {
      throw new LocalCasGatewayError(
        'The submitted bytes are not a valid canonical signed envelope.',
        'invalid-envelope',
        { cause: error },
      );
    }
    if (computedCid !== expectedCid) {
      throw new LocalCasGatewayError(
        'The expected CID does not match the submitted bytes.',
        'cid-mismatch',
      );
    }

    let alreadyPresent: boolean;
    try {
      alreadyPresent = await this.storage.has(computedCid);
      if (!alreadyPresent) {
        const storedReceipt = await this.storage.put(bytes, DELETION_COMPATIBLE_POLICY);
        assertStorageReceipt(storedReceipt, computedCid, bytes.byteLength);
      }

      const storedBytes = await this.storage.get(computedCid);
      if (!equalBytes(bytes, storedBytes) || !(await verifyContentCid(storedBytes, computedCid))) {
        throw new LocalCasGatewayError(
          'The stored object did not pass exact-byte CID verification.',
          'integrity-failure',
        );
      }
    } catch (error) {
      if (error instanceof LocalCasGatewayError) {
        throw error;
      }
      throw new LocalCasGatewayError(
        'The local content store could not verify the submitted object.',
        'storage-failure',
        { cause: error },
      );
    }

    return {
      outcome: alreadyPresent ? 'already-present' : 'stored',
      receipt: {
        byteLength: bytes.byteLength,
        cid: computedCid,
        locator: `local://${computedCid}`,
        policy: DELETION_COMPATIBLE_POLICY,
        provider: 'local-filesystem',
        providerVersion: '1',
        schema: LOCAL_CAS_RECEIPT_SCHEMA,
        verified: true,
      },
    };
  }
}

export type { LocalCasReceipt, LocalCasWriteResult } from './local-cas-contract';

function assertStorageReceipt(
  receipt: StorageReceipt,
  expectedCid: string,
  expectedByteLength: number,
): void {
  if (
    receipt.cid !== expectedCid ||
    receipt.locator !== `local://${expectedCid}` ||
    receipt.byteLength !== expectedByteLength ||
    receipt.provider !== 'local-filesystem' ||
    receipt.providerVersion !== '1' ||
    receipt.policy.permanence !== 'deletion-compatible' ||
    receipt.verified !== true
  ) {
    throw new LocalCasGatewayError(
      'The local storage provider returned an inconsistent receipt.',
      'integrity-failure',
    );
  }
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}
