import {
  access,
  appendFile,
  chmod,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { digestBytes } from '../src/digests.js';
import { UploadStore, writeAllAtOffset } from '../src/upload-store.js';
import {
  createTestRoot,
  fixedNow,
  pngFixture,
  removeTestRoot,
  uploadDeclaration,
} from './fixtures.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTestRoot));
});

async function makeStore(options: { readonly clock?: () => Date; readonly ttl?: number } = {}) {
  const root = await createTestRoot();
  roots.push(root);
  return new UploadStore({
    rootDirectory: root,
    maximumChunkBytes: 1_024,
    clock: options.clock ?? (() => fixedNow),
    ...(options.ttl === undefined ? {} : { uploadTtlMilliseconds: options.ttl }),
  });
}

describe('UploadStore', () => {
  it('persists resumable chunks only at the exact current offset', async () => {
    const store = await makeStore();
    const bytes = await pngFixture();
    const record = await store.create(uploadDeclaration(bytes));
    const split = Math.floor(bytes.byteLength / 2);
    const first = bytes.slice(0, split);
    const second = bytes.slice(split);

    const afterFirst = await store.append(record.id, 0, first, digestBytes(first));
    expect(afterFirst).toMatchObject({ offset: split, state: 'uploading' });
    await expect(store.append(record.id, 0, second, digestBytes(second))).rejects.toMatchObject({
      code: 'conflict',
    });
    const completed = await store.append(record.id, split, second, digestBytes(second));
    expect(completed).toMatchObject({ offset: bytes.byteLength, state: 'ready' });

    const reloaded = new UploadStore({
      rootDirectory: rootOf(store.dataPath(record.id)),
      maximumChunkBytes: 1_024,
      clock: () => fixedNow,
    });
    expect(await reloaded.read(record.id)).toMatchObject({
      id: record.id,
      offset: bytes.byteLength,
      state: 'ready',
    });
  });

  it('rejects empty, oversized, over-total, and digest-mismatched chunks', async () => {
    const store = await makeStore();
    const bytes = await pngFixture();
    const record = await store.create(uploadDeclaration(bytes));
    await expect(
      store.append(record.id, 0, new Uint8Array(), digestBytes(new Uint8Array())),
    ).rejects.toMatchObject({ code: 'size-limit' });
    const oversized = new Uint8Array(1_025);
    await expect(
      store.append(record.id, 0, oversized, digestBytes(oversized)),
    ).rejects.toMatchObject({ code: 'size-limit' });
    await expect(
      store.append(record.id, 0, bytes, digestBytes(new Uint8Array([1]))),
    ).rejects.toMatchObject({ code: 'chunk-hash-mismatch' });
    const tooLarge = new Uint8Array(bytes.byteLength + 1);
    await expect(store.append(record.id, 0, tooLarge, digestBytes(tooLarge))).rejects.toMatchObject(
      {
        code: 'size-limit',
      },
    );
  });

  it('rolls back bytes written beyond the persisted offset before resuming', async () => {
    const store = await makeStore();
    const bytes = await pngFixture();
    const record = await store.create(uploadDeclaration(bytes));
    const split = Math.floor(bytes.byteLength / 2);
    const first = bytes.slice(0, split);
    const second = bytes.slice(split);
    await store.append(record.id, 0, first, digestBytes(first));
    await appendFile(store.dataPath(record.id), Buffer.from('simulated-crash-tail'));

    const resumed = await store.append(record.id, split, second, digestBytes(second));
    expect(resumed).toMatchObject({ offset: bytes.byteLength, state: 'ready' });
  });

  it('cancels idempotently, removes staged bytes, and blocks completed cancellation', async () => {
    const store = await makeStore();
    const bytes = await pngFixture();
    const record = await store.create(uploadDeclaration(bytes));
    await store.append(record.id, 0, bytes, digestBytes(bytes));
    const cancelled = await store.cancel(record.id);
    expect(cancelled.state).toBe('cancelled');
    await expect(access(store.dataPath(record.id))).rejects.toBeDefined();
    expect((await store.cancel(record.id)).state).toBe('cancelled');

    const another = await store.create(uploadDeclaration(bytes));
    await expect(store.update(another.id, { state: 'completed' })).rejects.toMatchObject({
      code: 'invalid-state',
    });
  });

  it('cleans a bounded number of cancelled, expired, and restart-orphaned records', async () => {
    let now = fixedNow;
    const store = await makeStore({ clock: () => now, ttl: 1_000 });
    const bytes = await pngFixture();
    const cancelled = await store.create(uploadDeclaration(bytes));
    await store.cancel(cancelled.id);
    const expired = await store.create(uploadDeclaration(bytes));
    const processing = await store.create(uploadDeclaration(bytes));
    await store.append(processing.id, 0, bytes, digestBytes(bytes));
    await store.update(processing.id, { state: 'processing' });
    now = new Date(fixedNow.getTime() + 2_000);

    expect(await store.cleanupExpired(1)).toBe(1);
    expect(await store.cleanupExpired(100)).toBe(2);
    await expect(store.read(processing.id)).rejects.toMatchObject({ code: 'not-found' });
    await expect(store.read(expired.id)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects path-like identifiers before touching the filesystem', async () => {
    const store = await makeStore();
    await expect(store.read('../../etc/passwd')).rejects.toBeDefined();
    expect(() => store.dataPath('00000000-0000-0000-0000-000000000000/../../x')).toThrow();
  });

  it('loops on partial positional writes and rejects writers that make no progress', async () => {
    const calls: { offset: number; length: number; position: number }[] = [];
    const partialWriter = {
      write(
        _buffer: Uint8Array,
        offset: number,
        length: number,
        position: number,
      ): Promise<{ bytesWritten: number }> {
        calls.push({ offset, length, position });
        return Promise.resolve({ bytesWritten: Math.min(2, length) });
      },
    };
    await writeAllAtOffset(partialWriter, new Uint8Array([1, 2, 3, 4, 5]), 10);
    expect(calls).toEqual([
      { offset: 0, length: 5, position: 10 },
      { offset: 2, length: 3, position: 12 },
      { offset: 4, length: 1, position: 14 },
    ]);
    await expect(
      writeAllAtOffset(
        {
          write: () => Promise.resolve({ bytesWritten: 0 }),
        },
        new Uint8Array([1]),
        0,
      ),
    ).rejects.toMatchObject({ code: 'invalid-state' });
  });

  it('rejects symbolic-link staging roots and staged-file substitutions', async () => {
    const outer = await createTestRoot();
    roots.push(outer);
    const targetRoot = join(outer, 'target');
    const linkedRoot = join(outer, 'linked');
    await mkdir(targetRoot);
    await symlink(targetRoot, linkedRoot, 'dir');
    const linkedStore = new UploadStore({
      rootDirectory: linkedRoot,
      maximumChunkBytes: 1_024,
      clock: () => fixedNow,
    });
    await expect(linkedStore.initialize()).rejects.toMatchObject({ code: 'invalid-state' });

    const looseRoot = join(outer, 'loose');
    await mkdir(looseRoot, { mode: 0o755 });
    await chmod(looseRoot, 0o755);
    const looseStore = new UploadStore({
      rootDirectory: looseRoot,
      maximumChunkBytes: 1_024,
      clock: () => fixedNow,
    });
    await expect(looseStore.initialize()).rejects.toMatchObject({ code: 'invalid-state' });

    const store = await makeStore();
    const bytes = await pngFixture();
    const record = await store.create(uploadDeclaration(bytes));
    const stagedPath = store.dataPath(record.id);
    const victimPath = join(outer, 'victim.txt');
    await writeFile(victimPath, 'must-not-change');
    await rm(stagedPath);
    await symlink(victimPath, stagedPath);
    await expect(store.append(record.id, 0, bytes, digestBytes(bytes))).rejects.toMatchObject({
      code: 'invalid-state',
    });
    expect(await readFile(victimPath, 'utf8')).toBe('must-not-change');
  });
});

function rootOf(dataPath: string): string {
  return dataPath.slice(0, dataPath.lastIndexOf('/', dataPath.lastIndexOf('/') - 1));
}
