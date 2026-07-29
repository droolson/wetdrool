import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { describe, it } from 'node:test';

const composeUrl = new URL('../../infra/compose.yaml', import.meta.url);
const provisionUrl = new URL('../../infra/postgres/provision-service-roles.sql', import.meta.url);
const probeUrl = new URL('../../infra/postgres/probe-service-roles.sh', import.meta.url);
const infraScriptUrl = new URL('../infra.mjs', import.meta.url);

describe('local PostgreSQL service-role isolation', () => {
  it('fails before provisioning when a legacy public-schema volume contains objects', async () => {
    const source = await readFile(provisionUrl, 'utf8');
    const preflight = source.indexOf('DO $wokesocial_legacy_public_preflight$');
    const roleCreation = source.indexOf('CREATE ROLE wokesocial_auth_runtime');
    const schemaCreation = source.indexOf('CREATE SCHEMA IF NOT EXISTS wokesocial_auth');
    assert.ok(preflight >= 0 && preflight < roleCreation && preflight < schemaCreation);
    assert.match(source, /namespace\.nspname = 'public'/u);
    assert.match(source, /FROM pg_class/u);
    assert.match(source, /FROM pg_proc/u);
    assert.match(source, /FROM pg_type/u);
    assert.match(source, /Automatic parallel schema creation is refused/u);
    assert.match(source, /legacy-public-schema-volume-upgrade-or-reset/u);
  });

  it('isolates trusted extensions and probes DDL, cross-schema, and ledger-write denial', async () => {
    const [provision, probe] = await Promise.all([
      readFile(provisionUrl, 'utf8'),
      readFile(probeUrl, 'utf8'),
    ]);
    assert.match(
      provision,
      /CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA wokesocial_indexer/u,
    );
    assert.match(
      provision,
      /CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA wokesocial_indexer/u,
    );
    assert.doesNotMatch(provision, /GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA/u);
    assert.match(provision, /GRANT SELECT, INSERT ON TABLES TO wokesocial_moderation_runtime/u);
    assert.doesNotMatch(
      provision,
      /GRANT SELECT, INSERT, UPDATE ON TABLES TO wokesocial_moderation_runtime/u,
    );
    assert.match(
      provision,
      /REVOKE DELETE ON ALL TABLES IN SCHEMA wokesocial_moderation\s+FROM wokesocial_moderation_runtime/u,
    );
    assert.match(
      provision,
      /REVOKE UPDATE ON ALL TABLES IN SCHEMA wokesocial_moderation\s+FROM wokesocial_moderation_runtime/u,
    );
    assert.match(provision, /GRANT UPDATE ON TABLE %I\.%I TO wokesocial_moderation_runtime/u);
    for (const role of [
      'wokesocial_auth_runtime',
      'wokesocial_auth_migration',
      'wokesocial_indexer_runtime',
      'wokesocial_indexer_migration',
      'wokesocial_moderation_runtime',
      'wokesocial_moderation_migration',
    ]) {
      assert.match(
        provision,
        new RegExp(
          `ALTER ROLE ${role}[\\s\\S]*?NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS`,
          'u',
        ),
      );
    }
    assert.match(provision, /FROM pg_auth_members AS membership/u);
    assert.match(provision, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA/u);
    assert.match(provision, /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA/u);
    assert.match(provision, /REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA/u);
    for (const [schema, ledger, runtimeRole] of [
      ['wokesocial_auth', 'auth_schema_migrations', 'wokesocial_auth_runtime'],
      ['wokesocial_indexer', 'schema_migrations', 'wokesocial_indexer_runtime'],
      ['wokesocial_moderation', 'moderation_schema_migrations', 'wokesocial_moderation_runtime'],
    ]) {
      assert.match(provision, new RegExp(`namespace\\.nspname = '${schema}'`, 'u'));
      assert.match(provision, new RegExp(`class\\.relname <> '${ledger}'`, 'u'));
      assert.match(
        provision,
        new RegExp(`REVOKE INSERT, UPDATE, DELETE ON TABLE %I\\.%I FROM ${runtimeRole}`, 'u'),
      );
    }
    for (const statement of [
      'CREATE TABLE',
      'ALTER TABLE',
      'DROP TABLE',
      'INSERT INTO',
      'UPDATE',
    ]) {
      assert.match(probe, new RegExp(`expect_failure[^]*${statement}`, 'u'));
    }
    assert.match(probe, /DELETE FROM \$\{own_schema\}\.\$\{own_ledger\}/u);
    assert.match(probe, /DELETE FROM wokesocial_moderation\.moderation_cases WHERE false/u);
    assert.match(probe, /role_policy_violation_count/u);
    assert.match(probe, /role\.rolsuper/u);
    assert.match(probe, /FROM pg_auth_members AS membership/u);
    assert.match(probe, /__cross_service_must_not_create/u);
    assert.match(probe, /extnamespace = 'wokesocial_indexer'::regnamespace/u);
  });

  it('loads role passwords from the provisioner environment instead of process arguments', async () => {
    const [compose, provision] = await Promise.all([
      readFile(composeUrl, 'utf8'),
      readFile(provisionUrl, 'utf8'),
    ]);
    assert.doesNotMatch(compose, /--set=[a-z_]*password=/u);
    for (const name of [
      'AUTH_DATABASE_MIGRATION_PASSWORD',
      'AUTH_DATABASE_RUNTIME_PASSWORD',
      'INDEXER_DATABASE_MIGRATION_PASSWORD',
      'INDEXER_DATABASE_RUNTIME_PASSWORD',
      'MODERATION_DATABASE_MIGRATION_PASSWORD',
      'MODERATION_DATABASE_RUNTIME_PASSWORD',
    ]) {
      assert.match(provision, new RegExp(`\\\\getenv [a-z_]+ ${name}`, 'u'));
    }
  });

  it('wires scoped role URLs and explicit local service modes in Compose', async () => {
    const compose = await readFile(composeUrl, 'utf8');
    for (const role of [
      'wokesocial_auth_runtime',
      'wokesocial_auth_migration',
      'wokesocial_indexer_runtime',
      'wokesocial_indexer_migration',
      'wokesocial_moderation_runtime',
      'wokesocial_moderation_migration',
    ]) {
      assert.match(compose, new RegExp(`postgresql://${role}:`, 'u'));
    }
    assert.doesNotMatch(
      compose,
      /(?:AUTH_DATABASE_URL|DATABASE_URL|MODERATION_DATABASE_URL): postgresql:\/\/\$\{POSTGRES_USER/u,
    );
    for (const prefix of ['FEED_SERVICE', 'MEDIA_WORKER', 'RELAY']) {
      assert.match(compose, new RegExp(`APP_ENV: \\$\\{${prefix}_APP_ENV:-development\\}`, 'u'));
      assert.match(compose, new RegExp(`NODE_ENV: \\$\\{${prefix}_NODE_ENV:-development\\}`, 'u'));
    }
  });

  it('runs privilege probes explicitly after all three foreground migrators', async () => {
    const source = await readFile(infraScriptUrl, 'utf8');
    const provision = source.indexOf("'postgres-provision'");
    const migrators = source.indexOf('for (const migrator of [');
    const probe = source.indexOf("'postgres-privilege-probe'");
    const finalUp = source.lastIndexOf('...actionArgs');
    assert.ok(provision >= 0 && provision < migrators && migrators < probe && probe < finalUp);
    assert.match(source, /profiles\.filter\(\(profile\) => profile !== 'privilege-probe'\)/u);
    assert.match(source, /'run',\s*'--rm',\s*'--no-deps',\s*'--build',\s*migrator/u);
  });
});
