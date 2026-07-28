import { z } from 'zod';

import { MediaWorkerError } from '../errors.js';
import type { CommandRunner } from '../subprocess.js';
import type { ProcessingLimits } from './limits.js';

const probeSchema = z
  .object({
    streams: z.array(
      z
        .object({
          codec_type: z.enum(['video', 'audio', 'subtitle', 'data', 'attachment']).optional(),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          duration: z.string().optional(),
        })
        .passthrough(),
    ),
    format: z
      .object({
        duration: z.string().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export interface ProbedMedia {
  readonly durationMilliseconds: number;
  readonly width?: number;
  readonly height?: number;
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
}

export async function probeMedia(
  path: string,
  runner: CommandRunner,
  limits: ProcessingLimits,
): Promise<ProbedMedia> {
  const result = await runner.ffprobe(
    [
      '-v',
      'error',
      '-protocol_whitelist',
      'file',
      '-show_streams',
      '-show_format',
      '-of',
      'json',
      path,
    ],
    {
      timeoutMilliseconds: Math.min(15_000, limits.subprocessTimeoutMilliseconds),
      maximumStdoutBytes: 1_000_000,
    },
  );
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(result.stdout).toString('utf8')) as unknown;
  } catch (error) {
    throw new MediaWorkerError('invalid-media', 'ffprobe returned invalid metadata.', {
      cause: error,
    });
  }
  const validation = probeSchema.safeParse(parsedJson);
  if (!validation.success) {
    throw new MediaWorkerError('invalid-media', 'ffprobe returned invalid media metadata.', {
      cause: validation.error,
    });
  }
  const parsed = validation.data;
  const video = parsed.streams.find((stream) => stream.codec_type === 'video');
  const hasAudio = parsed.streams.some((stream) => stream.codec_type === 'audio');
  const durationSeconds = Number(parsed.format.duration ?? video?.duration);
  const durationMilliseconds = Math.round(durationSeconds * 1_000);
  if (
    !Number.isFinite(durationMilliseconds) ||
    durationMilliseconds < 1 ||
    durationMilliseconds > limits.maximumDurationMilliseconds
  ) {
    throw new MediaWorkerError('invalid-media', 'Media duration is missing or out of bounds.');
  }
  if (
    video !== undefined &&
    (video.width === undefined ||
      video.height === undefined ||
      video.width > limits.maximumDimension ||
      video.height > limits.maximumDimension)
  ) {
    throw new MediaWorkerError('invalid-media', 'Video dimensions are missing or out of bounds.');
  }
  const base = {
    durationMilliseconds,
    hasVideo: video !== undefined,
    hasAudio,
  };
  return video?.width === undefined || video.height === undefined
    ? base
    : { ...base, width: video.width, height: video.height };
}
