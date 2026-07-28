import { randomUUID } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm } from 'node:fs/promises';
import { parse, resolve, sep } from 'node:path';

import { z } from 'zod';

import { digestBytes } from './digests.js';
import { MediaWorkerError } from './errors.js';
import {
  publicationResultSchema,
  uploadCreateSchema,
  uploadIdSchema,
  type UploadCreateInput,
} from './schemas.js';
import type { PublicationResult, UploadRecord, UploadState } from './types.js';

const storedRecordSchema = uploadCreateSchema
  .extend({
    id: uploadIdSchema,
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    offset: z.number().int().nonnegative(),
    state: z.enum(['uploading', 'ready', 'processing', 'completed', 'cancelled']),
    detectedMediaType: z.string().optional(),
    failureCode: z.string().optional(),
    result: publicationResultSchema.optional(),
  })
  .strict()
  .superRefine((record, context) => {
    if (record.offset > record.totalBytes) {
      context.addIssue({
        code: 'custom',
        path: ['offset'],
        message: 'Persisted upload offset exceeds the declared byte length.',
      });
    }
    if (
      ['ready', 'processing', 'completed'].includes(record.state) &&
      record.offset !== record.totalBytes
    ) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Persisted terminal processing state requires a complete upload.',
      });
    }
    if (record.state === 'uploading' && record.offset >= record.totalBytes) {
      context.addIssue({
        code: 'custom',
        path: ['state'],
        message: 'Persisted uploading state must be incomplete.',
      });
    }
    if ((record.state === 'completed') !== (record.result !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Only completed uploads may contain a publication result.',
      });
    }
    if (
      record.result !== undefined &&
      (record.result.uploadId !== record.id ||
        record.result.source.sha256 !== record.sha256 ||
        record.result.source.bytes !== record.totalBytes ||
        record.result.source.declaredMediaType !== record.declaredMediaType ||
        record.result.source.detectedMediaType !== record.detectedMediaType)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['result'],
        message: 'Persisted publication result does not match its upload declaration.',
      });
    }
  });

export interface UploadStoreOptions {
  readonly rootDirectory: string;
  readonly maximumChunkBytes: number;
  readonly uploadTtlMilliseconds?: number;
  readonly clock?: () => Date;
}

export class UploadStore {
  readonly #root: string;
  readonly #maximumChunkBytes: number;
  readonly #uploadTtlMilliseconds: number;
  readonly #clock: () => Date;
  readonly #locks = new Map<string, Promise<void>>();

  constructor(options: UploadStoreOptions) {
    this.#root = resolve(options.rootDirectory);
    if (this.#root === parse(this.#root).root) {
      throw new TypeError('The filesystem root cannot be used as an upload staging root.');
    }
    this.#maximumChunkBytes = options.maximumChunkBytes;
    this.#uploadTtlMilliseconds = options.uploadTtlMilliseconds ?? 24 * 60 * 60 * 1_000;
    if (
      !Number.isInteger(this.#maximumChunkBytes) ||
      this.#maximumChunkBytes < 1 ||
      this.#maximumChunkBytes > 500_000_000
    ) {
      throw new RangeError('Maximum chunk bytes must be between 1 and 500,000,000.');
    }
    if (
      !Number.isInteger(this.#uploadTtlMilliseconds) ||
      this.#uploadTtlMilliseconds < 1 ||
      this.#uploadTtlMilliseconds > 30 * 24 * 60 * 60 * 1_000
    ) {
      throw new RangeError('Upload TTL must be between 1ms and 30 days.');
    }
    this.#clock = options.clock ?? (() => new Date());
  }

  async initialize(): Promise<void> {
    await mkdir(this.#root, { recursive: true, mode: 0o700 });
    const metadata = await lstat(this.#root);
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      !hasPrivateOwnershipAndMode(metadata)
    ) {
      throw new MediaWorkerError(
        'invalid-state',
        'The upload staging root must be a private, service-owned real directory.',
      );
    }
  }

  async create(input: UploadCreateInput): Promise<UploadRecord> {
    await this.initialize();
    const id = randomUUID();
    const now = this.#clock();
    if (!Number.isFinite(now.getTime())) {
      throw new MediaWorkerError('invalid-state', 'The upload clock returned an invalid date.');
    }
    const record: UploadRecord = {
      ...input,
      id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.#uploadTtlMilliseconds).toISOString(),
      offset: 0,
      state: 'uploading',
    };
    const directory = this.#uploadDirectory(id);
    await mkdir(directory, { recursive: false, mode: 0o700 });
    try {
      await this.#assertSafeUploadDirectory(id);
      const part = await open(
        this.dataPath(id),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await part.sync();
      } finally {
        await part.close();
      }
      await this.#save(record);
      return record;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  async read(id: string): Promise<UploadRecord> {
    uploadIdSchema.parse(id);
    let raw: string;
    let handle;
    try {
      await this.#assertSafeUploadDirectory(id);
      handle = await open(this.#metadataPath(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (error instanceof MediaWorkerError) {
        throw error;
      }
      throw new MediaWorkerError('not-found', 'The upload was not found.', { cause: error });
    }
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1 || !hasPrivateOwnershipAndMode(metadata)) {
        throw new MediaWorkerError(
          'invalid-state',
          'Stored upload metadata is not a private regular file.',
        );
      }
      raw = await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new MediaWorkerError('invalid-state', 'Stored upload metadata is not valid JSON.', {
        cause: error,
      });
    }
    const value = storedRecordSchema.safeParse(parsedJson);
    if (!value.success) {
      throw new MediaWorkerError('invalid-state', 'Stored upload metadata is invalid.', {
        cause: value.error,
      });
    }
    const { result, ...record } = value.data;
    return result === undefined ? record : { ...record, result: result as PublicationResult };
  }

  async append(
    id: string,
    expectedOffset: number,
    bytes: Uint8Array,
    expectedDigest: string,
  ): Promise<UploadRecord> {
    if (bytes.byteLength === 0 || bytes.byteLength > this.#maximumChunkBytes) {
      throw new MediaWorkerError(
        'size-limit',
        `Chunks must contain 1–${String(this.#maximumChunkBytes)} bytes.`,
      );
    }
    if (digestBytes(bytes) !== expectedDigest) {
      throw new MediaWorkerError('chunk-hash-mismatch', 'The chunk SHA-256 digest did not match.');
    }
    return this.withLock(id, async () => {
      const record = await this.read(id);
      this.#assertWritable(record);
      if (record.offset !== expectedOffset) {
        throw new MediaWorkerError(
          'conflict',
          `Upload offset conflict; the current offset is ${String(record.offset)}.`,
        );
      }
      if (record.offset + bytes.byteLength > record.totalBytes) {
        throw new MediaWorkerError('size-limit', 'The chunk exceeds the declared upload size.');
      }

      await this.#assertSafeUploadDirectory(id);
      const handle = await this.#openStagedFile(id, constants.O_RDWR);
      try {
        const metadata = await handle.stat();
        if (!metadata.isFile() || metadata.nlink !== 1 || !hasPrivateOwnershipAndMode(metadata)) {
          throw new MediaWorkerError(
            'invalid-state',
            'The staged upload is not a private regular file.',
          );
        }
        if (metadata.size < record.offset) {
          throw new MediaWorkerError(
            'invalid-state',
            'The staged file is shorter than its offset.',
          );
        }
        if (metadata.size > record.offset) {
          await handle.truncate(record.offset);
        }
        await writeAllAtOffset(handle, bytes, record.offset);
        await handle.sync();
      } finally {
        await handle.close();
      }

      const nextOffset = record.offset + bytes.byteLength;
      const updated: UploadRecord = {
        ...record,
        offset: nextOffset,
        state: nextOffset === record.totalBytes ? 'ready' : 'uploading',
        updatedAt: this.#clock().toISOString(),
      };
      await this.#save(updated);
      return updated;
    });
  }

  async update(
    id: string,
    changes: {
      readonly state?: UploadState;
      readonly detectedMediaType?: string;
      readonly failureCode?: string | null;
      readonly result?: PublicationResult;
    },
  ): Promise<UploadRecord> {
    const record = await this.read(id);
    const { failureCode, ...otherChanges } = changes;
    const baseRecord = { ...record };
    if (failureCode === null) {
      delete baseRecord.failureCode;
    }
    const updated: UploadRecord = {
      ...baseRecord,
      ...otherChanges,
      ...(typeof failureCode === 'string' ? { failureCode } : {}),
      updatedAt: this.#clock().toISOString(),
    };
    await this.#save(updated);
    return updated;
  }

  async cancel(id: string): Promise<UploadRecord> {
    return this.withLock(id, async () => {
      const record = await this.read(id);
      if (record.state === 'completed') {
        throw new MediaWorkerError('conflict', 'A completed publication cannot be cancelled.');
      }
      if (record.state === 'cancelled') {
        await this.removeStagedBytes(id);
        return record;
      }
      const updated = await this.update(id, {
        state: 'cancelled',
        failureCode: 'cancelled',
      });
      await this.removeStagedBytes(id);
      return updated;
    });
  }

  async removeStagedBytes(id: string): Promise<void> {
    await this.#assertSafeUploadDirectory(id);
    await rm(this.dataPath(id), { force: true });
  }

  async assertSafeStagedFile(id: string): Promise<void> {
    await this.#assertSafeUploadDirectory(id);
    const handle = await this.#openStagedFile(id, constants.O_RDONLY);
    try {
      const metadata = await handle.stat();
      if (!metadata.isFile() || metadata.nlink !== 1 || !hasPrivateOwnershipAndMode(metadata)) {
        throw new MediaWorkerError(
          'invalid-state',
          'The staged upload is not a private regular file.',
        );
      }
    } finally {
      await handle.close();
    }
  }

  async cleanupExpired(maximumEntries = 100): Promise<number> {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 1_000) {
      throw new RangeError('Cleanup batch size must be between 1 and 1,000.');
    }
    await this.initialize();
    const entries = await readdir(this.#root, { withFileTypes: true });
    let removed = 0;
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (removed >= maximumEntries) {
        break;
      }
      if (!entry.isDirectory()) {
        continue;
      }
      if (!uploadIdSchema.safeParse(entry.name).success) {
        continue;
      }
      try {
        const deleted = await this.withLock(entry.name, async () => {
          const current = await this.read(entry.name);
          if (current.state === 'cancelled' || this.isExpired(current)) {
            await rm(this.#uploadDirectory(entry.name), { recursive: true, force: true });
            return true;
          }
          return false;
        });
        if (deleted) {
          removed += 1;
        }
      } catch (error) {
        if (error instanceof MediaWorkerError && error.code === 'not-found') {
          continue;
        }
        throw error;
      }
    }
    return removed;
  }

  async withLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    uploadIdSchema.parse(id);
    const preceding = this.#locks.get(id) ?? Promise.resolve();
    let release = (): void => undefined;
    const current = new Promise<void>((resolveLock) => {
      release = resolveLock;
    });
    this.#locks.set(id, current);
    await preceding;
    try {
      return await operation();
    } finally {
      release();
      if (this.#locks.get(id) === current) {
        this.#locks.delete(id);
      }
    }
  }

  dataPath(id: string): string {
    return resolve(this.#uploadDirectory(id), 'upload.part');
  }

  isExpired(record: UploadRecord): boolean {
    return Date.parse(record.expiresAt) <= this.#clock().getTime();
  }

  #assertWritable(record: UploadRecord): void {
    if (record.state === 'cancelled') {
      throw new MediaWorkerError('cancelled', 'The upload was cancelled.');
    }
    if (this.isExpired(record)) {
      throw new MediaWorkerError('expired', 'The upload expired.');
    }
    if (record.state !== 'uploading') {
      throw new MediaWorkerError('invalid-state', `Upload state ${record.state} is not writable.`);
    }
  }

  async #save(record: UploadRecord): Promise<void> {
    const validation = storedRecordSchema.safeParse(record);
    if (!validation.success) {
      throw new MediaWorkerError('invalid-state', 'Refusing to persist invalid upload metadata.', {
        cause: validation.error,
      });
    }
    await this.#assertSafeUploadDirectory(record.id);
    const destination = this.#metadataPath(record.id);
    const temporary = resolve(this.#uploadDirectory(record.id), `metadata.${randomUUID()}.tmp`);
    let temporaryExists = false;
    try {
      const handle = await open(
        temporary,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600,
      );
      temporaryExists = true;
      try {
        await handle.writeFile(`${JSON.stringify(validation.data)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, destination);
      temporaryExists = false;
    } finally {
      if (temporaryExists) {
        await rm(temporary, { force: true });
      }
    }
  }

  #metadataPath(id: string): string {
    return resolve(this.#uploadDirectory(id), 'metadata.json');
  }

  #uploadDirectory(id: string): string {
    uploadIdSchema.parse(id);
    const directory = resolve(this.#root, id);
    if (!directory.startsWith(`${this.#root}${sep}`)) {
      throw new MediaWorkerError('invalid-state', 'Upload identifier escaped the staging root.');
    }
    return directory;
  }

  async #assertSafeUploadDirectory(id: string): Promise<void> {
    await this.initialize();
    const metadata = await lstat(this.#uploadDirectory(id));
    if (
      metadata.isSymbolicLink() ||
      !metadata.isDirectory() ||
      !hasPrivateOwnershipAndMode(metadata)
    ) {
      throw new MediaWorkerError(
        'invalid-state',
        'The upload staging entry must be a real directory.',
      );
    }
  }

  async #openStagedFile(id: string, flags: number) {
    try {
      return await open(this.dataPath(id), flags | constants.O_NOFOLLOW);
    } catch (error) {
      throw new MediaWorkerError(
        'invalid-state',
        'The staged upload could not be opened as a private regular file.',
        { cause: error },
      );
    }
  }
}

function hasPrivateOwnershipAndMode(metadata: Stats): boolean {
  if (process.platform === 'win32') {
    return true;
  }
  const currentUser = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return (
    (metadata.mode & 0o077) === 0 && (currentUser === undefined || metadata.uid === currentUser)
  );
}

interface PositionalWriter {
  write(
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesWritten: number }>;
}

export async function writeAllAtOffset(
  handle: PositionalWriter,
  bytes: Uint8Array,
  position: number,
): Promise<void> {
  let committed = 0;
  while (committed < bytes.byteLength) {
    const remaining = bytes.byteLength - committed;
    const { bytesWritten } = await handle.write(bytes, committed, remaining, position + committed);
    if (!Number.isInteger(bytesWritten) || bytesWritten < 1 || bytesWritten > remaining) {
      throw new MediaWorkerError(
        'invalid-state',
        'The staged upload write did not make valid forward progress.',
      );
    }
    committed += bytesWritten;
  }
}
