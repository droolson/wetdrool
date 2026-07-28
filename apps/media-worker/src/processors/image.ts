import sharp, { type Sharp } from 'sharp';

import { MediaWorkerError } from '../errors.js';
import type { DerivedArtifact, ProcessedMedia } from '../types.js';
import { assertOutputBudget } from './files.js';
import type { ProcessingLimits } from './limits.js';

export async function processImage(
  path: string,
  mediaType: string,
  limits: ProcessingLimits,
): Promise<ProcessedMedia> {
  const metadata = await sharp(path, {
    failOn: 'warning',
    limitInputPixels: limits.maximumDimension * limits.maximumDimension,
  }).metadata();
  const width = metadata.autoOrient.width;
  const height = metadata.autoOrient.height;
  if (
    width === undefined ||
    height === undefined ||
    width < 1 ||
    height < 1 ||
    width > limits.maximumDimension ||
    height > limits.maximumDimension
  ) {
    throw new MediaWorkerError('invalid-media', 'Image dimensions are missing or out of bounds.');
  }

  const originalBytes = await encode(
    sharp(path, {
      failOn: 'warning',
      limitInputPixels: limits.maximumDimension * limits.maximumDimension,
    }).rotate(),
    mediaType,
  );
  assertArtifactSize(originalBytes, limits.maximumArtifactBytes);
  const original: DerivedArtifact = {
    purpose: 'original',
    bytes: originalBytes,
    mediaType,
    width,
    height,
  };

  const variants: DerivedArtifact[] = [];
  const thumbnail = await sharp(path, {
    failOn: 'warning',
    limitInputPixels: limits.maximumDimension * limits.maximumDimension,
  })
    .rotate()
    .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 72 })
    .toBuffer();
  assertArtifactSize(thumbnail, limits.maximumArtifactBytes);
  const thumbnailMetadata = await sharp(thumbnail).metadata();
  variants.push({
    purpose: 'thumbnail',
    bytes: new Uint8Array(thumbnail),
    mediaType: 'image/webp',
    width: thumbnailMetadata.width,
    height: thumbnailMetadata.height,
  });

  for (const targetWidth of [640, 1_280]) {
    if (width <= targetWidth) {
      continue;
    }
    const bytes = await sharp(path, {
      failOn: 'warning',
      limitInputPixels: limits.maximumDimension * limits.maximumDimension,
    })
      .rotate()
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    assertArtifactSize(bytes, limits.maximumArtifactBytes);
    const variantMetadata = await sharp(bytes).metadata();
    variants.push({
      purpose: 'responsive',
      bytes: new Uint8Array(bytes),
      mediaType: 'image/webp',
      width: variantMetadata.width,
      height: variantMetadata.height,
    });
  }

  assertOutputBudget([original, ...variants], limits.maximumTotalOutputBytes);
  return {
    original,
    variants,
    notes: [
      'Sharp autorotation applied.',
      'Encoder output omits source EXIF, XMP, ICC, and other source metadata.',
    ],
  };
}

function encode(pipeline: Sharp, mediaType: string): Promise<Buffer> {
  switch (mediaType) {
    case 'image/avif':
      return pipeline.avif({ quality: 76, effort: 4 }).toBuffer();
    case 'image/jpeg':
      return pipeline.jpeg({ quality: 88, progressive: true }).toBuffer();
    case 'image/png':
      return pipeline.png({ compressionLevel: 9 }).toBuffer();
    case 'image/webp':
      return pipeline.webp({ quality: 84 }).toBuffer();
    default:
      throw new MediaWorkerError('unsupported-media', `Unsupported image encoder ${mediaType}.`);
  }
}

function assertArtifactSize(bytes: Uint8Array, maximumBytes: number): void {
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    throw new MediaWorkerError('output-limit', 'An image artifact exceeded its size bound.');
  }
}
