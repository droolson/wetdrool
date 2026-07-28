export type MediaWorkerErrorCode =
  | 'authorization-unavailable'
  | 'cancelled'
  | 'chunk-hash-mismatch'
  | 'cleanup-failed'
  | 'conflict'
  | 'expired'
  | 'invalid-media'
  | 'invalid-state'
  | 'malware-detected'
  | 'not-found'
  | 'output-limit'
  | 'persistence-failed'
  | 'processing-failed'
  | 'scanner-unavailable'
  | 'size-limit'
  | 'storage-unavailable'
  | 'total-hash-mismatch'
  | 'unauthorized'
  | 'unsupported-media'
  | 'worker-busy';

export class MediaWorkerError extends Error {
  override readonly name = 'MediaWorkerError';

  constructor(
    readonly code: MediaWorkerErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
