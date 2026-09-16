-- UA-002 provider staging: the one privileged session the direct-TLS run needs.
--
-- Run this ONCE, as a privileged role (on Supabase, `postgres`), against the
-- Alpha Lab project database. It does the three things `df_migration` cannot do
-- for itself, because that role is NOCREATEROLE and not a superuser:
--
--   1. repairs durable search_path settings on every df_* role,
--   2. creates df_ingestion in the shape its five siblings already have,
--   3. marks df_migration as a LOGIN role.
--
-- It deliberately does NOT set a password. That value must come from the
-- provider's secure credential path, must never be pasted into a chat, a file,
-- a shell history or a log, and is the one step this script leaves to you.
--
-- Scope: only df_* roles, only this database, only the grants listed. It touches
-- no application data, no other schema, and no other role. It is idempotent —
-- running it twice is a no-op — and it is a single DO block, so a failure part
-- way through rolls the whole thing back.
--
-- Afterwards, run the read-only preflight and expect zero blockers:
--   pnpm ua002:operator -- --packet <manifest.json>

DO $ua002_provider_staging$
DECLARE
  role_name       text;
  database_name   text := current_database();
  canonical_path  text := 'data_foundry, pg_catalog, extensions';
  all_roles       text[] := ARRAY[
    'df_migration', 'df_edge', 'df_web', 'df_mcp',
    'df_usage', 'df_acquisition', 'df_ingestion'
  ];
BEGIN
  -- 1. The sixth runtime identity, matching its siblings exactly.
  --
  -- NOINHERIT and NOLOGIN are not decoration: the runtime roles are staged
  -- without a credential and gain their capabilities only from the grant
  -- upgrade, so anything this step grants beyond CONNECT and extensions USAGE
  -- is a privilege nobody reviewed.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'df_ingestion') THEN
    CREATE ROLE df_ingestion
      NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS
      CONNECTION LIMIT -1;
    RAISE NOTICE 'created role df_ingestion';
  ELSE
    RAISE NOTICE 'role df_ingestion already exists; leaving it as it is';
  END IF;

  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO df_ingestion',
    database_name
  );
  EXECUTE 'GRANT USAGE ON SCHEMA extensions TO df_ingestion';

  -- 2. Durable settings.
  --
  -- The release forbids the all-databases form (`setdatabase = 0`) because such
  -- a setting follows the role into every other database on the instance, and
  -- requires exactly one row scoped to this database instead. Every df_* role
  -- currently has it the wrong way round, which the grant packet raises on —
  -- after the migrations would already have applied.
  FOREACH role_name IN ARRAY all_roles LOOP
    EXECUTE format('ALTER ROLE %I RESET search_path', role_name);
    EXECUTE format(
      'ALTER ROLE %I IN DATABASE %I SET search_path = %s',
      role_name, database_name, canonical_path
    );
  END LOOP;

  -- 3. The migration identity may log in. The password is set separately,
  -- through the provider's secure credential path, and is not this script's
  -- business.
  EXECUTE 'ALTER ROLE df_migration LOGIN';

  -- Refuse to report success on a state the release would reject.
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_db_role_setting setting
      JOIN pg_catalog.pg_roles role ON role.oid = setting.setrole
     WHERE role.rolname = ANY(all_roles)
       AND setting.setdatabase = 0
  ) THEN
    RAISE EXCEPTION 'A df_* role still carries an all-databases setting.';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_catalog.pg_roles role
      JOIN pg_catalog.pg_db_role_setting setting
        ON setting.setrole = role.oid
       AND setting.setdatabase = (SELECT oid FROM pg_catalog.pg_database WHERE datname = database_name)
     WHERE role.rolname = ANY(all_roles)
       AND setting.setconfig = ARRAY['search_path=' || canonical_path]::text[]
  ) <> array_length(all_roles, 1) THEN
    RAISE EXCEPTION 'Not every df_* role carries exactly the canonical current-database search_path.';
  END IF;

  RAISE NOTICE 'UA-002 provider staging complete for % roles in database %',
    array_length(all_roles, 1), database_name;
END
$ua002_provider_staging$;

-- Verification. Both counts must be zero, and the third must be 7.
SELECT
  (SELECT count(*)
     FROM pg_catalog.pg_db_role_setting setting
     JOIN pg_catalog.pg_roles role ON role.oid = setting.setrole
    WHERE role.rolname LIKE 'df\_%'
      AND setting.setdatabase = 0)                                   AS role_global_settings_remaining,
  (SELECT count(*)
     FROM pg_catalog.pg_roles role
    WHERE role.rolname LIKE 'df\_%'
      AND (role.rolsuper OR role.rolcreatedb OR role.rolcreaterole
           OR role.rolreplication OR role.rolbypassrls OR role.rolinherit)) AS privileged_or_inheriting_roles,
  (SELECT count(*)
     FROM pg_catalog.pg_roles role
    WHERE role.rolname LIKE 'df\_%')                                 AS df_roles_present;
