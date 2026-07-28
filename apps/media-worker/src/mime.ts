import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { fileTypeFromBuffer } from 'file-type';

import { MediaWorkerError } from './errors.js';

const allowedMediaTypes = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
  'audio/flac',
  'audio/mp4',
  'audio/mpeg',
  'audio/ogg',
  'audio/wav',
]);

export function assertAllowedDeclaredMediaType(mediaType: string): void {
  if (!allowedMediaTypes.has(mediaType)) {
    throw new MediaWorkerError(
      'unsupported-media',
      `Media type ${mediaType} is not in the worker allowlist.`,
    );
  }
}

export async function detectAndValidateMediaType(
  path: string,
  declaredMediaType: string,
): Promise<string> {
  assertAllowedDeclaredMediaType(declaredMediaType);
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new MediaWorkerError(
        'invalid-state',
        'The staged upload is not a private regular file.',
      );
    }
    const sample = Buffer.alloc(8_192);
    const { bytesRead } = await handle.read(sample, 0, sample.byteLength, 0);
    const detected = await fileTypeFromBuffer(sample.subarray(0, bytesRead));
    if (detected === undefined || !allowedMediaTypes.has(detected.mime)) {
      throw new MediaWorkerError(
        'unsupported-media',
        'The uploaded bytes do not match a supported media signature.',
      );
    }
    if (detected.mime !== declaredMediaType) {
      throw new MediaWorkerError(
        'invalid-media',
        `Declared media type ${declaredMediaType} does not match detected type ${detected.mime}.`,
      );
    }
    return detected.mime;
  } finally {
    await handle.close();
  }
}

export function mediaFamily(mediaType: string): 'image' | 'video' | 'audio' {
  if (mediaType.startsWith('image/')) {
    return 'image';
  }
  if (mediaType.startsWith('video/')) {
    return 'video';
  }
  if (mediaType.startsWith('audio/')) {
    return 'audio';
  }
  throw new MediaWorkerError('unsupported-media', 'The detected media family is unsupported.');
}

export function listAllowedMediaTypes(): readonly string[] {
  return [...allowedMediaTypes].sort();
}
