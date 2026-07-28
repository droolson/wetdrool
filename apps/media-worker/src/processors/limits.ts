export interface ProcessingLimits {
  readonly maximumDurationMilliseconds: number;
  readonly maximumDimension: number;
  readonly maximumArtifactBytes: number;
  readonly maximumTotalOutputBytes: number;
  readonly maximumHlsSegments: number;
  readonly subprocessTimeoutMilliseconds: number;
}

export const defaultProcessingLimits: ProcessingLimits = {
  maximumDurationMilliseconds: 10 * 60 * 1_000,
  maximumDimension: 8_192,
  maximumArtifactBytes: 500_000_000,
  maximumTotalOutputBytes: 750_000_000,
  // The protocol permits 64 variants. Video reserves one each for the poster
  // and HLS playlist, leaving at most 62 segment references.
  maximumHlsSegments: 62,
  subprocessTimeoutMilliseconds: 120_000,
};

export function assertValidProcessingLimits(limits: ProcessingLimits): void {
  assertBoundedInteger(
    'maximumDurationMilliseconds',
    limits.maximumDurationMilliseconds,
    1,
    86_400_000,
  );
  assertBoundedInteger('maximumDimension', limits.maximumDimension, 1, 32_768);
  assertBoundedInteger('maximumArtifactBytes', limits.maximumArtifactBytes, 1, 2_000_000_000);
  assertBoundedInteger('maximumTotalOutputBytes', limits.maximumTotalOutputBytes, 1, 2_000_000_000);
  assertBoundedInteger('maximumHlsSegments', limits.maximumHlsSegments, 1, 62);
  assertBoundedInteger(
    'subprocessTimeoutMilliseconds',
    limits.subprocessTimeoutMilliseconds,
    1,
    10 * 60 * 1_000,
  );
}

function assertBoundedInteger(name: string, value: number, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}.`,
    );
  }
}
