import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { MemoryContentAddressedStorage } from '@wokesocial/storage';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';

import { digestBytes } from '../src/digests.js';
import { MediaProcessor } from '../src/processors/index.js';
import { MediaWorkerService } from '../src/service.js';
import { CommandRunner } from '../src/subprocess.js';
import { createTestRoot, fixedNow, PassingScanner, removeTestRoot, uploadAll } from './fixtures.js';

const roots: string[] = [];
const capabilityRoot = await createTestRoot();
const runner = new CommandRunner();
const capabilities = await new MediaProcessor({
  temporaryRoot: join(capabilityRoot, 'capability'),
  runner,
}).capabilities();
await removeTestRoot(capabilityRoot);

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTestRoot));
});

async function root(): Promise<string> {
  const value = await createTestRoot();
  roots.push(value);
  return value;
}

describe.skipIf(!capabilities.sharp)('real Sharp integration', () => {
  it('autorotates and strips source metadata before publishing image variants', async () => {
    const testRoot = await root();
    const bytes = new Uint8Array(
      await sharp({
        create: {
          width: 40,
          height: 20,
          channels: 3,
          background: '#ff3366',
        },
      })
        .withMetadata({ orientation: 6 })
        .jpeg()
        .toBuffer(),
    );
    const storage = new MemoryContentAddressedStorage(() => fixedNow);
    const service = serviceWith(testRoot, storage);
    const id = await uploadAll(service, bytes, {
      declaredMediaType: 'image/jpeg',
      processingMode: 'managed',
      metadataStripped: undefined,
    });
    const result = await service.finalize(id);
    expect(result.manifestContent.original).toMatchObject({ width: 20, height: 40 });

    const published = await storage.get(result.manifestContent.original.cid);
    const metadata = await sharp(published).metadata();
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
    expect(result.manifestContent.variants).toEqual(
      expect.arrayContaining([expect.objectContaining({ purpose: 'thumbnail' })]),
    );
  });
});

describe.skipIf(!capabilities.ffmpeg || !capabilities.ffprobe)(
  'real FFmpeg and ffprobe integration',
  () => {
    it('transcodes audio, strips metadata, and publishes bounded waveform data', async () => {
      const testRoot = await root();
      const source = join(testRoot, 'fixture.mp3');
      await runner.ffmpeg(
        [
          '-nostdin',
          '-y',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=440:sample_rate=44100',
          '-t',
          '1.1',
          '-metadata',
          'title=should-be-removed',
          '-c:a',
          'libmp3lame',
          source,
        ],
        { timeoutMilliseconds: 20_000 },
      );
      const bytes = new Uint8Array(await readFile(source));
      const storage = new MemoryContentAddressedStorage(() => fixedNow);
      const service = serviceWith(testRoot, storage);
      const id = await uploadAll(service, bytes, {
        declaredMediaType: 'audio/mpeg',
        processingMode: 'managed',
        metadataStripped: undefined,
        altText: undefined,
      });
      const result = await service.finalize(id);

      expect(result.manifestContent.original).toMatchObject({
        mediaType: 'audio/mp4',
      });
      expect(result.manifestContent.original.durationMilliseconds).toBeGreaterThan(900);
      expect(result.manifestContent.waveform).toBeDefined();
      const waveformReference = result.manifestContent.waveform;
      if (waveformReference === undefined) {
        throw new Error('Expected a waveform reference.');
      }
      const waveform = JSON.parse(
        Buffer.from(await storage.get(waveformReference.cid)).toString('utf8'),
      ) as { samples: number[] };
      expect(waveform.samples.length).toBeGreaterThan(100);
      expect(waveform.samples.every((value) => value >= 0 && value <= 1)).toBe(true);
    });

    it('validates video and publishes MP4, poster, CID-addressed HLS, and captions metadata', async () => {
      const testRoot = await root();
      const source = join(testRoot, 'fixture.mp4');
      await runner.ffmpeg(
        [
          '-nostdin',
          '-y',
          '-v',
          'error',
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=320x180:rate=24',
          '-f',
          'lavfi',
          '-i',
          'sine=frequency=660:sample_rate=44100',
          '-t',
          '1.2',
          '-shortest',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          source,
        ],
        { timeoutMilliseconds: 20_000 },
      );
      const bytes = new Uint8Array(await readFile(source));
      const storage = new MemoryContentAddressedStorage(() => fixedNow);
      const captionBytes = new TextEncoder().encode(
        'WEBVTT\n\n00:00.000 --> 00:01.000\nA generated color chart.\n',
      );
      const captionReceipt = await storage.put(captionBytes, {
        permanence: 'deletion-compatible',
      });
      const service = serviceWith(testRoot, storage);
      const id = await uploadAll(service, bytes, {
        declaredMediaType: 'video/mp4',
        processingMode: 'managed',
        metadataStripped: undefined,
        altText: undefined,
        captions: [
          {
            language: 'en',
            kind: 'captions',
            reference: {
              cid: captionReceipt.cid,
              digest: digestBytes(captionBytes),
              bytes: captionBytes.byteLength,
              mediaType: 'text/vtt',
            },
          },
        ],
      });
      const result = await service.finalize(id);
      const purposes = result.manifestContent.variants.map((variant) => variant.purpose);
      expect(result.manifestContent.original).toMatchObject({
        mediaType: 'video/mp4',
        width: 320,
        height: 180,
      });
      expect(purposes).toContain('poster');
      expect(purposes).toContain('hls-segment');
      expect(purposes).toContain('hls-master');
      expect(result.manifestContent.captions).toHaveLength(1);

      const playlistReference = result.manifestContent.variants.find(
        (variant) => variant.purpose === 'hls-master',
      )?.reference;
      if (playlistReference === undefined) {
        throw new Error('Expected an HLS playlist reference.');
      }
      const playlist = Buffer.from(await storage.get(playlistReference.cid)).toString('utf8');
      expect(playlist).toContain('#EXT-X-ENDLIST');
      expect(playlist).not.toContain('segment-000.ts');
      for (const segment of result.manifestContent.variants.filter(
        (variant) => variant.purpose === 'hls-segment',
      )) {
        expect(playlist).toContain(segment.reference.cid);
      }

      const saved = join(testRoot, 'published.mp4');
      await writeFile(saved, await storage.get(result.manifestContent.original.cid));
      const probe = await runner.ffprobe(
        ['-v', 'error', '-show_entries', 'format_tags', '-of', 'json', saved],
        { timeoutMilliseconds: 10_000 },
      );
      expect(Buffer.from(probe.stdout).toString('utf8')).not.toContain('should-be-removed');
    });
  },
);

function serviceWith(
  rootDirectory: string,
  storage: MemoryContentAddressedStorage,
): MediaWorkerService {
  return new MediaWorkerService({
    stagingRoot: join(rootDirectory, 'staging'),
    temporaryRoot: join(rootDirectory, 'temporary'),
    storage,
    scanner: new PassingScanner(),
    clock: () => fixedNow,
  });
}
