import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { MediaWorkerError } from '../errors.js';
import type { ProcessedMedia } from '../types.js';
import type { CommandRunner } from '../subprocess.js';
import { assertOutputBudget, ensurePrivateWorkingRoot, readBoundedFile } from './files.js';
import type { ProcessingLimits } from './limits.js';
import { probeMedia } from './probe.js';

export async function processAudio(
  path: string,
  temporaryRoot: string,
  runner: CommandRunner,
  limits: ProcessingLimits,
): Promise<ProcessedMedia> {
  const probe = await probeMedia(path, runner, limits);
  if (!probe.hasAudio || probe.hasVideo) {
    throw new MediaWorkerError(
      'invalid-media',
      'An audio upload must contain audio without a video stream.',
    );
  }
  const safeRoot = resolve(temporaryRoot);
  await ensurePrivateWorkingRoot(safeRoot);
  const work = await mkdtemp(join(safeRoot, 'audio-'));
  try {
    const outputPath = join(work, 'sanitized.m4a');
    const waveformPath = join(work, 'waveform.f32le');
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
        '0:a:0',
        '-vn',
        '-map_metadata',
        '-1',
        '-c:a',
        'aac',
        '-b:a',
        '160k',
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
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        '8000',
        '-f',
        'f32le',
        '-fs',
        String(
          Math.min(
            limits.maximumArtifactBytes,
            Math.ceil((probe.durationMilliseconds / 1_000) * 8_000 * 4) + 4_096,
          ),
        ),
        waveformPath,
      ],
      {
        timeoutMilliseconds: limits.subprocessTimeoutMilliseconds,
        maximumStdoutBytes: 1_000,
      },
    );

    const audio = await readBoundedFile(outputPath, limits.maximumArtifactBytes);
    const rawWaveform = await readBoundedFile(
      waveformPath,
      Math.min(
        limits.maximumArtifactBytes,
        Math.ceil((probe.durationMilliseconds / 1_000) * 8_000 * 4) + 4_096,
      ),
    );
    const waveform = encodeWaveform(rawWaveform, probe.durationMilliseconds);
    const original = {
      purpose: 'original' as const,
      bytes: audio,
      mediaType: 'audio/mp4',
      durationMilliseconds: probe.durationMilliseconds,
    };
    assertOutputBudget([original, { bytes: waveform }], limits.maximumTotalOutputBytes);
    return {
      original,
      variants: [],
      waveform,
      notes: [
        'Audio was decoded and re-encoded as AAC in MP4 with container metadata removed.',
        'Waveform data contains normalized peak amplitudes, not audio samples.',
      ],
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function encodeWaveform(raw: Uint8Array, durationMilliseconds: number): Uint8Array {
  const view = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  const sampleCount = Math.floor(view.byteLength / 4);
  const binCount = Math.min(256, Math.max(1, sampleCount));
  const samples: number[] = [];
  for (let bin = 0; bin < binCount; bin += 1) {
    const start = Math.floor((bin * sampleCount) / binCount);
    const end = Math.max(start + 1, Math.floor(((bin + 1) * sampleCount) / binCount));
    let peak = 0;
    for (let index = start; index < end && index < sampleCount; index += 1) {
      const value = Math.abs(view.readFloatLE(index * 4));
      if (Number.isFinite(value)) {
        peak = Math.max(peak, value);
      }
    }
    samples.push(Math.round(Math.min(1, peak) * 10_000) / 10_000);
  }
  return new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      kind: 'normalized-peak-waveform',
      durationMilliseconds,
      samples,
    }),
  );
}
