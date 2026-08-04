import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { getContentCid, mediaManifestContentSchema } from '@wetdrool/protocol';
import {
  MemoryContentAddressedStorage,
  MultiProviderStorage,
  type ContentAddressedStorage,
  type StorageHealth,
  type StorageReceipt,
} from '@wetdrool/storage';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { digestBytes } from '../src/digests.js';
import { MediaWorkerService } from '../src/service.js';
import {
  buildTestService,
  createTestRoot,
  fixedNow,
  PassingScanner,
  pngFixture,
  RejectingScanner,
  removeTestRoot,
  uploadAll,
  uploadDeclaration,
} from './fixtures.js';
import type { MalwareScanner, ScannerResult } from '../src/types.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTestRoot));
});

async function root(): Promise<string> {
  const value = await createTestRoot();
  roots.push(value);
  return value;
}

describe('MediaWorkerService', () => {
  it('is locked by default and never treats an unavailable scanner as passed', async () => {
    const testRoot = await root();
    const service = new MediaWorkerService({
      stagingRoot: join(testRoot, 'staging'),
      temporaryRoot: join(testRoot, 'temporary'),
      storage: new MemoryContentAddressedStorage(),
      clock: () => fixedNow,
    });
    const bytes = await pngFixture();
    const id = await uploadAll(service, bytes);

    await expect(service.finalize(id)).rejects.toMatchObject({ code: 'scanner-unavailable' });
    expect((await service.getUpload(id)).state).toBe('ready');
    expect((await service.readiness()).scanner).toEqual({
      name: 'unavailable',
      available: false,
    });
  });

  it('publishes independently preprocessed bytes unchanged with an unsigned valid manifest', async () => {
    const testRoot = await root();
    const storage = new MemoryContentAddressedStorage(() => fixedNow);
    const service = buildTestService(testRoot, { storage });
    const bytes = await pngFixture();
    const id = await uploadAll(service, bytes);
    const result = await service.finalize(id);

    expect(result).toMatchObject({
      uploadId: id,
      unsigned: true,
      clientMustSign: true,
      source: {
        sha256: digestBytes(bytes),
        declaredMediaType: 'image/png',
        detectedMediaType: 'image/png',
      },
      scan: { status: 'passed', scanner: 'test-scanner' },
      manifestContent: {
        metadataStripped: true,
        malwareScan: { status: 'passed' },
      },
    });
    expect(mediaManifestContentSchema.parse(result.manifestContent)).toEqual(
      result.manifestContent,
    );
    expect(result.publications).toHaveLength(1);
    expect(await storage.get(result.manifestContent.original.cid)).toEqual(bytes);
    expect((await service.getUpload(id)).state).toBe('completed');
    await expect(service.store.dataPath(id)).toBeTypeOf('string');
    expect(await service.finalize(id)).toEqual(result);
  });

  it('managed images are metadata-stripped and include a published thumbnail', async () => {
    const testRoot = await root();
    const storage = new MemoryContentAddressedStorage(() => fixedNow);
    const service = buildTestService(testRoot, { storage });
    const bytes = await pngFixture(1_400, 900);
    const id = await uploadAll(service, bytes, {
      processingMode: 'managed',
      metadataStripped: undefined,
    });
    const result = await service.finalize(id);

    expect(result.manifestContent.original).toMatchObject({
      mediaType: 'image/png',
      width: 1_400,
      height: 900,
    });
    expect(result.manifestContent.variants.map((variant) => variant.purpose)).toEqual([
      'thumbnail',
      'responsive',
      'responsive',
    ]);
    for (const publication of result.publications) {
      expect(publication.receipts).toHaveLength(1);
      expect(publication.replication).toBe('satisfied');
      expect(await storage.has(publication.cid)).toBe(true);
    }
  });

  it('rejects whole-file digest and declared-versus-detected MIME mismatches', async () => {
    const bytes = await pngFixture();
    const wrongDigestService = buildTestService(await root());
    const wrong = await wrongDigestService.createUpload({
      ...uploadDeclaration(bytes),
      sha256: digestBytes(new Uint8Array(bytes.byteLength)),
    });
    await wrongDigestService.appendChunk(wrong.id, 0, bytes, digestBytes(bytes));
    await expect(wrongDigestService.finalize(wrong.id)).rejects.toMatchObject({
      code: 'total-hash-mismatch',
    });

    const mimeService = buildTestService(await root());
    const mimeId = await uploadAll(mimeService, bytes, { declaredMediaType: 'image/jpeg' });
    await expect(mimeService.finalize(mimeId)).rejects.toMatchObject({
      code: 'invalid-media',
    });
  });

  it('does not process or publish scanner-rejected bytes', async () => {
    const testRoot = await root();
    const storage = new MemoryContentAddressedStorage();
    const service = buildTestService(testRoot, {
      scanner: new RejectingScanner(),
      storage,
    });
    const bytes = await pngFixture();
    const id = await uploadAll(service, bytes);
    await expect(service.finalize(id)).rejects.toMatchObject({ code: 'malware-detected' });
    expect((await service.getUpload(id)).failureCode).toBe('malware-detected');
  });

  it('bounds scanner wait time and rejects uploads that expire before finalization', async () => {
    const timeoutRoot = await root();
    const hangingScanner = new HangingScanner();
    const timeoutService = new MediaWorkerService({
      stagingRoot: join(timeoutRoot, 'staging'),
      temporaryRoot: join(timeoutRoot, 'temporary'),
      storage: new MemoryContentAddressedStorage(),
      scanner: hangingScanner,
      scanTimeoutMilliseconds: 5,
      clock: () => fixedNow,
    });
    const bytes = await pngFixture();
    await expect(
      timeoutService.finalize(await uploadAll(timeoutService, bytes)),
    ).rejects.toMatchObject({ code: 'scanner-unavailable' });
    expect(hangingScanner.signal?.aborted).toBe(true);

    let now = fixedNow;
    const expiredService = buildTestService(await root(), {
      clock: () => now,
      uploadTtlMilliseconds: 10,
    });
    const expiredId = await uploadAll(expiredService, bytes);
    now = new Date(fixedNow.getTime() + 11);
    await expect(expiredService.finalize(expiredId)).rejects.toMatchObject({ code: 'expired' });
  });

  it('fails fast when bounded finalization capacity is exhausted', async () => {
    const testRoot = await root();
    const scanner = new BlockingScanner();
    const service = new MediaWorkerService({
      stagingRoot: join(testRoot, 'staging'),
      temporaryRoot: join(testRoot, 'temporary'),
      storage: new MemoryContentAddressedStorage(() => fixedNow),
      scanner,
      maximumConcurrentFinalizations: 1,
      clock: () => fixedNow,
    });
    const bytes = await pngFixture();
    const firstId = await uploadAll(service, bytes);
    const secondId = await uploadAll(service, bytes);
    const first = service.finalize(firstId);
    await scanner.started;

    await expect(service.finalize(secondId)).rejects.toMatchObject({ code: 'worker-busy' });
    expect((await service.getUpload(secondId)).state).toBe('ready');
    let cancellationSettled = false;
    const cancellation = service.cancelUpload(firstId).then(
      () => {
        cancellationSettled = true;
        return { status: 'fulfilled' as const };
      },
      (error: unknown) => {
        cancellationSettled = true;
        return { status: 'rejected' as const, error };
      },
    );
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(cancellationSettled).toBe(false);
    scanner.complete();
    await expect(first).resolves.toMatchObject({ uploadId: firstId });
    await expect(cancellation).resolves.toMatchObject({
      status: 'rejected',
      error: expect.objectContaining({ code: 'conflict' }),
    });
  });

  it('retains partial replication failures when the configured quorum succeeds', async () => {
    const testRoot = await root();
    const storage = new MultiProviderStorage({
      providers: [new MemoryContentAddressedStorage(() => fixedNow), new FailingStorage()],
      minimumReplicas: 1,
    });
    const service = new MediaWorkerService({
      stagingRoot: join(testRoot, 'staging'),
      temporaryRoot: join(testRoot, 'temporary'),
      storage,
      scanner: new PassingScanner(),
      clock: () => fixedNow,
    });
    const bytes = await pngFixture();
    const result = await service.finalize(await uploadAll(service, bytes));
    expect(result.publications[0]).toMatchObject({
      replication: 'degraded',
      failures: [{ provider: 'failure-test', message: 'Provider publication failed.' }],
    });
  });

  it('validates preprocessed assertions and accessibility metadata at creation time', async () => {
    const service = buildTestService(await root());
    const bytes = await pngFixture();
    expect(() =>
      service.createUpload(uploadDeclaration(bytes, { metadataStripped: undefined })),
    ).toThrow();
    expect(() =>
      service.createUpload(
        uploadDeclaration(bytes, {
          altText: undefined,
          caption: undefined,
        }),
      ),
    ).toThrow();
    expect(() =>
      service.createUpload(uploadDeclaration(bytes, { declaredMediaType: 'image/svg+xml' })),
    ).toThrow(expect.objectContaining({ code: 'unsupported-media' }));

    expect(() =>
      service.createUpload(
        uploadDeclaration(bytes, {
          altText: '😀'.repeat(501),
        }),
      ),
    ).toThrow();
    expect(() =>
      service.createUpload(
        uploadDeclaration(bytes, {
          caption: '😀'.repeat(1_001),
        }),
      ),
    ).toThrow();
    await expect(
      service.createUpload(
        uploadDeclaration(bytes, {
          altText: '😀'.repeat(500),
        }),
      ),
    ).resolves.toMatchObject({ altText: '😀'.repeat(500) });
  });

  it('keeps a durable completion terminal when staged-byte cleanup fails', async () => {
    const testRoot = await root();
    const storage = new MemoryContentAddressedStorage(() => fixedNow);
    const service = buildTestService(testRoot, { storage });
    const bytes = await pngFixture();
    const id = await uploadAll(service, bytes);
    const publication = vi.spyOn(storage, 'put');
    vi.spyOn(service.store, 'removeStagedBytes').mockRejectedValueOnce(
      new Error('simulated cleanup failure'),
    );

    await expect(service.finalize(id)).rejects.toMatchObject({ code: 'cleanup-failed' });
    expect(await service.getUpload(id)).toMatchObject({ state: 'completed' });
    const retried = await service.finalize(id);
    expect(retried.uploadId).toBe(id);
    expect(publication).toHaveBeenCalledTimes(1);
    await expect(access(service.store.dataPath(id))).rejects.toBeDefined();
  });

  it('recovers a persisted in-progress finalization after a single-node restart', async () => {
    const service = buildTestService(await root());
    const bytes = await pngFixture();
    const id = await uploadAll(service, bytes);
    await service.store.update(id, {
      state: 'processing',
      failureCode: 'simulated-process-exit',
    });

    await expect(service.finalize(id)).resolves.toMatchObject({ uploadId: id });
    const completed = await service.getUpload(id);
    expect(completed.state).toBe('completed');
    expect(completed.failureCode).toBeUndefined();
  });

  it('detects staged-byte mutation after scanning and rejects substituted storage CIDs', async () => {
    const bytes = await pngFixture();
    const mutationService = buildTestService(await root(), {
      scanner: new MutatingScanner(),
    });
    const mutationId = await uploadAll(mutationService, bytes);
    await expect(mutationService.finalize(mutationId)).rejects.toMatchObject({
      code: 'total-hash-mismatch',
    });
    expect((await mutationService.getUpload(mutationId)).state).toBe('ready');

    const substitutionService = new MediaWorkerService({
      stagingRoot: join(await root(), 'staging'),
      temporaryRoot: join(await root(), 'temporary'),
      storage: new SubstitutingStorage(),
      scanner: new PassingScanner(),
      clock: () => fixedNow,
    });
    const substitutionId = await uploadAll(substitutionService, bytes);
    await expect(substitutionService.finalize(substitutionId)).rejects.toMatchObject({
      code: 'storage-unavailable',
    });
    expect((await substitutionService.getUpload(substitutionId)).state).toBe('ready');
  });

  it('rejects truncated and trailing-byte preprocessed image containers', async () => {
    const service = buildTestService(await root());
    const validPng = await pngFixture();
    const corruptPng = validPng.slice(0, Math.floor(validPng.byteLength / 2));
    const id = await uploadAll(service, corruptPng);
    await expect(service.finalize(id)).rejects.toMatchObject({ code: 'invalid-media' });

    const polyglot = new Uint8Array([
      ...validPng,
      ...new TextEncoder().encode('<script>trailing payload</script>'),
    ]);
    const polyglotId = await uploadAll(service, polyglot);
    await expect(service.finalize(polyglotId)).rejects.toMatchObject({
      code: 'invalid-media',
    });
  });
});

class FailingStorage implements ContentAddressedStorage {
  readonly name = 'failure-test';
  readonly version = '1';

  put(): Promise<StorageReceipt> {
    return Promise.reject(new Error('intentional provider failure'));
  }

  get(): Promise<Uint8Array> {
    return Promise.reject(new Error('intentional provider failure'));
  }

  has(): Promise<boolean> {
    return Promise.resolve(false);
  }

  delete(): Promise<boolean> {
    return Promise.resolve(false);
  }

  health(): Promise<StorageHealth> {
    return Promise.resolve({
      provider: this.name,
      ok: false,
      checkedAt: fixedNow.toISOString(),
      detail: 'intentional provider failure',
    });
  }
}

class HangingScanner implements MalwareScanner {
  readonly name = 'hanging-test';
  readonly available = true;
  signal: AbortSignal | undefined;

  scan(input: { readonly signal: AbortSignal }): Promise<ScannerResult> {
    this.signal = input.signal;
    return new Promise(() => undefined);
  }
}

class BlockingScanner implements MalwareScanner {
  readonly name = 'blocking-test';
  readonly available = true;
  readonly started: Promise<void>;
  readonly #result: Promise<ScannerResult>;
  #resolveStarted = (): void => undefined;
  #resolveResult = (result: ScannerResult): void => {
    void result;
  };

  constructor() {
    this.started = new Promise((resolve) => {
      this.#resolveStarted = resolve;
    });
    this.#result = new Promise((resolve) => {
      this.#resolveResult = resolve;
    });
  }

  scan(): Promise<ScannerResult> {
    this.#resolveStarted();
    return this.#result;
  }

  complete(): void {
    this.#resolveResult({
      status: 'passed',
      scanner: this.name,
      scannerVersion: '1',
      checkedAt: fixedNow.toISOString(),
    });
  }
}

class MutatingScanner implements MalwareScanner {
  readonly name = 'mutating-test';
  readonly available = true;

  async scan(input: {
    readonly path: string;
    readonly byteLength: number;
  }): Promise<ScannerResult> {
    await writeFile(input.path, new Uint8Array(input.byteLength).fill(0x41));
    return {
      status: 'passed',
      scanner: this.name,
      scannerVersion: '1',
      checkedAt: fixedNow.toISOString(),
    };
  }
}

class SubstitutingStorage implements ContentAddressedStorage {
  readonly name = 'substitution-test';
  readonly version = '1';

  async put(
    _bytes: Uint8Array,
    policy: Parameters<ContentAddressedStorage['put']>[1],
  ): Promise<StorageReceipt> {
    const cid = await getContentCid(new Uint8Array([0x00]));
    return {
      cid,
      provider: this.name,
      providerVersion: this.version,
      locator: `substitution:${cid}`,
      byteLength: 1,
      publishedAt: fixedNow.toISOString(),
      policy,
      verified: true,
    };
  }

  get(): Promise<Uint8Array> {
    return Promise.reject(new Error('not implemented'));
  }

  has(): Promise<boolean> {
    return Promise.resolve(false);
  }

  delete(): Promise<boolean> {
    return Promise.resolve(false);
  }

  health(): Promise<StorageHealth> {
    return Promise.resolve({
      provider: this.name,
      ok: true,
      checkedAt: fixedNow.toISOString(),
    });
  }
}
