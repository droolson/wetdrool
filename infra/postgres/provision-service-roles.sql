\set ON_ERROR_STOP on
\getenv auth_runtime_password AUTH_DATABASE_RUNTIME_PASSWORD
\getenv auth_migration_password AUTH_DATABASE_MIGRATION_PASSWORD
\getenv database_name POSTGRES_DB
\getenv indexer_runtime_password INDEXER_DATABASE_RUNTIME_PASSWORD
\getenv indexer_migration_password INDEXER_DATABASE_MIGRATION_PASSWORD
\getenv moderation_runtime_password MODERATION_DATABASE_RUNTIME_PASSWORD
\getenv moderation_migration_password MODERATION_DATABASE_MIGRATION_PASSWORD

DO $wokesocial_legacy_public_preflight$
DECLARE
  legacy_object_count bigint;
BEGIN
  SELECT count(*)
  INTO legacy_object_count
  FROM (
    SELECT class.oid
    FROM pg_class AS class
    JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
    WHERE namespace.nspname = 'public'
      AND class.relkind IN ('r', 'p', 'S', 'v', 'm', 'f')
    UNION ALL
    SELECT procedure.oid
    FROM pg_proc AS procedure
    JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
    UNION ALL
    SELECT type.oid
    FROM pg_type AS type
    JOIN pg_namespace AS namespace ON namespace.oid = type.typnamespace
    WHERE namespace.nspname = 'public'
      AND type.typtype IN ('d', 'e')
  ) AS legacy_objects;

  IF legacy_object_count > 0 THEN
    RAISE EXCEPTION
      'Legacy public-schema objects detected. Automatic parallel schema creation is refused; follow docs/OPERATIONS.md#legacy-public-schema-volume-upgrade-or-reset.';
  END IF;
END
$wokesocial_legacy_public_preflight$;

SELECT 'CREATE ROLE wokesocial_auth_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wokesocial_auth_runtime')
\gexec
SELECT 'CREATE ROLE wokesocial_auth_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wokesocial_auth_migration')
\gexec
SELECT 'CREATE ROLE wokesocial_indexer_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wokesocial_indexer_runtime')
\gexec
SELECT 'CREATE ROLE wokesocial_indexer_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wokesocial_indexer_migration')
\gexec
SELECT 'CREATE ROLE wokesocial_moderation_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wokesocial_moderation_runtime')
\gexec
SELECT 'CREATE ROLE wokesocial_moderation_migration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'wokesocial_moderation_migration')
\gexec

ALTER ROLE wokesocial_auth_runtime
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE wokesocial_auth_migration
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE wokesocial_indexer_runtime
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE wokesocial_indexer_migration
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE wokesocial_moderation_runtime
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;
ALTER ROLE wokesocial_moderation_migration
  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;

SELECT format('REVOKE %I FROM %I', granted_role.rolname, member_role.rolname)
FROM pg_auth_members AS membership
JOIN pg_roles AS granted_role ON granted_role.oid = membership.roleid
JOIN pg_roles AS member_role ON member_role.oid = membership.member
WHERE granted_role.rolname IN (
    'wokesocial_auth_runtime',
    'wokesocial_auth_migration',
    'wokesocial_indexer_runtime',
    'wokesocial_indexer_migration',
    'wokesocial_moderation_runtime',
    'wokesocial_moderation_migration'
  )
  OR member_role.rolname IN (
    'wokesocial_auth_runtime',
    'wokesocial_auth_migration',
    'wokesocial_indexer_runtime',
    'wokesocial_indexer_migration',
    'wokesocial_moderation_runtime',
    'wokesocial_moderation_migration'
  )
\gexec

ALTER ROLE wokesocial_auth_runtime PASSWORD :'auth_runtime_password';
ALTER ROLE wokesocial_auth_migration PASSWORD :'auth_migration_password';
ALTER ROLE wokesocial_indexer_runtime PASSWORD :'indexer_runtime_password';
ALTER ROLE wokesocial_indexer_migration PASSWORD :'indexer_migration_password';
ALTER ROLE wokesocial_moderation_runtime PASSWORD :'moderation_runtime_password';
ALTER ROLE wokesocial_moderation_migration PASSWORD :'moderation_migration_password';

REVOKE ALL ON DATABASE :"database_name" FROM PUBLIC;
REVOKE ALL ON DATABASE :"database_name" FROM
  wokesocial_auth_runtime,
  wokesocial_auth_migration,
  wokesocial_indexer_runtime,
  wokesocial_indexer_migration,
  wokesocial_moderation_runtime,
  wokesocial_moderation_migration;
GRANT CONNECT ON DATABASE :"database_name" TO
  wokesocial_auth_runtime,
  wokesocial_auth_migration,
  wokesocial_indexer_runtime,
  wokesocial_indexer_migration,
  wokesocial_moderation_runtime,
  wokesocial_moderation_migration;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS wokesocial_auth AUTHORIZATION wokesocial_auth_migration;
CREATE SCHEMA IF NOT EXISTS wokesocial_indexer AUTHORIZATION wokesocial_indexer_migration;
CREATE SCHEMA IF NOT EXISTS wokesocial_moderation AUTHORIZATION wokesocial_moderation_migration;
ALTER SCHEMA wokesocial_auth OWNER TO wokesocial_auth_migration;
ALTER SCHEMA wokesocial_indexer OWNER TO wokesocial_indexer_migration;
ALTER SCHEMA wokesocial_moderation OWNER TO wokesocial_moderation_migration;
REVOKE ALL ON SCHEMA wokesocial_auth, wokesocial_indexer, wokesocial_moderation FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA wokesocial_indexer;
CREATE EXTENSION IF NOT EXISTS btree_gin WITH SCHEMA wokesocial_indexer;

DO $wokesocial_normalize_service_acls$
DECLARE
  service_roles CONSTANT text[] := ARRAY[
    'wokesocial_auth_runtime',
    'wokesocial_auth_migration',
    'wokesocial_indexer_runtime',
    'wokesocial_indexer_migration',
    'wokesocial_moderation_runtime',
    'wokesocial_moderation_migration'
  ];
  policy record;
  role_name text;
BEGIN
  FOR policy IN
    SELECT *
    FROM (
      VALUES
        ('wokesocial_auth', 'wokesocial_auth_migration'),
        ('wokesocial_indexer', 'wokesocial_indexer_migration'),
        ('wokesocial_moderation', 'wokesocial_moderation_migration')
    ) AS policies(schema_name, owner_role)
  LOOP
    FOREACH role_name IN ARRAY service_roles
    LOOP
      IF role_name <> policy.owner_role THEN
        EXECUTE format(
          'REVOKE ALL ON SCHEMA %I FROM %I',
          policy.schema_name,
          role_name
        );
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA %I FROM %I',
          policy.schema_name,
          role_name
        );
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA %I FROM %I',
          policy.schema_name,
          role_name
        );
        EXECUTE format(
          'REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA %I FROM %I',
          policy.schema_name,
          role_name
        );
      END IF;
    END LOOP;
  END LOOP;
END
$wokesocial_normalize_service_acls$;

GRANT USAGE ON SCHEMA wokesocial_auth TO wokesocial_auth_runtime;
GRANT USAGE ON SCHEMA wokesocial_indexer TO wokesocial_indexer_runtime;
GRANT USAGE ON SCHEMA wokesocial_moderation TO wokesocial_moderation_runtime;

ALTER ROLE wokesocial_auth_runtime IN DATABASE :"database_name"
  SET search_path TO wokesocial_auth, pg_catalog;
ALTER ROLE wokesocial_auth_migration IN DATABASE :"database_name"
  SET search_path TO wokesocial_auth, pg_catalog;
ALTER ROLE wokesocial_indexer_runtime IN DATABASE :"database_name"
  SET search_path TO wokesocial_indexer, pg_catalog;
ALTER ROLE wokesocial_indexer_migration IN DATABASE :"database_name"
  SET search_path TO wokesocial_indexer, pg_catalog;
ALTER ROLE wokesocial_moderation_runtime IN DATABASE :"database_name"
  SET search_path TO wokesocial_moderation, pg_catalog;
ALTER ROLE wokesocial_moderation_migration IN DATABASE :"database_name"
  SET search_path TO wokesocial_moderation, pg_catalog;

DO $wokesocial_normalize_default_acls$
DECLARE
  service_roles CONSTANT text[] := ARRAY[
    'wokesocial_auth_runtime',
    'wokesocial_auth_migration',
    'wokesocial_indexer_runtime',
    'wokesocial_indexer_migration',
    'wokesocial_moderation_runtime',
    'wokesocial_moderation_migration'
  ];
  object_kind text;
  policy record;
  role_name text;
BEGIN
  FOR policy IN
    SELECT *
    FROM (
      VALUES
        ('wokesocial_auth', 'wokesocial_auth_migration'),
        ('wokesocial_indexer', 'wokesocial_indexer_migration'),
        ('wokesocial_moderation', 'wokesocial_moderation_migration')
    ) AS policies(schema_name, owner_role)
  LOOP
    FOREACH object_kind IN ARRAY ARRAY['TABLES', 'SEQUENCES', 'FUNCTIONS']
    LOOP
      EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON %s FROM PUBLIC',
        policy.owner_role,
        policy.schema_name,
        object_kind
      );
      FOREACH role_name IN ARRAY service_roles
      LOOP
        IF role_name <> policy.owner_role THEN
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA %I REVOKE ALL ON %s FROM %I',
            policy.owner_role,
            policy.schema_name,
            object_kind,
            role_name
          );
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END
$wokesocial_normalize_default_acls$;

ALTER DEFAULT PRIVILEGES FOR ROLE wokesocial_auth_migration IN SCHEMA wokesocial_auth
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wokesocial_auth_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE wokesocial_auth_migration IN SCHEMA wokesocial_auth
  GRANT USAGE, SELECT ON SEQUENCES TO wokesocial_auth_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE wokesocial_indexer_migration IN SCHEMA wokesocial_indexer
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO wokesocial_indexer_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE wokesocial_indexer_migration IN SCHEMA wokesocial_indexer
  GRANT USAGE, SELECT ON SEQUENCES TO wokesocial_indexer_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE wokesocial_moderation_migration IN SCHEMA wokesocial_moderation
  GRANT SELECT, INSERT ON TABLES TO wokesocial_moderation_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE wokesocial_moderation_migration IN SCHEMA wokesocial_moderation
  GRANT USAGE, SELECT ON SEQUENCES TO wokesocial_moderation_runtime;

SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO wokesocial_auth_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_auth'
  AND class.relkind IN ('r', 'p')
  AND class.relname <> 'auth_schema_migrations'
\gexec
SELECT format(
  'GRANT SELECT ON TABLE %I.%I TO wokesocial_auth_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_auth'
  AND class.relname = 'auth_schema_migrations'
\gexec
SELECT format(
  'REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM wokesocial_auth_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_auth'
  AND class.relname = 'auth_schema_migrations'
\gexec
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA wokesocial_auth
  TO wokesocial_auth_runtime;
SELECT format(
  'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I.%I TO wokesocial_indexer_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_indexer'
  AND class.relkind IN ('r', 'p')
  AND class.relname <> 'schema_migrations'
\gexec
SELECT format(
  'GRANT SELECT ON TABLE %I.%I TO wokesocial_indexer_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_indexer'
  AND class.relname = 'schema_migrations'
\gexec
SELECT format(
  'REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM wokesocial_indexer_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_indexer'
  AND class.relname = 'schema_migrations'
\gexec
SELECT format(
  'REVOKE UPDATE, DELETE ON TABLE %I.%I FROM wokesocial_indexer_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_indexer'
  AND class.relkind IN ('r', 'p')
  AND class.relname = 'protocol_events'
\gexec
SELECT format(
  'GRANT EXECUTE ON FUNCTION %I.%I(%s) TO wokesocial_indexer_runtime',
  namespace.nspname,
  procedure.proname,
  pg_get_function_identity_arguments(procedure.oid)
)
FROM pg_proc AS procedure
JOIN pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname = 'wokesocial_indexer'
  AND procedure.proname IN (
    'accept_pending_manifest_event',
    'reject_pending_manifest_event'
  )
\gexec
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA wokesocial_indexer
  TO wokesocial_indexer_runtime;
SELECT format(
  'GRANT SELECT, INSERT ON TABLE %I.%I TO wokesocial_moderation_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_moderation'
  AND class.relkind IN ('r', 'p')
  AND class.relname <> 'moderation_schema_migrations'
\gexec
REVOKE DELETE ON ALL TABLES IN SCHEMA wokesocial_moderation
  FROM wokesocial_moderation_runtime;
REVOKE UPDATE ON ALL TABLES IN SCHEMA wokesocial_moderation
  FROM wokesocial_moderation_runtime;
SELECT format(
  'GRANT UPDATE ON TABLE %I.%I TO wokesocial_moderation_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_moderation'
  AND class.relname IN (
    'moderation_cases',
    'moderation_public_objects',
    'moderation_restricted_objects',
    'moderation_actions'
  )
\gexec
SELECT format(
  'GRANT SELECT ON TABLE %I.%I TO wokesocial_moderation_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_moderation'
  AND class.relname = 'moderation_schema_migrations'
\gexec
SELECT format(
  'REVOKE INSERT, UPDATE, DELETE ON TABLE %I.%I FROM wokesocial_moderation_runtime',
  namespace.nspname,
  class.relname
)
FROM pg_class AS class
JOIN pg_namespace AS namespace ON namespace.oid = class.relnamespace
WHERE namespace.nspname = 'wokesocial_moderation'
  AND class.relname = 'moderation_schema_migrations'
\gexec
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA wokesocial_moderation
  TO wokesocial_moderation_runtime;
