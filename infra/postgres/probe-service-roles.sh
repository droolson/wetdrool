#!/bin/sh
set -eu

psql_as() {
  probe_user="$1"
  probe_password="$2"
  probe_sql="$3"
  PGPASSWORD="$probe_password" psql \
    --host postgres \
    --username "$probe_user" \
    --dbname "$POSTGRES_DB" \
    --set ON_ERROR_STOP=1 \
    --command "$probe_sql" \
    >/dev/null
}

expect_failure() {
  if psql_as "$1" "$2" "$3" 2>/dev/null; then
    echo "Privilege probe unexpectedly succeeded for $1." >&2
    exit 1
  fi
}

probe_service() {
  runtime_user="$1"
  runtime_password="$2"
  migration_user="$3"
  migration_password="$4"
  own_schema="$5"
  own_ledger="$6"
  other_schema="$7"
  other_ledger="$8"

  psql_as "$runtime_user" "$runtime_password" "SELECT count(*) FROM ${own_schema}.${own_ledger}"
  expect_failure "$runtime_user" "$runtime_password" \
    "CREATE TABLE ${own_schema}.__runtime_must_not_create (id integer)"
  expect_failure "$runtime_user" "$runtime_password" \
    "ALTER TABLE ${own_schema}.${own_ledger} ADD COLUMN __runtime_must_not_alter integer"
  expect_failure "$runtime_user" "$runtime_password" \
    "DROP TABLE ${own_schema}.${own_ledger}"
  expect_failure "$runtime_user" "$runtime_password" \
    "INSERT INTO ${own_schema}.${own_ledger} (version, checksum) VALUES ('9999_runtime_forgery.sql', repeat('0', 64))"
  expect_failure "$runtime_user" "$runtime_password" \
    "UPDATE ${own_schema}.${own_ledger} SET checksum = repeat('0', 64) WHERE false"
  expect_failure "$runtime_user" "$runtime_password" \
    "DELETE FROM ${own_schema}.${own_ledger} WHERE false"
  expect_failure "$runtime_user" "$runtime_password" \
    "SELECT count(*) FROM ${other_schema}.${other_ledger}"

  psql_as "$migration_user" "$migration_password" \
    "CREATE TABLE ${own_schema}.__migration_privilege_probe (id integer)"
  psql_as "$migration_user" "$migration_password" \
    "ALTER TABLE ${own_schema}.__migration_privilege_probe ADD COLUMN checked boolean"
  expect_failure "$migration_user" "$migration_password" \
    "CREATE TABLE ${other_schema}.__cross_service_must_not_create (id integer)"
  expect_failure "$migration_user" "$migration_password" \
    "SELECT count(*) FROM ${other_schema}.${other_ledger}"
  psql_as "$migration_user" "$migration_password" \
    "DROP TABLE ${own_schema}.__migration_privilege_probe"
}

probe_service \
  wokesocial_auth_runtime "$AUTH_DATABASE_RUNTIME_PASSWORD" \
  wokesocial_auth_migration "$AUTH_DATABASE_MIGRATION_PASSWORD" \
  wokesocial_auth auth_schema_migrations \
  wokesocial_indexer schema_migrations

probe_service \
  wokesocial_indexer_runtime "$INDEXER_DATABASE_RUNTIME_PASSWORD" \
  wokesocial_indexer_migration "$INDEXER_DATABASE_MIGRATION_PASSWORD" \
  wokesocial_indexer schema_migrations \
  wokesocial_moderation moderation_schema_migrations

psql_as \
  wokesocial_indexer_runtime "$INDEXER_DATABASE_RUNTIME_PASSWORD" \
  "INSERT INTO wokesocial_indexer.protocol_events (
     network_id, transaction_signature, transaction_index, log_index, slot,
     block_time, event_type, event_body
   ) VALUES (
     '__privilege_probe_network', '__privilege_probe_transaction', 0, 0, 0,
     '2026-07-28T00:00:00.000Z', 'protocol-initialized', '{}'::jsonb
   )"
expect_failure \
  wokesocial_indexer_runtime "$INDEXER_DATABASE_RUNTIME_PASSWORD" \
  "UPDATE wokesocial_indexer.protocol_events
   SET event_body = '{\"forged\":true}'::jsonb
   WHERE network_id = '__privilege_probe_network'"
expect_failure \
  wokesocial_indexer_runtime "$INDEXER_DATABASE_RUNTIME_PASSWORD" \
  "DELETE FROM wokesocial_indexer.protocol_events
   WHERE network_id = '__privilege_probe_network'"
expect_failure \
  wokesocial_indexer_runtime "$INDEXER_DATABASE_RUNTIME_PASSWORD" \
  "INSERT INTO wokesocial_indexer.protocol_events (
     network_id, transaction_signature, transaction_index, log_index, slot,
     block_time, event_type, event_body
   ) VALUES (
     '__privilege_probe_network', '__privilege_probe_transaction', 0, 0, 0,
     '2026-07-28T00:00:00.000Z', 'protocol-initialized',
     '{\"reinserted\":true}'::jsonb
   )"
psql_as \
  wokesocial_indexer_migration "$INDEXER_DATABASE_MIGRATION_PASSWORD" \
  "DELETE FROM wokesocial_indexer.protocol_events
   WHERE network_id = '__privilege_probe_network'"

probe_service \
  wokesocial_moderation_runtime "$MODERATION_DATABASE_RUNTIME_PASSWORD" \
  wokesocial_moderation_migration "$MODERATION_DATABASE_MIGRATION_PASSWORD" \
  wokesocial_moderation moderation_schema_migrations \
  wokesocial_auth auth_schema_migrations

expect_failure \
  wokesocial_moderation_runtime "$MODERATION_DATABASE_RUNTIME_PASSWORD" \
  "DELETE FROM wokesocial_moderation.moderation_cases WHERE false"
psql_as \
  wokesocial_moderation_runtime "$MODERATION_DATABASE_RUNTIME_PASSWORD" \
  "UPDATE wokesocial_moderation.moderation_cases SET updated_at = updated_at WHERE false"
psql_as \
  wokesocial_moderation_runtime "$MODERATION_DATABASE_RUNTIME_PASSWORD" \
  "SELECT object_id FROM wokesocial_moderation.moderation_public_objects WHERE false FOR UPDATE"

psql_as \
  wokesocial_moderation_migration "$MODERATION_DATABASE_MIGRATION_PASSWORD" \
  "INSERT INTO wokesocial_moderation.moderation_public_objects (
     object_id, cid, canonical_bytes, author_id, subject_key, received_at
   ) VALUES (
     '__privilege_probe_public_object', 'bafk-probe', decode('00', 'hex'),
     'probe-author', 'probe-subject', now()
   )"
expect_failure \
  wokesocial_moderation_runtime "$MODERATION_DATABASE_RUNTIME_PASSWORD" \
  "UPDATE wokesocial_moderation.moderation_public_objects
   SET canonical_bytes = decode('01', 'hex')
   WHERE object_id = '__privilege_probe_public_object'"
psql_as \
  wokesocial_moderation_migration "$MODERATION_DATABASE_MIGRATION_PASSWORD" \
  "SELECT set_config('wokesocial.retention_delete', 'on', false);
   DELETE FROM wokesocial_moderation.moderation_public_objects
   WHERE object_id = '__privilege_probe_public_object'"

retention_function_count="$(
  PGPASSWORD="$MODERATION_DATABASE_RUNTIME_PASSWORD" psql \
    --host postgres \
    --username wokesocial_moderation_runtime \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command "
      SELECT count(*)
      FROM pg_proc AS procedure
      JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'wokesocial_moderation'
        AND procedure.proname = 'moderation_apply_retention'
    "
)"
if [ "$retention_function_count" != "0" ]; then
  echo 'A runtime-callable moderation retention function unexpectedly exists.' >&2
  exit 1
fi

role_policy_violation_count="$(
  PGPASSWORD="$AUTH_DATABASE_RUNTIME_PASSWORD" psql \
    --host postgres \
    --username wokesocial_auth_runtime \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command "
      WITH service_roles(role_name) AS (
        VALUES
          ('wokesocial_auth_runtime'),
          ('wokesocial_auth_migration'),
          ('wokesocial_indexer_runtime'),
          ('wokesocial_indexer_migration'),
          ('wokesocial_moderation_runtime'),
          ('wokesocial_moderation_migration')
      )
      SELECT
        (
          SELECT count(*)
          FROM pg_roles AS role
          JOIN service_roles ON service_roles.role_name = role.rolname
          WHERE role.rolsuper
             OR role.rolinherit
             OR role.rolcreaterole
             OR role.rolcreatedb
             OR role.rolreplication
             OR role.rolbypassrls
             OR NOT role.rolcanlogin
        )
        +
        (
          SELECT count(*)
          FROM pg_auth_members AS membership
          JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
          JOIN pg_roles AS member_role ON member_role.oid = membership.member
          WHERE granted_role.rolname IN (SELECT role_name FROM service_roles)
             OR member_role.rolname IN (SELECT role_name FROM service_roles)
        )
    "
)"
if [ "$role_policy_violation_count" != "0" ]; then
  echo 'PostgreSQL service-role attributes or memberships are overprivileged.' >&2
  exit 1
fi

extension_count="$(
  PGPASSWORD="$INDEXER_DATABASE_MIGRATION_PASSWORD" psql \
    --host postgres \
    --username wokesocial_indexer_migration \
    --dbname "$POSTGRES_DB" \
    --tuples-only \
    --no-align \
    --command "
      SELECT count(*)
      FROM pg_extension
      WHERE extname IN ('pg_trgm', 'btree_gin')
        AND extnamespace = 'wokesocial_indexer'::regnamespace
    "
)"
if [ "$extension_count" != "2" ]; then
  echo 'Required indexer extensions are not isolated in wokesocial_indexer.' >&2
  exit 1
fi

echo 'PostgreSQL service-role privilege probes passed.'
