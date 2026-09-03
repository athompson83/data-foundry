import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { SqlDriver } from '@data-foundry/canonical-store';
import { createFixtures, type Fixtures } from '../../../packages/canonical-store/test/support.js';
import {
  resetAcquisitionDrivers,
  runScheduledEvent,
} from '../src/index.js';
import type { AcquisitionWorkerEnv } from '../src/env.js';
import type { R2BucketBinding } from '../src/r2.js';

const EVENT = {
  scheduledTime: Date.parse('2026-08-28T17:00:00.000Z'),
  cron: '0 * * * *',
} as const;

let fixtures: Fixtures;

const unreachableBucket: R2BucketBinding = {
  head: async () => { throw new Error('test driver must fail before R2'); },
  get: async () => { throw new Error('test driver must fail before R2'); },
  put: async () => { throw new Error('test driver must fail before R2'); },
  list: async () => { throw new Error('test driver must fail before R2'); },
  delete: async () => { throw new Error('test driver must fail before R2'); },
};

function rejectingDriver(onClose: () => void): SqlDriver {
  const fail = async (): Promise<never> => {
    throw new Error('deliberate scheduled-acquisition database failure');
  };
  return {
    label: 'test Hyperdrive driver',
    dialect: 'postgres',
    query: fail,
    exec: fail,
    transaction: fail,
    close: async () => { onClose(); },
  };
}

function driverThatRecordsClose(driver: SqlDriver, onClose: () => void): SqlDriver {
  return {
    label: driver.label,
    dialect: driver.dialect,
    query: driver.query.bind(driver),
    exec: driver.exec.bind(driver),
    transaction: driver.transaction.bind(driver),
    close: async () => { onClose(); },
  };
}

function developmentEnv(): AcquisitionWorkerEnv {
  return {
    DEPLOYMENT_ENVIRONMENT: 'development',
    POSTGRES_URL: 'postgres://direct.fixture/data-foundry',
    VERTICAL_SLUG: 'hvac',
    RAW_ARTIFACTS_BUCKET_NAME: 'test-raw-artifacts',
    RAW_ARTIFACTS: unreachableBucket,
  };
}

function productionEnv(): AcquisitionWorkerEnv {
  return {
    DEPLOYMENT_ENVIRONMENT: 'production',
    HYPERDRIVE: { connectionString: 'postgres://hyperdrive.fixture/data-foundry' },
    VERTICAL_SLUG: 'hvac',
    RAW_ARTIFACTS_BUCKET_NAME: 'test-raw-artifacts',
    RAW_ARTIFACTS: unreachableBucket,
  };
}

afterEach(() => {
  resetAcquisitionDrivers();
});

beforeAll(async () => {
  fixtures = await createFixtures({ trigram: false });
});

afterAll(async () => {
  await fixtures.driver.close();
});

describe('scheduled-acquisition driver lifecycle', () => {
  it('keeps development direct Postgres on one explicitly enabled plaintext loopback pool', async () => {
    const driverOptions: Array<{
      readonly schema?: string;
      readonly allowPlaintextLoopback?: boolean;
    } | undefined> = [];
    const openDriver = async (
      _connectionString: string,
      options?: { readonly schema?: string; readonly allowPlaintextLoopback?: boolean },
    ) => {
      driverOptions.push(options);
      return rejectingDriver(() => undefined);
    };

    await expect(runScheduledEvent(EVENT, developmentEnv(), { openDriver })).rejects.toThrow(
      'deliberate scheduled-acquisition database failure',
    );
    await expect(runScheduledEvent(EVENT, developmentEnv(), { openDriver })).rejects.toThrow(
      'deliberate scheduled-acquisition database failure',
    );

    expect(driverOptions).toEqual([{ allowPlaintextLoopback: true }]);
  });

  it('opens and closes a private-schema Hyperdrive driver for every Cron delivery', async () => {
    const opens: Array<{ readonly connectionString: string; readonly schema: string | undefined }> = [];
    let closes = 0;
    const openDriver = async (connectionString: string, options?: { readonly schema?: string }) => {
      opens.push({ connectionString, schema: options?.schema });
      return rejectingDriver(() => { closes += 1; });
    };

    await expect(runScheduledEvent(EVENT, productionEnv(), { openDriver })).rejects.toThrow(
      'deliberate scheduled-acquisition database failure',
    );
    await expect(runScheduledEvent(EVENT, productionEnv(), { openDriver })).rejects.toThrow(
      'deliberate scheduled-acquisition database failure',
    );

    expect(opens).toEqual([
      { connectionString: 'postgres://hyperdrive.fixture/data-foundry', schema: 'data_foundry' },
      { connectionString: 'postgres://hyperdrive.fixture/data-foundry', schema: 'data_foundry' },
    ]);
    expect(closes).toBe(2);
  });

  it('closes the production Hyperdrive driver after a normal refusal-only Cron result', async () => {
    const schemas: Array<string | undefined> = [];
    let closes = 0;
    const result = await runScheduledEvent(EVENT, productionEnv(), {
      openDriver: async (_connectionString: string, options?: { readonly schema?: string }) => {
        schemas.push(options?.schema);
        return driverThatRecordsClose(fixtures.driver, () => { closes += 1; });
      },
    });

    expect(result.executions).toHaveLength(4);
    expect(result.executions.every(({ disposition }) => disposition === 'REFUSED')).toBe(true);
    expect(schemas).toEqual(['data_foundry']);
    expect(closes).toBe(1);
  });
});
