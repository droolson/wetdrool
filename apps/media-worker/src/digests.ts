import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { digestSha256Multibase } from '@wetdrool/protocol';

import { MediaWorkerError } from './errors.js';

export function digestBytes(bytes: Uint8Array): string {
  return digestSha256Multibase(bytes);
}

export async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.nlink !== 1) {
      throw new MediaWorkerError(
        'invalid-state',
        'The staged upload is not a private regular file.',
      );
    }
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } finally {
    await handle.close();
  }
  return `u${hash.digest('base64url')}`;
}
