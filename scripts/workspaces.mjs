import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export async function readWorkspacePackages() {
  const manifests = [];

  for (const group of ['apps', 'packages']) {
    const groupDirectory = join(repositoryRoot, group);
    let entries;

    try {
      entries = await readdir(groupDirectory, { withFileTypes: true });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const manifestPath = join(groupDirectory, entry.name, 'package.json');
      try {
        const source = await readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(source);
        manifests.push({
          directory: dirname(manifestPath),
          manifest,
          manifestPath,
        });
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
          continue;
        }
        throw new Error(`Unable to read ${manifestPath}`, { cause: error });
      }
    }
  }

  return manifests.sort((left, right) => left.manifestPath.localeCompare(right.manifestPath));
}
