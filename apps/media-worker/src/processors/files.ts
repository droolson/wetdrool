import { constants } from 'node:fs';
import { lstat, mkdir, open } from 'node:fs/promises';

import { MediaWorkerError } from '../errors.js';

export async function readBoundedFile(path: string, maximumBytes: number): Promise<Uint8Array> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (
      !metadata.isFile() ||
      metadata.nlink !== 1 ||
      metadata.size < 1 ||
      metadata.size > maximumBytes
    ) {
      throw new MediaWorkerError(
        'output-limit',
        `Processed artifact exceeds the ${String(maximumBytes)}-byte bound.`,
      );
    }
    const bytes = Buffer.allocUnsafe(metadata.size);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
      if (bytesRead < 1) {
        throw new MediaWorkerError(
          'processing-failed',
          'Processed artifact changed while it was being read.',
        );
      }
      offset += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    if ((await handle.read(extra, 0, 1, bytes.byteLength)).bytesRead !== 0) {
      throw new MediaWorkerError(
        'output-limit',
        'Processed artifact grew beyond its validated byte bound.',
      );
    }
    return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  } finally {
    await handle.close();
  }
}

export function assertOutputBudget(
  artifacts: readonly { readonly bytes: Uint8Array }[],
  maximumTotalBytes: number,
): void {
  const total = artifacts.reduce((sum, artifact) => sum + artifact.bytes.byteLength, 0);
  if (total > maximumTotalBytes) {
    throw new MediaWorkerError(
      'output-limit',
      `Processed artifacts exceed the ${String(maximumTotalBytes)}-byte total bound.`,
    );
  }
}

export async function ensurePrivateWorkingRoot(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const metadata = await lstat(path);
  const currentUser = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if (
    metadata.isSymbolicLink() ||
    !metadata.isDirectory() ||
    (process.platform !== 'win32' &&
      ((metadata.mode & 0o077) !== 0 ||
        (currentUser !== undefined && metadata.uid !== currentUser)))
  ) {
    throw new MediaWorkerError(
      'processing-failed',
      'The media working root must be a private, service-owned real directory.',
    );
  }
}
