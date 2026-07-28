import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import sharp from 'sharp';

import { MediaWorkerError } from '../errors.js';
import type { CommandRunner } from '../subprocess.js';
import type { DerivedArtifact, ProcessedMedia } from '../types.js';
import { assertOutputBudget, ensurePrivateWorkingRoot, readBoundedFile } from './files.js';
import type { ProcessingLimits } from './limits.js';
import { probeMedia } from './probe.js';

export async function processVideo(
  path: string,
  temporaryRoot: string,
  runner: CommandRunner,
  limits: ProcessingLimits,
): Promise<ProcessedMedia> {
  const inputProbe = await probeMedia(path, runner, limits);
  if (!inputProbe.hasVideo) {
    throw new MediaWorkerError('invalid-media', 'A video upload must contain a video stream.');
  }
  const safeRoot = resolve(temporaryRoot);
  await ensurePrivateWorkingRoot(safeRoot);
  const work = await mkdtemp(join(safeRoot, 'video-'));
  try {
    const outputPath = join(work, 'sanitized.mp4');
    const posterPath = join(work, 'poster.jpg');
    const playlistPath = join(work, 'index.m3u8');
    const segmentPattern = join(work, 'segment-%03d.ts');

    await runner.ffmpeg(
      [
        '-nostdin',
        '-y',
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-i',
        path,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-map_metadata',
        '-1',
        '-vf',
        "scale='trunc(min(1280,iw)/2)*2':-2",
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-crf',
        '23',
        '-pix_fmt',
        'yuv420p',
        '-g',
        '48',
        '-keyint_min',
        '48',
        '-sc_threshold',
        '0',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        '-fs',
        String(limits.maximumArtifactBytes),
        outputPath,
      ],
      {
        timeoutMilliseconds: limits.subprocessTimeoutMilliseconds,
        maximumStdoutBytes: 1_000,
      },
    );
    const outputProbe = await probeMedia(outputPath, runner, limits);
    await runner.ffmpeg(
      [
        '-nostdin',
        '-y',
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-i',
        outputPath,
        '-map',
        '0:v:0',
        '-frames:v',
        '1',
        '-map_metadata',
        '-1',
        '-q:v',
        '3',
        '-fs',
        String(limits.maximumArtifactBytes),
        posterPath,
      ],
      {
        timeoutMilliseconds: limits.subprocessTimeoutMilliseconds,
        maximumStdoutBytes: 1_000,
      },
    );
    await runner.ffmpeg(
      [
        '-nostdin',
        '-y',
        '-v',
        'error',
        '-protocol_whitelist',
        'file',
        '-i',
        outputPath,
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c',
        'copy',
        '-f',
        'hls',
        '-hls_time',
        '10',
        '-hls_playlist_type',
        'vod',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_filename',
        segmentPattern,
        '-fs',
        String(limits.maximumTotalOutputBytes),
        playlistPath,
      ],
      {
        timeoutMilliseconds: limits.subprocessTimeoutMilliseconds,
        maximumStdoutBytes: 1_000,
      },
    );

    const segmentFiles = (await readdir(work))
      .filter((name) => /^segment-\d{3}\.ts$/u.test(name))
      .sort();
    if (segmentFiles.length < 1 || segmentFiles.length > limits.maximumHlsSegments) {
      throw new MediaWorkerError('output-limit', 'The HLS segment count is out of bounds.');
    }
    const playlist = await readFile(playlistPath, 'utf8');
    const durations = parseSegmentDurations(playlist, segmentFiles);
    const segments: DerivedArtifact[] = [];
    for (const name of segmentFiles) {
      segments.push({
        purpose: 'hls-segment',
        bytes: await readBoundedFile(join(work, name), limits.maximumArtifactBytes),
        mediaType: 'video/mp2t',
        durationMilliseconds: Math.max(1, Math.round((durations.get(name) ?? 0) * 1_000)),
      });
    }
    const poster = await readBoundedFile(posterPath, limits.maximumArtifactBytes);
    const posterMetadata = await sharp(poster).metadata();
    const originalBase = {
      purpose: 'original' as const,
      bytes: await readBoundedFile(outputPath, limits.maximumArtifactBytes),
      mediaType: 'video/mp4',
      durationMilliseconds: outputProbe.durationMilliseconds,
    };
    const original =
      outputProbe.width === undefined || outputProbe.height === undefined
        ? originalBase
        : { ...originalBase, width: outputProbe.width, height: outputProbe.height };
    const variants: DerivedArtifact[] = [
      {
        purpose: 'poster',
        bytes: poster,
        mediaType: 'image/jpeg',
        width: posterMetadata.width,
        height: posterMetadata.height,
      },
    ];
    assertOutputBudget([original, ...variants, ...segments], limits.maximumTotalOutputBytes);
    return {
      original,
      variants,
      hls: {
        segments,
        segmentDurationsSeconds: segmentFiles.map((name) => durations.get(name) ?? 0),
        targetDurationSeconds: parseTargetDuration(playlist),
      },
      notes: [
        'Video was decoded, dimension-bounded, and re-encoded as H.264/AAC MP4.',
        'Container metadata was removed; HLS segment references require client-side CID resolution.',
      ],
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function parseSegmentDurations(
  playlist: string,
  expectedFiles: readonly string[],
): ReadonlyMap<string, number> {
  const durations = new Map<string, number>();
  const lines = playlist.split(/\r?\n/u);
  let pendingDuration: number | undefined;
  for (const line of lines) {
    if (line.startsWith('#EXTINF:')) {
      const duration = Number(line.slice('#EXTINF:'.length).split(',')[0]);
      if (!Number.isFinite(duration) || duration <= 0 || duration > 60) {
        throw new MediaWorkerError(
          'processing-failed',
          'FFmpeg produced an invalid HLS segment duration.',
        );
      }
      pendingDuration = duration;
    } else if (/^segment-\d{3}\.ts$/u.test(line) && pendingDuration !== undefined) {
      durations.set(line, pendingDuration);
      pendingDuration = undefined;
    }
  }
  if (
    durations.size !== expectedFiles.length ||
    expectedFiles.some((name) => !durations.has(name))
  ) {
    throw new MediaWorkerError('processing-failed', 'FFmpeg produced an invalid HLS playlist.');
  }
  return durations;
}

function parseTargetDuration(playlist: string): number {
  const match = /^#EXT-X-TARGETDURATION:(\d+)$/mu.exec(playlist);
  const duration = Number(match?.[1]);
  if (!Number.isInteger(duration) || duration < 1 || duration > 60) {
    throw new MediaWorkerError('processing-failed', 'HLS target duration is invalid.');
  }
  return duration;
}
