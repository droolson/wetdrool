import { access, mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import { getContentCid, verifyContentCid } from '@socially-woke/protocol';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';

import {
  type ContentAddressedStorage,
  type StorageHealth,
  type StoragePolicy,
  type StorageReceipt,
  StorageError,
} from './types.js';

export interface LocalStorageOptions {
  readonly rootDirectory: string;
  readonly maximumObjectBytes?: number;
  readonly clock?: () => Date;
}

export class LocalContentAddressedStorage implements ContentAddressedStorage {
  readonly name = 'local-filesystem';
  readonly version = '1';

  readonly #rootDirectory: string;
  readonly #maximumObjectBytes: number;
  readonly #clock: () => Date;

  constructor(options: LocalStorageOptions) {
    this.#rootDirectory = resolve(options.rootDirectory);
    this.#maximumObjectBytes = options.maximumObjectBytes ?? 25_000_000;
    this.#clock = options.clock ?? (() => new Date());
  }

  async put(bytes: Uint8Array, policy: StoragePolicy): Promise<StorageReceipt> {
    this.#assertSize(bytes.byteLength);
    if (policy.permanence === 'permanent' && policy.consentId === undefined) {
      throw new StorageError(
        'Permanent publication requires a recorded consent identifier.',
        'permanence-consent-required',
      );
    }

    const cid = await getContentCid(bytes);
    const destination = this.#objectPath(cid);
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 });

    const temporary = join(dirname(destination), `.${cid}.${randomUUID()}.partial`);
    let temporaryCreated = false;
    try {
      const file = await open(temporary, 'wx', 0o600);
      temporaryCreated = true;
      try {
        await file.writeFile(bytes);
        await file.sync();
      } finally {
        await file.close();
      }

      try {
        await rename(temporary, destination);
        temporaryCreated = false;
      } catch (error) {
        if (await this.has(cid)) {
          await rm(temporary, { force: true });
          temporaryCreated = false;
        } else {
          throw error;
        }
      }
    } catch (error) {
      if (temporaryCreated) {
        await rm(temporary, { force: true });
      }
      throw new StorageError('Local content publication failed.', 'provider-failure', {
        cause: error,
      });
    }

    const stored = await this.get(cid);
    if (!(await verifyContentCid(stored, cid))) {
      throw new StorageError('Stored content failed CID verification.', 'integrity-failure');
    }

    return {
      cid,
      provider: this.name,
      providerVersion: this.version,
      locator: `local-cas:${cid}`,
      byteLength: bytes.byteLength,
      publishedAt: this.#clock().toISOString(),
      policy,
      verified: true,
    };
  }

  async get(cid: string): Promise<Uint8Array> {
    const path = this.#objectPath(cid);
    let metadata;
    try {
      metadata = await stat(path);
    } catch (error) {
      throw new StorageError(`Content ${cid} was not found.`, 'not-found', {
        cause: error,
      });
    }

    this.#assertSize(metadata.size);
    const bytes = new Uint8Array(await readFile(path));
    if (!(await verifyContentCid(bytes, cid))) {
      throw new StorageError(`Content ${cid} failed integrity verification.`, 'integrity-failure');
    }
    return bytes;
  }

  async has(cid: string): Promise<boolean> {
    const path = this.#objectPath(cid);
    try {
      const metadata = await stat(path);
      if (!metadata.isFile() || metadata.size > this.#maximumObjectBytes) {
        return false;
      }
      const bytes = new Uint8Array(await readFile(path));
      return verifyContentCid(bytes, cid);
    } catch {
      return false;
    }
  }

  async delete(cid: string): Promise<boolean> {
    const path = this.#objectPath(cid);
    if (!(await this.has(cid))) {
      return false;
    }
    await rm(path, { force: true });
    return true;
  }

  async health(): Promise<StorageHealth> {
    try {
      await mkdir(this.#rootDirectory, { recursive: true, mode: 0o700 });
      await access(this.#rootDirectory);
      return {
        provider: this.name,
        ok: true,
        checkedAt: this.#clock().toISOString(),
      };
    } catch (error) {
      return {
        provider: this.name,
        ok: false,
        checkedAt: this.#clock().toISOString(),
        detail: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  #objectPath(value: string): string {
    let cid: CID;
    try {
      cid = CID.parse(value);
    } catch (error) {
      throw new StorageError('Invalid content identifier.', 'invalid-cid', {
        cause: error,
      });
    }

    const canonical = cid.toV1().toString();
    if (canonical !== value || cid.code !== raw.code || !/^b[a-z2-7]+$/u.test(canonical)) {
      throw new StorageError(
        'Only canonical base32 CIDv1 raw identifiers are accepted.',
        'invalid-cid',
      );
    }

    const path = resolve(this.#rootDirectory, 'objects', canonical.slice(1, 3), canonical);
    const expectedPrefix = `${this.#rootDirectory}${sep}`;
    if (!path.startsWith(expectedPrefix)) {
      throw new StorageError('Content identifier escaped the storage root.', 'invalid-cid');
    }
    return path;
  }

  #assertSize(byteLength: number): void {
    if (byteLength < 0 || byteLength > this.#maximumObjectBytes) {
      throw new StorageError(
        `Object exceeds the ${this.#maximumObjectBytes}-byte local limit.`,
        'size-limit',
      );
    }
  }
}
