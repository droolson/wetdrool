import { createHash } from 'node:crypto';

export interface MigrationIntegrityRecord {
  readonly version: string;
  readonly checksum: string;
}

export interface AppliedMigrationIntegrityRecord {
  readonly version: string;
  readonly checksum: string | null;
}

export function calculateMigrationChecksum(source: string): string {
  return createHash('sha256').update(source, 'utf8').digest('hex');
}

export function assertMigrationLedgerIntegrity(
  availableMigrations: readonly MigrationIntegrityRecord[],
  appliedMigrations: readonly AppliedMigrationIntegrityRecord[],
  ledgerName: string,
): void {
  if (availableMigrations.length === 0) {
    throw new Error(`${ledgerName} has no packaged migrations; refusing to continue.`);
  }
  for (const [index, available] of availableMigrations.entries()) {
    const previous = availableMigrations[index - 1];
    if (previous !== undefined && previous.version >= available.version) {
      throw new Error(`${ledgerName} packaged migrations must be unique and strictly ordered.`);
    }
    if (!/^[0-9a-f]{64}$/u.test(available.checksum)) {
      throw new Error(`${ledgerName} packaged migration checksums must be lowercase SHA-256.`);
    }
  }
  if (appliedMigrations.length > availableMigrations.length) {
    throw new Error(`${ledgerName} contains migrations beyond the packaged migration set.`);
  }
  for (const [index, applied] of appliedMigrations.entries()) {
    const expected = availableMigrations[index];
    if (expected === undefined || applied.version !== expected.version) {
      throw new Error(
        `${ledgerName} must contain an exact ordered prefix of packaged migrations; gaps, duplicates, and out-of-order rows are refused.`,
      );
    }
    if (applied.checksum === null || applied.checksum === '') {
      throw new Error(
        `${ledgerName} migration ${applied.version} has no checksum; automatic backfill is refused. Verify the applied SQL and repair the ledger explicitly before retrying.`,
      );
    }
    if (applied.checksum !== expected.checksum) {
      throw new Error(
        `${ledgerName} migration ${applied.version} checksum does not match the current SQL; refusing to continue.`,
      );
    }
  }
}
