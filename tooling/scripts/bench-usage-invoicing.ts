/**
 * The benchmark behind ADR-0008, made reproducible.
 *
 * ADR-0008 decides that `api_usage_events` stores `tenant_id` and `vertical_id`
 * even though both are derivable, and the decision rests on measured numbers.
 * Numbers in a document that nobody can re-run are an assertion wearing a
 * measurement's clothes — review said so, and it was right. This is the script
 * that produced them.
 *
 * It is NOT part of any test suite and nothing in CI runs it. It writes two
 * million rows and takes minutes; that is the wrong shape for a gate. It exists
 * so the ADR's table can be checked, and so it can be re-run when a schema,
 * index, query or execution-plan assumption changes — which is the condition
 * ADR-0008 itself sets for revisiting the decision.
 *
 * ## Running it
 *
 *     POSTGRES_URL=postgres://user@host:5432/bench pnpm tsx tooling/scripts/bench-usage-invoicing.ts
 *
 * Against a REAL PostgreSQL, deliberately. PGlite would answer a different
 * question: it is a different engine with different planner behaviour, and the
 * finding here is about plan shape and buffer counts rather than wall-clock.
 *
 * It refuses to run without an explicit `POSTGRES_URL`, and it refuses a
 * database that already holds usage rows. Both guards exist because the obvious
 * accident is pointing this at something real.
 */
import pg from 'pg';

const ROWS = 2_000_000;
const TENANTS = 200;
const VERTICALS = 4;
/** One tenant holds this many keys: the case that decides the question. */
const KEYS_FOR_LARGEST_TENANT = 500;
const RUNS = 5;

interface Timing {
  readonly label: string;
  readonly bestMs: number;
  readonly sharedHit: number;
  readonly sharedRead: number;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(
      `${name} is not set. This benchmark writes ${ROWS.toLocaleString()} rows and must be ` +
        'pointed at a scratch database deliberately, never by default.',
    );
  }
  return value;
}

/** Best of N, with the buffer counts from the same run. */
async function measure(
  client: pg.Client,
  label: string,
  sql: string,
  params: readonly unknown[],
): Promise<Timing> {
  let best: Timing | null = null;
  for (let run = 0; run < RUNS; run += 1) {
    const explained = await client.query(
      `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`,
      [...params],
    );
    const plan = (explained.rows[0] as { 'QUERY PLAN': readonly Record<string, never>[] })[
      'QUERY PLAN'
    ][0] as unknown as {
      'Execution Time': number;
      Plan: { 'Shared Hit Blocks': number; 'Shared Read Blocks': number };
    };
    const timing: Timing = {
      label,
      bestMs: plan['Execution Time'],
      sharedHit: plan.Plan['Shared Hit Blocks'],
      sharedRead: plan.Plan['Shared Read Blocks'],
    };
    if (best === null || timing.bestMs < best.bestMs) best = timing;
  }
  return best as Timing;
}

async function seed(client: pg.Client): Promise<void> {
  const existing = await client.query<{ n: string }>('SELECT count(*) AS n FROM api_usage_events');
  if (Number(existing.rows[0]?.n ?? 0) > 0) {
    throw new Error(
      'api_usage_events is not empty. This benchmark only runs against a scratch database — ' +
        'it must never add two million synthetic rows beside real accounting data.',
    );
  }

  await client.query(
    `INSERT INTO verticals (id, slug, name, schema_version, status, default_refresh_policy)
     SELECT gen_random_uuid(), 'bench-vertical-' || g, 'Bench ' || g, '1.0.0', 'ACTIVE',
            '{"cadence":"WEEKLY","max_staleness_hours":168,"priority":50}'::jsonb
       FROM generate_series(1, $1) g`,
    [VERTICALS],
  );
  await client.query(
    `INSERT INTO api_tenants (id, slug, name)
     SELECT gen_random_uuid(), 'bench-tenant-' || g, 'Bench ' || g FROM generate_series(1, $1) g`,
    [TENANTS],
  );

  // Most tenants hold a handful of keys; one holds many. The skew is the point:
  // it is the tenant whose normalized invoicing query must reach the most keys.
  await client.query(
    `WITH t AS (SELECT id, row_number() OVER (ORDER BY slug) AS n FROM api_tenants),
          v AS (SELECT id, row_number() OVER (ORDER BY slug) - 1 AS n FROM verticals)
     INSERT INTO api_keys (id, tenant_id, vertical_id, token_hash, token_prefix, label)
     SELECT gen_random_uuid(), t.id, v.id,
            md5(t.id::text || k::text) || md5(k::text || t.id::text),
            'df_live_' || substr(md5(t.id::text || k::text), 1, 8),
            'bench-key-' || k
       FROM t
       CROSS JOIN LATERAL generate_series(1, CASE WHEN t.n = 1 THEN $1 ELSE 1 + (t.n % 8) END) k
       JOIN v ON v.n = k % $2`,
    [KEYS_FOR_LARGEST_TENANT, VERTICALS],
  );

  // Usage spread over 90 days. `g::bigint` matters: the multipliers overflow a
  // 32-bit integer well before two million rows, which is how the first run of
  // this failed.
  await client.query(
    `CREATE TEMP TABLE bench_keys AS
       SELECT row_number() OVER (ORDER BY id) - 1 AS n, id, tenant_id, vertical_id FROM api_keys`,
  );
  await client.query('CREATE INDEX ON bench_keys (n)');
  await client.query('ANALYZE bench_keys');
  await client.query(
    `INSERT INTO api_usage_events
       (tenant_id, api_key_id, vertical_id, route_key, occurred_at, method, status, rows_served)
     SELECT k.tenant_id, k.id, k.vertical_id,
            (ARRAY['search','entities.detail','entities.facts','compare','entities.relationships'])
              [1 + (g % 5)],
            TIMESTAMPTZ '2026-05-01 00:00:00Z' + ((g::bigint * 3889) % 7776000) * INTERVAL '1 second',
            'GET', 200, (g % 50)
       FROM generate_series(1, $1) g
       JOIN bench_keys k ON k.n = (g::bigint * 7919) % (SELECT count(*)::bigint FROM bench_keys)`,
    [ROWS],
  );
  await client.query('ANALYZE api_usage_events');
  await client.query('ANALYZE api_keys');
}

async function main(): Promise<number> {
  const client = new pg.Client({ connectionString: required('POSTGRES_URL') });
  await client.connect();
  try {
    console.log(`Seeding ${ROWS.toLocaleString()} usage events…`);
    await seed(client);

    const big = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM api_keys GROUP BY tenant_id ORDER BY count(*) DESC LIMIT 1',
    );
    const small = await client.query<{ tenant_id: string }>(
      'SELECT tenant_id FROM api_keys GROUP BY tenant_id ORDER BY count(*) ASC LIMIT 1',
    );
    const vertical = await client.query<{ id: string }>(
      'SELECT id FROM verticals ORDER BY slug LIMIT 1',
    );

    const window = `occurred_at >= TIMESTAMPTZ '2026-06-01' AND occurred_at < TIMESTAMPTZ '2026-07-01'`;
    const agg = 'route_key, count(*) AS calls, sum(rows_served) AS rows_served';

    const cases: readonly (readonly [string, string, readonly unknown[]])[] = [
      [
        'tenant invoice, largest tenant — denormalized',
        `SELECT ${agg} FROM api_usage_events e WHERE e.tenant_id = $1 AND e.${window} GROUP BY route_key`,
        [big.rows[0]?.tenant_id],
      ],
      [
        'tenant invoice, largest tenant — normalized join',
        `SELECT ${agg} FROM api_usage_events e JOIN api_keys k ON k.id = e.api_key_id
          WHERE k.tenant_id = $1 AND e.${window} GROUP BY route_key`,
        [big.rows[0]?.tenant_id],
      ],
      [
        'tenant invoice, smallest tenant — denormalized',
        `SELECT ${agg} FROM api_usage_events e WHERE e.tenant_id = $1 AND e.${window} GROUP BY route_key`,
        [small.rows[0]?.tenant_id],
      ],
      [
        'tenant invoice, smallest tenant — normalized join',
        `SELECT ${agg} FROM api_usage_events e JOIN api_keys k ON k.id = e.api_key_id
          WHERE k.tenant_id = $1 AND e.${window} GROUP BY route_key`,
        [small.rows[0]?.tenant_id],
      ],
      [
        'per-vertical attribution — denormalized',
        `SELECT ${agg} FROM api_usage_events e WHERE e.vertical_id = $1 AND e.${window} GROUP BY route_key`,
        [vertical.rows[0]?.id],
      ],
      [
        'per-vertical attribution — normalized join',
        `SELECT ${agg} FROM api_usage_events e JOIN api_keys k ON k.id = e.api_key_id
          WHERE k.vertical_id = $1 AND e.${window} GROUP BY route_key`,
        [vertical.rows[0]?.id],
      ],
    ];

    const version = await client.query<{ version: string }>('SELECT version()');
    console.log(`\n${version.rows[0]?.version ?? 'unknown'}`);
    console.log(`best of ${RUNS}, after ANALYZE\n`);
    console.log('| read | best ms | shared hit | shared read |');
    console.log('|---|--:|--:|--:|');
    for (const [label, sql, params] of cases) {
      const timing = await measure(client, label, sql, params);
      console.log(
        `| ${label} | ${timing.bestMs.toFixed(1)} | ${timing.sharedHit} | ${timing.sharedRead} |`,
      );
    }
    return 0;
  } finally {
    await client.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
