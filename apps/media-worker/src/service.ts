import { digestFile } from './digests.js';
import { MediaWorkerError } from './errors.js';
import { assertAllowedDeclaredMediaType, detectAndValidateMediaType } from './mime.js';
import { MediaProcessor } from './processors/index.js';
import { MediaPublisher, type MediaStorage } from './publisher.js';
import {
  maximumChunkBytes,
  publicationResultSchema,
  scannerResultSchema,
  uploadCreateSchema,
  type UploadCreateInput,
} from './schemas.js';
import { UnavailableMalwareScanner } from './scanner.js';
import type {
  MalwareScanner,
  PublicationResult,
  ScannerResult,
  UploadRecord,
  WorkerReadiness,
} from './types.js';
import { UploadStore } from './upload-store.js';

export interface MediaWorkerServiceOptions {
  readonly stagingRoot: string;
  readonly temporaryRoot: string;
  readonly storage: MediaStorage;
  readonly scanner?: MalwareScanner;
  readonly processor?: MediaProcessor;
  readonly clock?: () => Date;
  readonly uploadTtlMilliseconds?: number;
  readonly scanTimeoutMilliseconds?: number;
  readonly maximumConcurrentFinalizations?: number;
}

export class MediaWorkerService {
  readonly store: UploadStore;
  readonly scanner: MalwareScanner;
  readonly processor: MediaProcessor;
  readonly publisher: MediaPublisher;
  readonly #scanTimeoutMilliseconds: number;
  readonly #maximumConcurrentFinalizations: number;
  #activeFinalizations = 0;

  constructor(options: MediaWorkerServiceOptions) {
    this.store = new UploadStore({
      rootDirectory: options.stagingRoot,
      maximumChunkBytes,
      ...(options.uploadTtlMilliseconds === undefined
        ? {}
        : { uploadTtlMilliseconds: options.uploadTtlMilliseconds }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    });
    this.scanner = options.scanner ?? new UnavailableMalwareScanner();
    const scannerName = scannerResultSchema.shape.scanner.safeParse(this.scanner.name);
    if (
      !scannerName.success ||
      scannerName.data !== this.scanner.name ||
      typeof this.scanner.available !== 'boolean'
    ) {
      throw new TypeError('Scanner identity and availability metadata are invalid.');
    }
    this.processor =
      options.processor ?? new MediaProcessor({ temporaryRoot: options.temporaryRoot });
    this.publisher = new MediaPublisher(options.storage);
    this.#scanTimeoutMilliseconds = options.scanTimeoutMilliseconds ?? 60_000;
    this.#maximumConcurrentFinalizations = options.maximumConcurrentFinalizations ?? 2;
    if (
      !Number.isInteger(this.#scanTimeoutMilliseconds) ||
      this.#scanTimeoutMilliseconds < 1 ||
      this.#scanTimeoutMilliseconds > 5 * 60 * 1_000
    ) {
      throw new RangeError('Scan timeout must be between 1ms and 5 minutes.');
    }
    if (
      !Number.isInteger(this.#maximumConcurrentFinalizations) ||
      this.#maximumConcurrentFinalizations < 1 ||
      this.#maximumConcurrentFinalizations > 32
    ) {
      throw new RangeError('Concurrent finalizations must be between 1 and 32.');
    }
  }

  async initialize(): Promise<void> {
    await this.store.initialize();
  }

  createUpload(input: unknown): Promise<UploadRecord> {
    const parsed = uploadCreateSchema.parse(input);
    assertAllowedDeclaredMediaType(parsed.declaredMediaType);
    return this.store.create(parsed as UploadCreateInput);
  }

  getUpload(id: string): Promise<UploadRecord> {
    return this.store.read(id);
  }

  appendChunk(
    id: string,
    offset: number,
    chunk: Uint8Array,
    sha256: string,
  ): Promise<UploadRecord> {
    return this.store.append(id, offset, chunk, sha256);
  }

  cancelUpload(id: string): Promise<UploadRecord> {
    return this.store.cancel(id);
  }

  cleanupExpired(maximumEntries?: number): Promise<number> {
    return this.store.cleanupExpired(maximumEntries);
  }

  finalize(id: string): Promise<PublicationResult> {
    return this.store.withLock(id, async () => {
      let upload = await this.store.read(id);
      if (upload.state === 'completed' && upload.result !== undefined) {
        await this.#removeCompletedStagedBytes(id);
        return upload.result;
      }
      if (upload.state === 'processing' && upload.offset === upload.totalBytes) {
        upload = await this.store.update(id, {
          state: 'ready',
          failureCode: 'interrupted-finalization',
        });
      }
      if (upload.state !== 'ready' || upload.offset !== upload.totalBytes) {
        throw new MediaWorkerError(
          'invalid-state',
          'The upload is not complete and ready for finalization.',
        );
      }
      if (this.store.isExpired(upload)) {
        throw new MediaWorkerError('expired', 'The upload expired before finalization.');
      }
      if (!this.scanner.available) {
        throw new MediaWorkerError(
          'scanner-unavailable',
          'Finalization is locked until a real malware scanner is configured.',
        );
      }
      const releaseCapacity = this.#acquireFinalizationCapacity();
      try {
        await this.store.update(id, { state: 'processing', failureCode: null });
        let result: PublicationResult;
        try {
          const path = this.store.dataPath(id);
          await this.store.assertSafeStagedFile(id);
          const digest = await digestFile(path);
          if (digest !== upload.sha256) {
            throw new MediaWorkerError(
              'total-hash-mismatch',
              'The completed upload SHA-256 digest did not match.',
            );
          }
          const detectedMediaType = await detectAndValidateMediaType(
            path,
            upload.declaredMediaType,
          );
          await this.store.update(id, { detectedMediaType });
          const scan = scannerResultSchema.parse(
            await scanWithTimeout(
              this.scanner,
              {
                path,
                mediaType: detectedMediaType,
                sha256: digest,
                byteLength: upload.totalBytes,
              },
              this.#scanTimeoutMilliseconds,
            ),
          );
          if (scan.scanner !== this.scanner.name) {
            throw new MediaWorkerError(
              'scanner-unavailable',
              'The malware scanner returned evidence for a different scanner identity.',
            );
          }
          assertPassedScan(scan);
          await this.store.assertSafeStagedFile(id);
          if ((await digestFile(path)) !== digest) {
            throw new MediaWorkerError(
              'total-hash-mismatch',
              'The staged upload changed while malware scanning was in progress.',
            );
          }
          const processed = await this.processor.process(
            path,
            detectedMediaType,
            upload.processingMode,
          );
          await this.store.assertSafeStagedFile(id);
          if ((await digestFile(path)) !== digest) {
            throw new MediaWorkerError(
              'total-hash-mismatch',
              'The staged upload changed while media processing was in progress.',
            );
          }
          const published = await this.publisher.publish(processed, {
            ...upload,
            detectedMediaType,
          });
          result = publicationResultSchema.parse({
            uploadId: id,
            unsigned: true,
            clientMustSign: true,
            source: {
              sha256: digest,
              bytes: upload.totalBytes,
              declaredMediaType: upload.declaredMediaType,
              detectedMediaType,
            },
            scan,
            manifestContent: published.manifestContent,
            publications: published.publications,
          }) as PublicationResult;
          await this.store.update(id, {
            state: 'completed',
            detectedMediaType,
            failureCode: null,
            result,
          });
        } catch (error) {
          const failure =
            error instanceof MediaWorkerError
              ? error
              : new MediaWorkerError(
                  'processing-failed',
                  'Media verification, processing, or publication failed.',
                  { cause: error },
                );
          try {
            await this.store.update(id, {
              state: 'ready',
              failureCode: failure.code,
            });
          } catch (rollbackError) {
            throw new MediaWorkerError(
              'persistence-failed',
              'Media finalization failed and its retry state could not be persisted.',
              { cause: new AggregateError([failure, rollbackError]) },
            );
          }
          throw failure;
        }
        await this.#removeCompletedStagedBytes(id);
        return result;
      } finally {
        releaseCapacity();
      }
    });
  }

  async readiness(): Promise<WorkerReadiness> {
    const [scannerAvailable, storage, processors] = await Promise.all([
      scannerIsAvailable(this.scanner),
      this.publisher.health(),
      this.processor.capabilities(),
    ]);
    return {
      ok:
        scannerAvailable &&
        storage.length > 0 &&
        storage.every((health) => health.ok) &&
        processors.workingRoot &&
        processors.sharp &&
        processors.ffmpeg &&
        processors.ffprobe,
      scanner: { name: this.scanner.name, available: scannerAvailable },
      storage,
      processors,
    };
  }

  async #removeCompletedStagedBytes(id: string): Promise<void> {
    try {
      await this.store.removeStagedBytes(id);
    } catch (error) {
      throw new MediaWorkerError(
        'cleanup-failed',
        'Publication completed, but its staged source bytes could not be removed.',
        { cause: error },
      );
    }
  }

  #acquireFinalizationCapacity(): () => void {
    if (this.#activeFinalizations >= this.#maximumConcurrentFinalizations) {
      throw new MediaWorkerError(
        'worker-busy',
        'The media worker is at its configured finalization capacity.',
      );
    }
    this.#activeFinalizations += 1;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.#activeFinalizations -= 1;
      }
    };
  }
}

function assertPassedScan(scan: ScannerResult): void {
  if (scan.status !== 'passed') {
    throw new MediaWorkerError('malware-detected', 'The malware scanner rejected the upload.');
  }
}

async function scannerIsAvailable(scanner: MalwareScanner): Promise<boolean> {
  if (!scanner.available) {
    return false;
  }
  if (scanner.healthCheck === undefined) {
    return true;
  }
  try {
    return await scanner.healthCheck();
  } catch {
    return false;
  }
}

function scanWithTimeout(
  scanner: MalwareScanner,
  input: {
    readonly path: string;
    readonly mediaType: string;
    readonly sha256: string;
    readonly byteLength: number;
  },
  timeoutMilliseconds: number,
): Promise<ScannerResult> {
  const controller = new AbortController();
  const operation = scanner.scan({ ...input, signal: controller.signal });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort(
        new MediaWorkerError(
          'scanner-unavailable',
          `The malware scanner did not respond within ${String(timeoutMilliseconds)}ms.`,
        ),
      );
      reject(
        new MediaWorkerError(
          'scanner-unavailable',
          `The malware scanner did not respond within ${String(timeoutMilliseconds)}ms.`,
        ),
      );
    }, timeoutMilliseconds);
    timer.unref();
    void operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
