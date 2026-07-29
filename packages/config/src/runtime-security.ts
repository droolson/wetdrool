const privilegedDatabaseCredentialName =
  /(?:^|_)DATABASE_MIGRATION_(?:PASSWORD|URL)$|(?:^|_)DATABASE_RUNTIME_PASSWORD$/u;
const runtimeDatabaseUrlName = /(?:^|_)DATABASE_URL$/u;
const privilegedPostgresCredentialNames = new Set([
  'PGPASSWORD',
  'PGPASSFILE',
  'POSTGRES_PASSWORD',
  'POSTGRES_PASSWORD_FILE',
]);

/**
 * Long-running services must never inherit DDL, bootstrap, or raw role
 * credentials from a shared secret bundle. They receive only their scoped
 * runtime connection URL.
 */
export function assertNoMigrationCredentials(
  environment: Readonly<Record<string, string | undefined>>,
  options: Readonly<{ allowedRuntimeUrls?: readonly string[] }> = {},
): void {
  const allowedRuntimeUrls = new Set(options.allowedRuntimeUrls ?? []);
  const hasPrivilegedCredential = Object.entries(environment).some(
    ([name, value]) =>
      (privilegedDatabaseCredentialName.test(name) ||
        privilegedPostgresCredentialNames.has(name) ||
        (runtimeDatabaseUrlName.test(name) && !allowedRuntimeUrls.has(name))) &&
      value?.trim(),
  );
  if (hasPrivilegedCredential) {
    throw new Error(
      'Privileged database credentials must not be injected into a long-running service.',
    );
  }
}
