import type {
  PostgresDriverOptions,
  SqlDriver,
  SqlParam,
  SqlRow,
  SqlTransactionExecutor,
} from '@data-foundry/canonical-store';

export interface HyperdriveOpen {
  readonly connectionString: string;
  readonly options: PostgresDriverOptions | undefined;
}

export interface RecordingHyperdrive {
  readonly openDriver: (
    connectionString: string,
    options?: PostgresDriverOptions,
  ) => Promise<SqlDriver>;
  readonly opens: readonly HyperdriveOpen[];
  readonly statements: readonly string[];
  readonly closed: () => boolean;
}

/**
 * The database facts a route-less target must verify before calling itself
 * ready.  These are deliberately returned from the fake driver's SQL boundary
 * rather than supplied to the target directly, matching a real Hyperdrive
 * connection's role identity and ACL inspection.
 */
export interface PrivateCanaryRoleBinding {
  readonly currentUser?: string | undefined;
  readonly sessionUser?: string | undefined;
  readonly roleIsLoginNonprivileged?: boolean | undefined;
  readonly membershipIsEmpty?: boolean | undefined;
  readonly privateSchemaUsage?: boolean | undefined;
  readonly privateSchemaCreate?: boolean | undefined;
  readonly roleCapabilityIsExact?: boolean | undefined;
  /** Simulates an over-granted edge login that can read api_keys.created_at. */
  readonly edgeApiKeysCreatedAtSelect?: boolean | undefined;
}

function isRoleBindingQuery(sql: string): boolean {
  return /\bcurrent_user\b/i.test(sql)
    && /\bsession_user\b/i.test(sql)
    && /\b(private_schema_usage|has_schema_privilege)\b/i.test(sql);
}

/**
 * A boundary-level test double for Hyperdrive: it records the actual
 * connection parameters and SQL issued by the Worker while avoiding a network
 * connection in Node.
 */
export function recordingHyperdrive(
  options: {
    readonly queryError?: Error;
    readonly readyValue?: unknown;
    readonly roleBinding?: PrivateCanaryRoleBinding;
  } = {},
): RecordingHyperdrive {
  const opens: HyperdriveOpen[] = [];
  const statements: string[] = [];
  let wasClosed = false;
  const driver: SqlDriver = {
    label: 'test hyperdrive',
    dialect: 'postgres',
    async exec(sql) {
      statements.push(sql);
    },
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]): Promise<R[]> {
      statements.push(sql);
      if (options.queryError !== undefined) throw options.queryError;
      if (isRoleBindingQuery(sql)) {
        const expectedRole = typeof params?.[0] === 'string' ? params[0] : 'df_test_runtime';
        return [{
          current_user: options.roleBinding?.currentUser ?? expectedRole,
          session_user: options.roleBinding?.sessionUser ?? expectedRole,
          role_is_login_nonprivileged: options.roleBinding?.roleIsLoginNonprivileged ?? true,
          membership_is_empty: options.roleBinding?.membershipIsEmpty ?? true,
          private_schema_usage: options.roleBinding?.privateSchemaUsage ?? true,
          private_schema_create: options.roleBinding?.privateSchemaCreate ?? false,
          role_capability_is_exact: options.roleBinding?.roleCapabilityIsExact
            ?? !(expectedRole === 'df_edge' && options.roleBinding?.edgeApiKeysCreatedAtSelect === true),
        } as unknown as R];
      }
      return [{ ready: options.readyValue ?? 1 } as unknown as R];
    },
    async transaction<T>(_work: (tx: SqlTransactionExecutor) => Promise<T>): Promise<T> {
      throw new Error('private-canary readiness must not open an application transaction');
    },
    async close() {
      wasClosed = true;
    },
  };

  return {
    openDriver: async (connectionString, driverOptions) => {
      opens.push({ connectionString, options: driverOptions });
      return driver;
    },
    opens,
    statements,
    closed: () => wasClosed,
  };
}
