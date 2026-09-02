/**
 * The one property this consumer exists for: every message in a batch is
 * persisted independently, exactly once, no matter what order failure and
 * success arrive in.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPgliteDriver, type SqlDriver, type SqlExecutor, type SqlParam, type SqlRow } from '@data-foundry/canonical-store';
import { migrate } from '../../../packages/canonical-store/test/support.js';
import { buildUsageEvent } from '@data-foundry/usage-events';
import {
  consumeBatch,
  resetDrivers,
  type ConsumerErrorContext,
  type QueueMessage,
  type QueueMessageBatch,
} from '../src/index.js';
import consumerWorker from '../src/index.js';
import { ConsumerConfigurationError, resolveConsumerConfig } from '../src/env.js';

let driver: SqlDriver;
let tenantId: string;
let apiKeyId: string;
let unclassifiedLegacyApiKeyId: string;
let verticalId: string;

beforeAll(async () => {
  driver = await createPgliteDriver({ trigram: false });
  await migrate(driver);

  const [vertical] = await driver.query<{ id: string }>(
    `insert into verticals (slug, name, schema_version, status, default_refresh_policy)
     values ('usage-consumer-test', 'Usage consumer test', '1', 'ACTIVE', '{}'::jsonb)
     returning id`,
  );
  const seededVerticalId = vertical?.id;
  if (seededVerticalId === undefined) throw new Error('vertical insert returned no row');
  verticalId = seededVerticalId;

  // `api_usage_events` carries a composite FK to `api_keys (id, tenant_id)` —
  // AGENTS.md rule "a usage row cannot name a tenant other than the one
  // whose key was used" — so a well-formed event still needs a real tenant
  // and a real key row behind it, or `persistUsageEvent` fails the same way
  // a made-up id would in production.
  const [tenant] = await driver.query<{ id: string }>(
    `insert into api_tenants (slug, name, status) values ('usage-consumer-test', 'usage-consumer-test', 'ACTIVE') returning id`,
  );
  const seededTenantId = tenant?.id;
  if (seededTenantId === undefined) throw new Error('tenant insert returned no row');
  tenantId = seededTenantId;

  const [key] = await driver.query<{ id: string }>(
    `insert into api_keys
       (tenant_id, token_hash, token_prefix, label, vertical_id, access_tier, billing_source)
     values ($1, $2, $3, $4, $5, 'API_PAID', 'DIRECT') returning id`,
    [tenantId, 'a'.repeat(64), 'df_test_abcdefgh', 'usage-consumer test key', verticalId],
  );
  const seededKeyId = key?.id;
  if (seededKeyId === undefined) throw new Error('key insert returned no row');
  apiKeyId = seededKeyId;

  // Simulate a key that existed before migration 0015. The production
  // migration deliberately leaves such rows NULL/NULL; disabling this one
  // INSERT trigger is only a test harness shortcut to recreate that historical
  // state after the complete migration set has already been applied.
  await driver.exec(
    'alter table api_keys disable trigger api_keys_access_classification_guard',
  );
  try {
    const [legacyKey] = await driver.query<{ id: string }>(
      `insert into api_keys
         (tenant_id, token_hash, token_prefix, label, vertical_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [tenantId, 'b'.repeat(64), 'df_test_legacy12', 'unclassified legacy key', verticalId],
    );
    const legacyKeyId = legacyKey?.id;
    if (legacyKeyId === undefined) throw new Error('legacy key insert returned no row');
    unclassifiedLegacyApiKeyId = legacyKeyId;
  } finally {
    await driver.exec(
      'alter table api_keys enable trigger api_keys_access_classification_guard',
    );
  }
});

afterAll(async () => {
  await driver.close();
});

afterEach(() => {
  resetDrivers();
  vi.restoreAllMocks();
});

async function rowCount(): Promise<number> {
  const rows = await driver.query<{ n: string }>('select count(*)::text as n from api_usage_events');
  return Number(rows[0]?.n ?? '0');
}

function event(
  overrides: Partial<Parameters<typeof buildUsageEvent>[0]> = {},
): ReturnType<typeof buildUsageEvent> {
  return buildUsageEvent({
    tenantId,
    apiKeyId,
    verticalId,
    routeKey: 'entities.detail',
    method: 'GET',
    status: 200,
    accessTier: 'API_PAID',
    billingSource: 'DIRECT',
    ...overrides,
  });
}

function message(id: string, body: unknown): QueueMessage & { acked: boolean; retried: boolean } {
  const record = { id, body, acked: false, retried: false };
  return {
    id,
    body,
    ack: () => {
      record.acked = true;
    },
    retry: () => {
      record.retried = true;
    },
    get acked() {
      return record.acked;
    },
    get retried() {
      return record.retried;
    },
  } as QueueMessage & { acked: boolean; retried: boolean };
}

function batchOf(messages: readonly (QueueMessage & { acked: boolean; retried: boolean })[]): QueueMessageBatch {
  return { messages };
}

/** A driver that throws on `query` for calls matching `shouldFail`, and otherwise delegates. */
function flakyDriver(real: SqlDriver, shouldFail: (sql: string, params: readonly SqlParam[] | undefined) => boolean): SqlDriver {
  return {
    ...real,
    async query<R extends SqlRow = SqlRow>(sql: string, params?: readonly SqlParam[]): Promise<R[]> {
      if (shouldFail(sql, params)) throw new Error('simulated transient failure');
      return real.query<R>(sql, params);
    },
  };
}

describe('batch persistence', () => {
  it('persists every message in a batch and acks each one', async () => {
    const events = [event(), event(), event()];
    const messages = events.map((e, i) => message(`msg-${i}`, e));
    const before = await rowCount();
    const querySpy = vi.spyOn(driver, 'query');

    await consumeBatch(batchOf(messages), { env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' }, openDriver: async () => driver });

    expect(await rowCount()).toBe(before + events.length);
    expect(querySpy.mock.calls.filter(([sql]) => String(sql).includes('insert into api_usage_events'))).toHaveLength(1);
    for (const m of messages) {
      expect(m.acked).toBe(true);
      expect(m.retried).toBe(false);
    }
  });
});

describe('duplicate delivery', () => {
  it('persists exactly one row when the same event id is delivered twice, and acks both deliveries', async () => {
    const shared = event();
    const first = message('dup-1', shared);
    const second = message('dup-2', shared);
    const before = await rowCount();

    await consumeBatch(batchOf([first]), { env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' }, openDriver: async () => driver });
    await consumeBatch(batchOf([second]), { env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' }, openDriver: async () => driver });

    expect(await rowCount()).toBe(before + 1);
    expect(first.acked).toBe(true);
    expect(second.acked).toBe(true);
  });

  it('persists exactly one row when both deliveries land in the same batch', async () => {
    const shared = event();
    const a = message('dup-a', shared);
    const b = message('dup-b', shared);
    const before = await rowCount();

    await consumeBatch(batchOf([a, b]), { env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' }, openDriver: async () => driver });

    expect(await rowCount()).toBe(before + 1);
    expect(a.acked).toBe(true);
    expect(b.acked).toBe(true);
  });
});

describe('consumer-first usage-event rollout', () => {
  const asLegacy = (current: ReturnType<typeof buildUsageEvent>) => {
    const {
      schema_version: _schemaVersion,
      access_tier: _accessTier,
      billing_source: _billingSource,
      ...legacy
    } = current;
    return legacy;
  };

  it('enriches a legacy v1 event from the immutable classified key before persisting it', async () => {
    const legacyEvent = asLegacy(event());
    const queued = message('legacy-classified', legacyEvent);

    await consumeBatch(batchOf([queued]), {
      env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' },
      openDriver: async () => driver,
    });

    const rows = await driver.query<{ access_tier: string; billing_source: string }>(
      `select access_tier, billing_source
         from api_usage_events
        where id = $1`,
      [legacyEvent.id],
    );
    expect(rows).toEqual([{ access_tier: 'API_PAID', billing_source: 'DIRECT' }]);
    expect(queued.acked).toBe(true);
    expect(queued.retried).toBe(false);
  });

  it('retries rather than guessing a classification for a legacy key still in quarantine', async () => {
    const legacyEvent = {
      ...asLegacy(event()),
      api_key_id: unclassifiedLegacyApiKeyId,
    };
    const queued = message('legacy-unclassified', legacyEvent);

    await consumeBatch(batchOf([queued]), {
      env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' },
      openDriver: async () => driver,
    });

    const rows = await driver.query<{ n: string }>(
      'select count(*)::text as n from api_usage_events where id = $1',
      [legacyEvent.id],
    );
    expect(rows[0]?.n).toBe('0');
    expect(queued.acked).toBe(false);
    expect(queued.retried).toBe(true);
  });
});

describe('a malformed message does not discard the rest of the batch', () => {
  it('retries the malformed message and still persists and acks the well-formed ones', async () => {
    const good1 = message('good-1', event());
    const bad = message('bad-1', { not: 'a usage event' });
    const good2 = message('good-2', event());
    const before = await rowCount();
    const errors: ConsumerErrorContext[] = [];
    const querySpy = vi.spyOn(driver, 'query');

    await consumeBatch(batchOf([good1, bad, good2]), {
      env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' },
      openDriver: async () => driver,
      onError: (_error, context) => errors.push(context),
    });

    expect(await rowCount()).toBe(before + 2);
    expect(good1.acked).toBe(true);
    expect(good2.acked).toBe(true);
    expect(bad.acked).toBe(false);
    expect(bad.retried).toBe(true);
    expect(querySpy.mock.calls.filter(([sql]) => String(sql).includes('insert into api_usage_events'))).toHaveLength(1);
    expect(errors).toContainEqual({ stage: 'parse', messageId: 'bad-1' });
  });
});

describe('a database-invalid message does not poison unrelated valid usage', () => {
  it('isolates the constraint failure, retries only the poison event, and acks the valid event', async () => {
    const good = message('constraint-good', event());
    const poisonEvent = { ...event(), vertical_id: '44444444-4444-4444-8444-444444444444' };
    const poison = message('constraint-poison', poisonEvent);
    const before = await rowCount();

    await consumeBatch(batchOf([good, poison]), {
      env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' },
      openDriver: async () => driver,
    });

    expect(await rowCount()).toBe(before + 1);
    expect(good.acked).toBe(true);
    expect(good.retried).toBe(false);
    expect(poison.acked).toBe(false);
    expect(poison.retried).toBe(true);
  });
});

describe('a transient persistence failure retries rather than acks or drops', () => {
  it('retries every valid message in the atomic batch and persists none of them', async () => {
    const willFail = event();
    const willSucceed = event();
    const failing = message('flaky-1', willFail);
    const succeeding = message('flaky-2', willSucceed);
    const before = await rowCount();

    let remainingFailures = 1;
    const failOnce = flakyDriver(
      driver,
      (sql) => sql.includes('insert into api_usage_events') && remainingFailures-- > 0,
    );

    await consumeBatch(batchOf([failing, succeeding]), {
      env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' },
      openDriver: async () => failOnce,
    });

    expect(failing.acked).toBe(false);
    expect(failing.retried).toBe(true);
    expect(succeeding.acked).toBe(false);
    expect(succeeding.retried).toBe(true);
    expect(await rowCount()).toBe(before);
  });

  it('never acks a message whose persistence keeps failing — the platform, not this consumer, decides when that reaches the dead-letter queue', async () => {
    const doomed = event();
    const alwaysFail = flakyDriver(driver, (sql) => sql.includes('insert into api_usage_events'));

    // Three redeliveries of the same message, as `max_retries` on the
    // queue's own consumer config would produce. This consumer's job is
    // only to never turn one of them into an ack; whether the platform then
    // dead-letters the message is outside code this package controls.
    for (let attempt = 0; attempt < 3; attempt++) {
      const redelivery = message('doomed-1', doomed);
      await consumeBatch(batchOf([redelivery]), { env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'unused' }, openDriver: async () => alwaysFail });
      expect(redelivery.acked).toBe(false);
      expect(redelivery.retried).toBe(true);
    }
  });
});

describe('configuration', () => {
  it.each([undefined, '', ' ', 'preview'])('refuses an absent, blank, or unknown deployment environment: %j', (value) => {
    expect(() =>
      resolveConsumerConfig({ DEPLOYMENT_ENVIRONMENT: value, POSTGRES_URL: 'postgres://local/db' }),
    ).toThrow(/DEPLOYMENT_ENVIRONMENT/);
  });

  it('refuses to consume without a database, and never acks or retries any message', async () => {
    const m = message('unconfigured-1', event());
    resetDrivers();

    await expect(consumeBatch(batchOf([m]), { env: {} })).rejects.toThrow(ConsumerConfigurationError);
    expect(m.acked).toBe(false);
    expect(m.retried).toBe(false);
  });

  it('requires Hyperdrive in production but preserves POSTGRES_URL for local development', () => {
    expect(() =>
      resolveConsumerConfig({
        DEPLOYMENT_ENVIRONMENT: 'production',
        POSTGRES_URL: 'postgres://origin/db',
      }),
    ).toThrow(/HYPERDRIVE/);
    expect(
      resolveConsumerConfig({
        DEPLOYMENT_ENVIRONMENT: 'production',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive/db' },
      }).deploymentEnvironment,
    ).toBe('production');
    expect(resolveConsumerConfig({ DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'postgres://local/db' }).connectionString).toBe(
      'postgres://local/db',
    );
  });
});

describe('driver lifecycle', () => {
  it('keeps local direct-Postgres batches on one explicitly enabled plaintext loopback pool', async () => {
    const driverOptions: Array<{
      readonly schema?: string;
      readonly allowPlaintextLoopback?: boolean;
    } | undefined> = [];
    const openDriver = async (
      _connectionString: string,
      options?: { readonly schema?: string; readonly allowPlaintextLoopback?: boolean },
    ) => {
      driverOptions.push(options);
      return driver;
    };
    const options = {
      env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'postgres://fixture/direct' },
      openDriver,
    } as const;

    await consumeBatch({ messages: [] }, options);
    await consumeBatch({ messages: [] }, options);

    expect(driverOptions).toEqual([{ allowPlaintextLoopback: true }]);
  });

  it('opens and closes a private-schema Hyperdrive driver for every delivered batch', async () => {
    const opens: Array<{ readonly connectionString: string; readonly schema: string | undefined }> = [];
    let closes = 0;
    const openDriver = async (
      connectionString: string,
      options?: { readonly schema?: string },
    ): Promise<SqlDriver> => {
      opens.push({ connectionString, schema: options?.schema });
      return {
        label: driver.label,
        dialect: driver.dialect,
        query: driver.query.bind(driver),
        exec: driver.exec.bind(driver),
        transaction: driver.transaction.bind(driver),
        close: async () => { closes += 1; },
      };
    };
    const options = {
      env: {
        DEPLOYMENT_ENVIRONMENT: 'production',
        HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/data-foundry' },
      },
      openDriver,
    } as const;

    await consumeBatch({ messages: [] }, options);
    await consumeBatch({ messages: [] }, options);

    expect(opens).toEqual([
      { connectionString: 'postgres://hyperdrive.fixture/data-foundry', schema: 'data_foundry' },
      { connectionString: 'postgres://hyperdrive.fixture/data-foundry', schema: 'data_foundry' },
    ]);
    expect(closes).toBe(2);
  });
});

describe('the deployed queue() handler logs operational failures', () => {
  it(
    'reports a configuration failure to Workers logs without being told to — the default export wires onError itself',
    async () => {
      const m = message('deployed-handler-1', event());
      resetDrivers();
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // The exported default, exactly as `wrangler` would call it — no
      // `openDriver` override, no `onError` passed in by the caller. If this
      // consumer only ever logs when a test supplies `onError` itself, a
      // real deployment would fail silently forever.
      await expect(consumerWorker.queue(batchOf([m]), {})).rejects.toThrow(ConsumerConfigurationError);

      expect(errorSpy).toHaveBeenCalledWith(
        '[usage-consumer] configuration',
        expect.objectContaining({ error: expect.any(ConsumerConfigurationError) }),
      );
      // Never the message body — nothing here should have a chance to leak
      // a plaintext key or a raw request target, and this proves the log
      // call was never handed one.
      for (const call of errorSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain('deployed-handler-1');
      }
    },
  );
});
