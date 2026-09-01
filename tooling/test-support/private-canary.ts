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
 * A boundary-level test double for Hyperdrive: it records the actual
 * connection parameters and SQL issued by the Worker while avoiding a network
 * connection in Node.
 */
export function recordingHyperdrive(
  options: { readonly queryError?: Error; readonly readyValue?: unknown } = {},
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
    async query<R extends SqlRow = SqlRow>(sql: string, _params?: readonly SqlParam[]): Promise<R[]> {
      statements.push(sql);
      if (options.queryError !== undefined) throw options.queryError;
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
