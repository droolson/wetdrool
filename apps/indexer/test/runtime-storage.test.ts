import { chmod, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { assertReadableContentStorage } from '../src/index.js';

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe('indexer content storage startup check', () => {
  it('accepts an existing read-only mount without writing a probe', async () => {
    const parent = await temporaryRoot();
    const contentRoot = join(parent, 'content');
    await mkdir(contentRoot);
    await writeFile(join(contentRoot, 'retained'), 'durable-content', 'utf8');
    await chmod(contentRoot, 0o500);

    try {
      await expect(assertReadableContentStorage(contentRoot)).resolves.toBeUndefined();
      await expect(readdir(contentRoot)).resolves.toEqual(['retained']);
    } finally {
      await chmod(contentRoot, 0o700);
    }
  });

  it('fails closed when the configured mount path is not a directory', async () => {
    const parent = await temporaryRoot();
    const filePath = join(parent, 'not-a-directory');
    await writeFile(filePath, 'occupied', 'utf8');

    await expect(assertReadableContentStorage(filePath)).rejects.toThrow(
      'Indexer content storage must be an existing readable mounted directory.',
    );
  });

  it('does not create a missing content mount', async () => {
    const parent = await temporaryRoot();
    const missingPath = join(parent, 'missing');

    await expect(assertReadableContentStorage(missingPath)).rejects.toThrow(
      'Indexer content storage must be an existing readable mounted directory.',
    );
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'wetdrool-indexer-storage-'));
  temporaryRoots.push(root);
  return root;
}
