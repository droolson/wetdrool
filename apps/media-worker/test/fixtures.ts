import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MemoryContentAddressedStorage } from '@wokesocial/storage';
import sharp from 'sharp';

import { digestBytes } from '../src/digests.js';
import type { UploadCreateInput } from '../src/schemas.js';
import { MediaWorkerService } from '../src/service.js';
import type { MalwareScanner, ScannerResult } from '../src/types.js';

export const fixedNow = new Date('2026-07-28T16:00:00.000Z');

export class PassingScanner implements MalwareScanner {
  readonly name = 'test-scanner';
  readonly available = true;

  async scan(): Promise<ScannerResult> {
    return {
      status: 'passed',
      scanner: this.name,
      scannerVersion: '1.0.0-test',
      checkedAt: fixedNow.toISOString(),
    };
  }
}

export class RejectingScanner implements MalwareScanner {
  readonly name = 'test-scanner';
  readonly available = true;

  async scan(): Promise<ScannerResult> {
    return {
      status: 'failed',
      scanner: this.name,
      scannerVersion: '1.0.0-test',
      checkedAt: fixedNow.toISOString(),
      detail: 'test signature',
    };
  }
}

export async function createTestRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'wokesocial-media-'));
}

export async function removeTestRoot(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}

export function buildTestService(
  root: string,
  options: {
    readonly scanner?: MalwareScanner;
    readonly clock?: () => Date;
    readonly uploadTtlMilliseconds?: number;
    readonly storage?: MemoryContentAddressedStorage;
  } = {},
): MediaWorkerService {
  return new MediaWorkerService({
    stagingRoot: join(root, 'staging'),
    temporaryRoot: join(root, 'temporary'),
    storage: options.storage ?? new MemoryContentAddressedStorage(() => fixedNow),
    scanner: options.scanner ?? new PassingScanner(),
    clock: options.clock ?? (() => fixedNow),
    ...(options.uploadTtlMilliseconds === undefined
      ? {}
      : { uploadTtlMilliseconds: options.uploadTtlMilliseconds }),
  });
}

export async function pngFixture(width = 48, height = 32): Promise<Uint8Array> {
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 225, g: 45, b: 91 },
      },
    })
      .png()
      .toBuffer(),
  );
}

export function uploadDeclaration(
  bytes: Uint8Array,
  overrides: Partial<UploadCreateInput> = {},
): UploadCreateInput {
  return {
    declaredMediaType: 'image/png',
    totalBytes: bytes.byteLength,
    sha256: digestBytes(bytes),
    processingMode: 'preprocessed',
    metadataStripped: true,
    altText: 'A solid pink test image.',
    captions: [],
    storagePolicy: { permanence: 'deletion-compatible' },
    ...overrides,
  };
}

export async function uploadAll(
  service: MediaWorkerService,
  bytes: Uint8Array,
  overrides: Partial<UploadCreateInput> = {},
) {
  const upload = await service.createUpload(uploadDeclaration(bytes, overrides));
  await service.appendChunk(upload.id, 0, bytes, digestBytes(bytes));
  return upload.id;
}
