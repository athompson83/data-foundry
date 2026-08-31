import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CanonicalStore,
  SqlParam,
  SqlRow,
  SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import { createCanonicalStore } from '@data-foundry/canonical-store';
import {
  createQueryModel,
  type SurfaceReadSnapshot,
  type SurfaceQueryModel,
} from '../src/index.js';
import { createQueryFixtures, type QueryFixtures } from './support.js';

const AS_OF = '2026-07-01T00:00:00.000Z' as const;

let fixtures: QueryFixtures;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('request-wide surface read snapshots', () => {
  it('uses one repeatable-read read-only transaction for every bound surface facade', async () => {
    const originalTransactionMethod = fixtures.driver.transaction;
    const originalTransaction = originalTransactionMethod.bind(fixtures.driver);
    let transactionCount = 0;
    let snapshotDeclarationCount = 0;
    const transactionIdsUsedForReads = new Set<number>();

    fixtures.driver.transaction = (async <T>(
      run: (tx: SqlTransactionExecutor) => Promise<T>,
    ): Promise<T> => {
      transactionCount += 1;
      const transactionId = transactionCount;
      return originalTransaction(async (transaction) => run({
        query: async <R extends SqlRow = SqlRow>(
          sql: string,
          params?: readonly SqlParam[],
        ): Promise<R[]> => {
          if (/^SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY$/i.test(sql.trim())) {
            snapshotDeclarationCount += 1;
          } else {
            transactionIdsUsedForReads.add(transactionId);
          }
          return transaction.query<R>(sql, params);
        },
      } as SqlTransactionExecutor));
    }) as typeof fixtures.driver.transaction;

    const queryModel = createQueryModel(fixtures.store, { fields: fixtures.registry });
    try {
      await queryModel.withSurfaceSnapshot(async (snapshot) => {
        const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF }, snapshot);
        const paid = queryModel.forSurface('API_PAID', { asOf: AS_OF }, snapshot);

        await web.getEntity(fixtures.equipment.id);
        await paid.getEntity(fixtures.equipment.id);
      });
    } finally {
      fixtures.driver.transaction = originalTransactionMethod;
    }

    expect(transactionCount).toBe(1);
    expect(snapshotDeclarationCount).toBe(1);
    expect(transactionIdsUsedForReads).toEqual(new Set([1]));
  });

  it('preserves one fresh snapshot per operation when no token is supplied', async () => {
    const originalTransactionMethod = fixtures.driver.transaction;
    const originalTransaction = originalTransactionMethod.bind(fixtures.driver);
    let transactionCount = 0;
    fixtures.driver.transaction = (async <T>(
      run: (tx: SqlTransactionExecutor) => Promise<T>,
    ): Promise<T> => {
      transactionCount += 1;
      return originalTransaction(run);
    }) as typeof fixtures.driver.transaction;

    const queryModel = createQueryModel(fixtures.store, { fields: fixtures.registry });
    try {
      const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF });
      await web.getEntity(fixtures.equipment.id);
      await web.getEntity(fixtures.equipment.id);
    } finally {
      fixtures.driver.transaction = originalTransactionMethod;
    }

    expect(transactionCount).toBe(2);
  });

  it('keeps the token opaque and the facade bound to its selected surface', async () => {
    const queryModel = createQueryModel(fixtures.store, { fields: fixtures.registry });

    await queryModel.withSurfaceSnapshot(async (snapshot) => {
      expect(Reflect.ownKeys(snapshot)).toEqual([]);
      expect(Object.isFrozen(snapshot)).toBe(true);

      const web = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF }, snapshot);
      const exposed = web as unknown as Record<string, unknown>;
      expect(web.surface).toBe('PUBLIC_WEB');
      expect(['forSurface', 'withSurfaceSnapshot', 'driver', 'store'].filter(
        (name) => name in exposed,
      )).toEqual([]);
    });
  });

  it('rejects a forged token even when TypeScript is bypassed', () => {
    const queryModel = createQueryModel(fixtures.store, { fields: fixtures.registry });
    const forged = Object.freeze({}) as SurfaceReadSnapshot;

    expect(() => queryModel.forSurface(
      'PUBLIC_WEB',
      { asOf: AS_OF },
      forged,
    )).toThrow(/snapshot/i);
  });

  it('shares a token with another QueryModel backed by the exact same store', async () => {
    const creatingModel = createQueryModel(fixtures.store, { fields: fixtures.registry });
    const otherModel = createQueryModel(fixtures.store, { fields: fixtures.registry });

    await creatingModel.withSurfaceSnapshot(async (snapshot) => {
      const web = otherModel.forSurface(
        'PUBLIC_WEB',
        { asOf: AS_OF },
        snapshot,
      );
      await expect(web.getEntity(fixtures.equipment.id)).resolves.toBeDefined();
    });
  });

  it('rejects a snapshot token at a distinct CanonicalStore owner', async () => {
    const creatingModel = createQueryModel(fixtures.store, { fields: fixtures.registry });
    const distinctStore: CanonicalStore = createCanonicalStore(fixtures.driver);
    const otherModel = createQueryModel(distinctStore, { fields: fixtures.registry });

    await creatingModel.withSurfaceSnapshot(async (snapshot) => {
      expect(() => otherModel.forSurface(
        'PUBLIC_WEB',
        { asOf: AS_OF },
        snapshot,
      )).toThrow(/snapshot/i);
    });
  });

  it('revokes the snapshot token when its callback finishes', async () => {
    const queryModel = createQueryModel(fixtures.store, { fields: fixtures.registry });
    let escapedSnapshot: SurfaceReadSnapshot | undefined;

    await queryModel.withSurfaceSnapshot(async (snapshot) => {
      escapedSnapshot = snapshot;
    });

    if (escapedSnapshot === undefined) throw new Error('snapshot callback did not run');
    expect(() => queryModel.forSurface(
      'PUBLIC_WEB',
      { asOf: AS_OF },
      escapedSnapshot,
    )).toThrow(/snapshot/i);
  });

  it('fails closed when a bound facade escapes its snapshot callback', async () => {
    const queryModel = createQueryModel(fixtures.store, { fields: fixtures.registry });
    let escapedFacade: SurfaceQueryModel | undefined;

    await queryModel.withSurfaceSnapshot(async (snapshot) => {
      escapedFacade = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF }, snapshot);
      await escapedFacade.getEntity(fixtures.equipment.id);
    });

    if (escapedFacade === undefined) throw new Error('snapshot callback did not create a facade');
    await expect(escapedFacade.getEntity(fixtures.equipment.id)).rejects.toThrow(/snapshot/i);
  });

  it('revokes escaped tokens and facades when the callback throws', async () => {
    const queryModel = createQueryModel(fixtures.store, { fields: fixtures.registry });
    let escapedSnapshot: SurfaceReadSnapshot | undefined;
    let escapedFacade: SurfaceQueryModel | undefined;

    await expect(queryModel.withSurfaceSnapshot(async (snapshot) => {
      escapedSnapshot = snapshot;
      escapedFacade = queryModel.forSurface('PUBLIC_WEB', { asOf: AS_OF }, snapshot);
      throw new Error('abort request');
    })).rejects.toThrow('abort request');

    if (escapedSnapshot === undefined || escapedFacade === undefined) {
      throw new Error('snapshot callback did not create escaped capabilities');
    }
    expect(() => queryModel.forSurface(
      'PUBLIC_WEB',
      { asOf: AS_OF },
      escapedSnapshot,
    )).toThrow(/snapshot/i);
    await expect(escapedFacade.getEntity(fixtures.equipment.id)).rejects.toThrow(/snapshot/i);
  });
});
