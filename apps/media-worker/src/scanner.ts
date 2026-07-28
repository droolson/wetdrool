import { MediaWorkerError } from './errors.js';
import type { MalwareScanner, ScannerResult } from './types.js';

export class UnavailableMalwareScanner implements MalwareScanner {
  readonly name = 'unavailable';
  readonly available = false;

  scan(): Promise<ScannerResult> {
    throw new MediaWorkerError(
      'scanner-unavailable',
      'Media finalization is locked because no malware scanner is configured.',
    );
  }
}
