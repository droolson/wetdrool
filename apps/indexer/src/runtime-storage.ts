import { constants } from 'node:fs';
import { access, opendir, stat } from 'node:fs/promises';

export async function assertReadableContentStorage(rootDirectory: string): Promise<void> {
  try {
    const metadata = await stat(rootDirectory);
    if (!metadata.isDirectory()) {
      throw new Error('Configured content storage path is not a directory.');
    }
    await access(rootDirectory, constants.R_OK | constants.X_OK);
    const directory = await opendir(rootDirectory);
    await directory.close();
  } catch (error) {
    throw new Error('Indexer content storage must be an existing readable mounted directory.', {
      cause: error,
    });
  }
}
