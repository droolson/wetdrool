import { parse, resolve } from 'node:path';

import sharp from 'sharp';

import { MediaWorkerError } from '../errors.js';
import { mediaFamily } from '../mime.js';
import { CommandRunner } from '../subprocess.js';
import type { ProcessedMedia, ProcessingMode } from '../types.js';
import { processAudio } from './audio.js';
import { ensurePrivateWorkingRoot, readBoundedFile } from './files.js';
import { processImage } from './image.js';
import {
  assertValidProcessingLimits,
  defaultProcessingLimits,
  type ProcessingLimits,
} from './limits.js';
import { probeMedia } from './probe.js';
import { processVideo } from './video.js';

export interface MediaProcessorOptions {
  readonly temporaryRoot: string;
  readonly runner?: CommandRunner;
  readonly limits?: ProcessingLimits;
}

export class MediaProcessor {
  readonly runner: CommandRunner;
  readonly limits: ProcessingLimits;
  readonly #temporaryRoot: string;

  constructor(options: MediaProcessorOptions) {
    this.#temporaryRoot = resolve(options.temporaryRoot);
    if (this.#temporaryRoot === parse(this.#temporaryRoot).root) {
      throw new TypeError('The filesystem root cannot be used for media temporary files.');
    }
    this.runner = options.runner ?? new CommandRunner();
    this.limits = options.limits ?? defaultProcessingLimits;
    assertValidProcessingLimits(this.limits);
  }

  async process(path: string, mediaType: string, mode: ProcessingMode): Promise<ProcessedMedia> {
    try {
      if (mode === 'preprocessed') {
        return await this.#validatePreprocessed(path, mediaType);
      }
      switch (mediaFamily(mediaType)) {
        case 'image':
          return await processImage(path, mediaType, this.limits);
        case 'video':
          return await processVideo(path, this.#temporaryRoot, this.runner, this.limits);
        case 'audio':
          return await processAudio(path, this.#temporaryRoot, this.runner, this.limits);
      }
    } catch (error) {
      if (error instanceof MediaWorkerError) {
        throw error;
      }
      throw new MediaWorkerError(
        'invalid-media',
        'The uploaded media could not be decoded and validated safely.',
        { cause: error },
      );
    }
  }

  async capabilities(): Promise<{
    readonly workingRoot: boolean;
    readonly sharp: boolean;
    readonly ffmpeg: boolean;
    readonly ffprobe: boolean;
  }> {
    let sharpAvailable = false;
    try {
      await sharp({
        create: { width: 1, height: 1, channels: 3, background: '#000000' },
      })
        .png()
        .toBuffer();
      sharpAvailable = true;
    } catch {
      sharpAvailable = false;
    }
    const [ffmpeg, ffprobe] = await Promise.all([
      this.runner.binaryAvailable('ffmpeg'),
      this.runner.binaryAvailable('ffprobe'),
    ]);
    let workingRoot = false;
    try {
      await ensurePrivateWorkingRoot(this.#temporaryRoot);
      workingRoot = true;
    } catch {
      workingRoot = false;
    }
    return { workingRoot, sharp: sharpAvailable, ffmpeg, ffprobe };
  }

  async #validatePreprocessed(path: string, mediaType: string): Promise<ProcessedMedia> {
    const bytes = await readBoundedFile(path, this.limits.maximumArtifactBytes);
    assertExactContainerBoundary(bytes, mediaType);
    switch (mediaFamily(mediaType)) {
      case 'image': {
        const sharpOptions = {
          failOn: 'warning',
          limitInputPixels: this.limits.maximumDimension * this.limits.maximumDimension,
        } as const;
        const metadata = await sharp(path, sharpOptions).metadata();
        const width = metadata.autoOrient.width;
        const height = metadata.autoOrient.height;
        if (
          width === undefined ||
          height === undefined ||
          (metadata.pages !== undefined && metadata.pages !== 1) ||
          width > this.limits.maximumDimension ||
          height > this.limits.maximumDimension
        ) {
          throw new MediaWorkerError('invalid-media', 'Image dimensions are out of bounds.');
        }
        await sharp(path, sharpOptions).raw().toBuffer();
        return {
          original: { purpose: 'original', bytes, mediaType, width, height },
          variants: [],
          notes: [
            'Bytes were independently preprocessed and published unchanged.',
            'Metadata stripping is a client assertion; the worker validated structure and bounds.',
          ],
        };
      }
      case 'video':
      case 'audio': {
        const probe = await probeMedia(path, this.runner, this.limits);
        if (mediaFamily(mediaType) === 'video' && !probe.hasVideo) {
          throw new MediaWorkerError(
            'invalid-media',
            'The preprocessed video has no video stream.',
          );
        }
        if (mediaFamily(mediaType) === 'audio' && (!probe.hasAudio || probe.hasVideo)) {
          throw new MediaWorkerError('invalid-media', 'The preprocessed audio stream is invalid.');
        }
        const originalBase = {
          purpose: 'original' as const,
          bytes,
          mediaType,
          durationMilliseconds: probe.durationMilliseconds,
        };
        const original =
          probe.width === undefined || probe.height === undefined
            ? originalBase
            : { ...originalBase, width: probe.width, height: probe.height };
        return {
          original,
          variants: [],
          notes: [
            'Bytes were independently preprocessed and published unchanged.',
            'Metadata stripping is a client assertion; the worker validated streams and bounds.',
          ],
        };
      }
    }
  }
}

function assertExactContainerBoundary(bytes: Uint8Array, mediaType: string): void {
  const value = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let exact = true;
  switch (mediaType) {
    case 'image/png':
      exact =
        value.byteLength >= 20 &&
        value
          .subarray(value.byteLength - 12)
          .equals(Buffer.from('0000000049454e44ae426082', 'hex'));
      break;
    case 'image/jpeg':
      exact =
        value.byteLength >= 4 &&
        value[value.byteLength - 2] === 0xff &&
        value[value.byteLength - 1] === 0xd9;
      break;
    case 'image/webp':
      exact =
        value.byteLength >= 12 &&
        value.toString('ascii', 0, 4) === 'RIFF' &&
        value.toString('ascii', 8, 12) === 'WEBP' &&
        value.readUInt32LE(4) + 8 === value.byteLength;
      break;
    case 'image/avif':
    case 'video/mp4':
    case 'audio/mp4':
      exact = hasExactIsoBmffBoundary(value);
      break;
    case 'audio/wav':
      exact =
        value.byteLength >= 12 &&
        value.toString('ascii', 0, 4) === 'RIFF' &&
        value.toString('ascii', 8, 12) === 'WAVE' &&
        value.readUInt32LE(4) + 8 === value.byteLength;
      break;
  }
  if (!exact) {
    throw new MediaWorkerError(
      'invalid-media',
      'The preprocessed media container is truncated or has trailing bytes.',
    );
  }
}

function hasExactIsoBmffBoundary(bytes: Buffer): boolean {
  let offset = 0;
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 8) {
      return false;
    }
    const shortSize = bytes.readUInt32BE(offset);
    let headerBytes = 8;
    let boxBytes: number;
    if (shortSize === 0) {
      return false;
    }
    if (shortSize === 1) {
      if (bytes.byteLength - offset < 16) {
        return false;
      }
      const extendedSize = bytes.readBigUInt64BE(offset + 8);
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) {
        return false;
      }
      headerBytes = 16;
      boxBytes = Number(extendedSize);
    } else {
      boxBytes = shortSize;
    }
    if (boxBytes < headerBytes || boxBytes > bytes.byteLength - offset) {
      return false;
    }
    offset += boxBytes;
  }
  return offset === bytes.byteLength;
}
