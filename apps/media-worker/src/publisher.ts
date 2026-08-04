import {
  digestSha256Multibase,
  getContentCid,
  mediaManifestContentSchema,
  type MediaManifestContent,
} from '@wetdrool/protocol';
import {
  MultiProviderStorage,
  type ContentAddressedStorage,
  type StorageHealth,
  type StoragePolicy,
  type StorageReceipt,
} from '@wetdrool/storage';

import { MediaWorkerError } from './errors.js';
import type {
  ArtifactPublication,
  DerivedArtifact,
  ProcessedMedia,
  UploadRecord,
} from './types.js';

export type MediaStorage = MultiProviderStorage | ContentAddressedStorage;

export interface PublishedMedia {
  readonly manifestContent: MediaManifestContent;
  readonly publications: readonly ArtifactPublication[];
}

export class MediaPublisher {
  constructor(private readonly storage: MediaStorage) {}

  async health(): Promise<readonly StorageHealth[]> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.storage.health();
      const entries = 'ok' in result ? [result] : result;
      if (entries.length < 1 || entries.length > 16) {
        throw new TypeError('Storage health result count is invalid.');
      }
      return entries.map((entry) => {
        if (
          !isBoundedOperationalText(entry.provider, 160) ||
          typeof entry.ok !== 'boolean' ||
          typeof entry.checkedAt !== 'string' ||
          entry.checkedAt.length > 40 ||
          Number.isNaN(Date.parse(entry.checkedAt))
        ) {
          throw new TypeError('Storage health result is invalid.');
        }
        return {
          provider: entry.provider,
          ok: entry.ok,
          checkedAt: entry.checkedAt,
          ...(entry.detail === undefined
            ? {}
            : { detail: 'Provider reported an unavailable or degraded state.' }),
        };
      });
    } catch {
      return [
        {
          provider: 'storage-health',
          ok: false,
          checkedAt,
          detail: 'Storage health checks did not complete safely.',
        },
      ];
    }
  }

  async publish(processed: ProcessedMedia, upload: UploadRecord): Promise<PublishedMedia> {
    const publications: ArtifactPublication[] = [];
    const policy = normalizeStoragePolicy(upload.storagePolicy);
    const original = await this.#publishArtifact(processed.original, policy);
    publications.push(original);

    const publishedVariants: {
      purpose: 'thumbnail' | 'responsive' | 'poster' | 'hls-master' | 'hls-segment' | 'audio';
      reference: ReturnType<typeof mediaReference>;
    }[] = [];
    for (const artifact of processed.variants) {
      if (artifact.purpose === 'original') {
        continue;
      }
      const publication = await this.#publishArtifact(artifact, policy);
      publications.push(publication);
      publishedVariants.push({
        purpose: artifact.purpose,
        reference: mediaReference(publication, artifact),
      });
    }

    if (processed.hls !== undefined) {
      const segmentPublications: ArtifactPublication[] = [];
      for (const segment of processed.hls.segments) {
        const publication = await this.#publishArtifact(segment, policy);
        publications.push(publication);
        segmentPublications.push(publication);
        publishedVariants.push({
          purpose: 'hls-segment',
          reference: mediaReference(publication, segment),
        });
      }
      const playlistBytes = buildCidPlaylist(
        segmentPublications,
        processed.hls.segmentDurationsSeconds,
        processed.hls.targetDurationSeconds,
      );
      const playlistArtifact: DerivedArtifact = {
        purpose: 'hls-master',
        bytes: playlistBytes,
        mediaType: 'application/vnd.apple.mpegurl',
      };
      const playlist = await this.#publishArtifact(playlistArtifact, policy);
      publications.push(playlist);
      publishedVariants.push({
        purpose: 'hls-master',
        reference: mediaReference(playlist, playlistArtifact),
      });
    }

    let waveform: ArtifactPublication | undefined;
    if (processed.waveform !== undefined) {
      waveform = await this.#publishBytes(
        processed.waveform,
        'application/vnd.wetdrool.waveform+json',
        policy,
      );
      publications.push(waveform);
    }

    const originalReference = {
      ...mediaReference(original, processed.original),
      ...(upload.altText === undefined ? {} : { altText: upload.altText }),
      ...(upload.caption === undefined ? {} : { caption: upload.caption }),
    };
    const content: MediaManifestContent = {
      original: originalReference,
      variants: publishedVariants,
      captions: [...upload.captions],
      ...(waveform === undefined
        ? {}
        : {
            waveform: {
              cid: waveform.cid,
              digest: waveform.digest,
              bytes: waveform.bytes,
              mediaType: waveform.mediaType,
            },
          }),
      metadataStripped: true,
      malwareScan: { status: 'passed' },
      processingNotes: truncateUtf8(processed.notes.join(' ').normalize('NFC'), 1_000),
    };
    return {
      manifestContent: mediaManifestContentSchema.parse(content),
      publications,
    };
  }

  #publishArtifact(artifact: DerivedArtifact, policy: StoragePolicy): Promise<ArtifactPublication> {
    return this.#publishBytes(artifact.bytes, artifact.mediaType, policy);
  }

  async #publishBytes(
    bytes: Uint8Array,
    mediaType: string,
    policy: StoragePolicy,
  ): Promise<ArtifactPublication> {
    const expectedDigest = digestSha256Multibase(bytes);
    const expectedCid = await getContentCid(bytes);
    const publicationBytes = bytes.slice();
    if (this.storage instanceof MultiProviderStorage) {
      let publication: Awaited<ReturnType<MultiProviderStorage['publish']>>;
      try {
        publication = await this.storage.publish(publicationBytes, policy);
      } catch (error) {
        throw storageUnavailable(error);
      }
      assertValidPublication(
        publication.cid,
        publication.receipts,
        expectedCid,
        bytes.byteLength,
        policy,
      );
      const failures = normalizeProviderFailures(publication.failures);
      return {
        cid: publication.cid,
        digest: expectedDigest,
        bytes: bytes.byteLength,
        mediaType,
        receipts: publication.receipts,
        failures,
        replication: failures.length === 0 ? 'satisfied' : 'degraded',
      };
    }
    let receipt: Awaited<ReturnType<ContentAddressedStorage['put']>>;
    try {
      receipt = await this.storage.put(publicationBytes, policy);
    } catch (error) {
      throw storageUnavailable(error);
    }
    assertValidPublication(receipt.cid, [receipt], expectedCid, bytes.byteLength, policy);
    return {
      cid: receipt.cid,
      digest: expectedDigest,
      bytes: bytes.byteLength,
      mediaType,
      receipts: [receipt],
      failures: [],
      replication: 'satisfied',
    };
  }
}

function normalizeStoragePolicy(policy: UploadRecord['storagePolicy']): StoragePolicy {
  return policy.consentId === undefined
    ? { permanence: policy.permanence }
    : { permanence: policy.permanence, consentId: policy.consentId };
}

function mediaReference(publication: ArtifactPublication, artifact: DerivedArtifact) {
  return {
    cid: publication.cid,
    digest: publication.digest,
    bytes: publication.bytes,
    mediaType: publication.mediaType,
    ...(artifact.width === undefined ? {} : { width: artifact.width }),
    ...(artifact.height === undefined ? {} : { height: artifact.height }),
    ...(artifact.durationMilliseconds === undefined
      ? {}
      : { durationMilliseconds: artifact.durationMilliseconds }),
  };
}

function buildCidPlaylist(
  segments: readonly ArtifactPublication[],
  durations: readonly number[],
  targetDurationSeconds: number,
): Uint8Array {
  if (segments.length < 1 || segments.length > 62 || segments.length !== durations.length) {
    throw new MediaWorkerError('processing-failed', 'HLS segment and duration inputs are invalid.');
  }
  if (
    !Number.isInteger(targetDurationSeconds) ||
    targetDurationSeconds < 1 ||
    targetDurationSeconds > 60
  ) {
    throw new MediaWorkerError(
      'processing-failed',
      'HLS target duration is outside the supported range.',
    );
  }
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    `#EXT-X-TARGETDURATION:${String(targetDurationSeconds)}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    '#EXT-X-INDEPENDENT-SEGMENTS',
  ];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const duration = durations[index];
    if (segment === undefined || duration === undefined) {
      throw new RangeError('HLS playlist input is incomplete.');
    }
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 60 ||
      Math.round(duration) > targetDurationSeconds
    ) {
      throw new MediaWorkerError(
        'processing-failed',
        'HLS segment duration is outside the supported range.',
      );
    }
    lines.push(`#EXTINF:${duration.toFixed(6)},`, segment.cid);
  }
  lines.push('#EXT-X-ENDLIST', '');
  return new TextEncoder().encode(lines.join('\n'));
}

function assertValidPublication(
  cid: string,
  receipts: readonly StorageReceipt[],
  expectedCid: string,
  expectedBytes: number,
  expectedPolicy: StoragePolicy,
): void {
  if (cid !== expectedCid || receipts.length < 1 || receipts.length > 16) {
    throw invalidStorageReceipt();
  }
  for (const receipt of receipts) {
    if (
      typeof receipt !== 'object' ||
      receipt === null ||
      receipt.cid !== expectedCid ||
      receipt.byteLength !== expectedBytes ||
      receipt.verified !== true ||
      !isBoundedOperationalText(receipt.provider, 160) ||
      !isBoundedOperationalText(receipt.providerVersion, 160) ||
      !isBoundedOperationalText(receipt.locator, 2_048) ||
      typeof receipt.publishedAt !== 'string' ||
      receipt.publishedAt.length > 40 ||
      Number.isNaN(Date.parse(receipt.publishedAt)) ||
      typeof receipt.policy !== 'object' ||
      receipt.policy === null ||
      receipt.policy.permanence !== expectedPolicy.permanence ||
      receipt.policy.consentId !== expectedPolicy.consentId
    ) {
      throw invalidStorageReceipt();
    }
  }
}

function invalidStorageReceipt(): MediaWorkerError {
  return new MediaWorkerError(
    'storage-unavailable',
    'A storage provider returned an invalid content-addressed publication receipt.',
  );
}

function storageUnavailable(error: unknown): MediaWorkerError {
  return error instanceof MediaWorkerError
    ? error
    : new MediaWorkerError(
        'storage-unavailable',
        'The configured storage publication provider is unavailable.',
        { cause: error },
      );
}

function normalizeProviderFailures(
  failures: readonly { readonly provider: string; readonly message: string }[],
): readonly { readonly provider: string; readonly message: string }[] {
  if (failures.length > 16) {
    throw invalidStorageReceipt();
  }
  return failures.map((failure) => {
    if (!isBoundedOperationalText(failure.provider, 160)) {
      throw invalidStorageReceipt();
    }
    return {
      provider: failure.provider,
      message: 'Provider publication failed.',
    };
  });
}

function isBoundedOperationalText(value: unknown, maximumBytes: number): value is string {
  return (
    typeof value === 'string' &&
    value === value.trim() &&
    value === value.normalize('NFC') &&
    value.trim().length > 0 &&
    !hasAsciiControlCharacters(value) &&
    Buffer.byteLength(value, 'utf8') <= maximumBytes
  );
}

function hasAsciiControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
      return true;
    }
  }
  return false;
}

function truncateUtf8(value: string, maximumBytes: number): string {
  let byteLength = 0;
  let result = '';
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character, 'utf8');
    if (byteLength + characterBytes > maximumBytes) {
      break;
    }
    result += character;
    byteLength += characterBytes;
  }
  return result;
}
