import pg from 'pg';
import { isMain } from '../lib/cli-entry.js';

const ROLE_URLS = {
  df_edge: 'DATA_FOUNDRY_EDGE_POSTGRES_URL',
  df_web: 'DATA_FOUNDRY_WEB_POSTGRES_URL',
  df_mcp: 'DATA_FOUNDRY_MCP_POSTGRES_URL',
  df_usage: 'DATA_FOUNDRY_USAGE_POSTGRES_URL',
  df_acquisition: 'DATA_FOUNDRY_ACQUISITION_POSTGRES_URL',
} as const;

type RuntimeRole = keyof typeof ROLE_URLS;
interface Connection {
  connect(): Promise<unknown>;
  query(sql: string, values: readonly unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  end(): Promise<void>;
}
type ConnectionFactory = (connectionString: string, role: RuntimeRole) => Promise<Connection>;

const PROBE_SQL = `
SELECT current_user = $1 AND session_user = $1 AS direct_login,
       EXISTS (
         SELECT 1 FROM pg_roles r WHERE r.rolname = $1 AND r.rolcanlogin
           AND NOT r.rolsuper AND NOT r.rolcreatedb AND NOT r.rolcreaterole
           AND NOT r.rolreplication AND NOT r.rolbypassrls
       ) AS role_is_login_nonprivileged,
       NOT EXISTS (
         SELECT 1 FROM pg_auth_members m
          WHERE m.member = (SELECT oid FROM pg_roles WHERE rolname = $1)
             OR m.roleid = (SELECT oid FROM pg_roles WHERE rolname = $1)
       ) AS membership_is_empty,
       current_setting('search_path') = 'data_foundry, pg_catalog, extensions'
       AND current_schemas(false) = ARRAY['data_foundry', 'pg_catalog', 'extensions']::name[]
         AS search_path_is_exact,
       (
         SELECT count(*) = 1
           FROM pg_db_role_setting setting
          WHERE setting.setrole = (SELECT oid FROM pg_roles WHERE rolname = $1)
            AND setting.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())
            AND 'search_path=data_foundry, pg_catalog, extensions' = ANY(setting.setconfig)
            AND (
              SELECT count(*) FROM unnest(setting.setconfig) item
               WHERE item LIKE 'search_path=%'
            ) = 1
       ) AS durable_search_path_is_exact,
       has_schema_privilege($1, 'data_foundry', 'USAGE')
       AND NOT has_schema_privilege($1, 'data_foundry', 'CREATE')
       AND CASE $1
         WHEN 'df_edge' THEN has_table_privilege($1, 'data_foundry.verticals', 'SELECT')
           AND has_column_privilege($1, 'data_foundry.api_keys', 'token_hash', 'SELECT')
           AND NOT has_column_privilege($1, 'data_foundry.api_keys', 'created_at', 'SELECT')
         WHEN 'df_web' THEN has_table_privilege($1, 'data_foundry.verticals', 'SELECT')
           AND NOT has_any_column_privilege($1, 'data_foundry.api_keys', 'SELECT')
         WHEN 'df_mcp' THEN has_table_privilege($1, 'data_foundry.verticals', 'SELECT')
           AND has_column_privilege($1, 'data_foundry.api_keys', 'token_hash', 'SELECT')
         WHEN 'df_usage' THEN has_column_privilege($1, 'data_foundry.api_usage_events', 'route_key', 'INSERT')
           AND NOT has_table_privilege($1, 'data_foundry.api_usage_events', 'UPDATE')
         WHEN 'df_acquisition' THEN has_table_privilege($1, 'data_foundry.sources', 'UPDATE')
           AND NOT has_table_privilege($1, 'data_foundry.sources', 'DELETE')
           AND has_function_privilege($1, 'data_foundry.scheduled_acquisition_validators_valid(jsonb)', 'EXECUTE')
         ELSE false
       END AS privilege_matrix_is_exact`;

export async function checkRuntimeRoleConnectionsPostgres(
  env: Readonly<Record<string, string | undefined>> = process.env,
  connect: ConnectionFactory = async (connectionString) => new pg.Client({ connectionString }) as Connection,
): Promise<void> {
  if (env['DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST'] !== '1') {
    throw new Error('Set DATA_FOUNDRY_RUNTIME_ROLE_CONNECTION_TEST=1 for the dedicated real PostgreSQL check.');
  }
  if ((env['PGOPTIONS'] ?? '').trim() !== '') {
    throw new Error('PGOPTIONS must be absent for the direct runtime-role connection check.');
  }
  for (const [role, envName] of Object.entries(ROLE_URLS) as Array<[RuntimeRole, string]>) {
    const connectionString = env[envName];
    if (connectionString === undefined || connectionString.trim() === '') {
      throw new Error(`${envName} is required for the direct runtime-role connection check.`);
    }
    let parsedConnection: URL;
    try {
      parsedConnection = new URL(connectionString);
    } catch {
      throw new Error(`${envName} must be a valid PostgreSQL connection URL.`);
    }
    if (parsedConnection.searchParams.has('options')) {
      throw new Error(`${envName} must not contain startup options.`);
    }
    const client = await connect(connectionString, role);
    try {
      await client.connect();
      const result = await client.query(PROBE_SQL, [role]);
      const row = result.rows[0];
      if (
        row?.['direct_login'] !== true ||
        row['role_is_login_nonprivileged'] !== true ||
        row['membership_is_empty'] !== true ||
        row['search_path_is_exact'] !== true ||
        row['durable_search_path_is_exact'] !== true ||
        row['privilege_matrix_is_exact'] !== true
      ) {
        throw new Error(`Direct runtime-role connection verification failed for ${role}.`);
      }
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

if (isMain(import.meta.url)) {
  checkRuntimeRoleConnectionsPostgres().then(
    () => process.stdout.write('OK: 5 direct LOGIN runtime-role PostgreSQL connections are least-privileged.\n'),
    (error: unknown) => {
      process.stderr.write(`Runtime-role PostgreSQL check failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
