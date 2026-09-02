import { describe, expect, it } from 'vitest';
import {
  createCanonicalStore,
  type SqlDriver,
  type SqlParam,
  type SqlRow,
  type SqlTransactionExecutor,
} from '@data-foundry/canonical-store';
import type { VerticalId } from '@data-foundry/canonical-schema';
import {
  FieldMetadataRegistry,
  MAX_SURFACE_AUTHORIZATION_ROWS,
  MAX_SURFACE_CATALOG_ENTITY_CANDIDATES,
  MAX_SURFACE_CATALOG_FACT_CANDIDATES,
  MAX_SURFACE_FACT_DEPENDENCY_DEPTH,
  MAX_SURFACE_FACT_DEPENDENCY_EDGES,
  MAX_SURFACE_FACT_DEPENDENCY_NODES,
  SurfaceCatalogCapacityError,
  computeFacets,
  createQueryModel,
  searchEntities,
} from '../src/index.js';

const VERTICAL_ID = '8f000000-0000-4000-8000-000000000001' as VerticalId;

const ids = (count: number, prefix: string): string[] =>
  Array.from(
    { length: count },
    (_, index) => `${prefix}0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  );

const fields = new FieldMetadataRegistry([
  {
    field: 'capacity_probe',
    value_type: 'number',
    unit: null,
    filter: { type: 'multi_select', facet_count: true },
    sort: false,
    search_boost: 1,
    indexable: true,
    label: 'Capacity probe',
  },
]);

describe('surface catalog authorization capacity', () => {
  it('keeps search and facet SQL parameter counts independent of authorized catalog size', async () => {
    const entityIds = ids(33_000, '1');
    const factIds = ids(33_000, '2');
    const calls: Array<{ sql: string; params: readonly SqlParam[] }> = [];
    const driver = {
      label: 'authorization parameter probe',
      dialect: 'postgres',
      query: async <R extends SqlRow = SqlRow>(sql: string, params: readonly SqlParam[] = []) => {
        calls.push({ sql, params });
        if (sql.includes('count(')) return [{ total: '0' }] as unknown as R[];
        return [];
      },
      exec: async () => {},
      transaction: async <T>() => {
        throw new Error('not used by direct query helpers');
      },
      close: async () => {},
    } satisfies SqlDriver;

    await searchEntities(driver, fields, {
      vertical_id: VERTICAL_ID,
      text: 'capacity probe',
      filters: [{ property: 'capacity_probe', op: 'exists' }],
      authorized_entity_ids: entityIds as never,
      authorized_fact_ids: factIds,
    });
    await computeFacets(driver, fields, {
      vertical_id: VERTICAL_ID,
      entity_ids: entityIds,
      authorized_fact_ids: factIds,
    });

    expect(calls.length).toBeGreaterThan(0);
    expect(Math.max(...calls.map((call) => call.params.length))).toBeLessThan(40);
    expect(Math.max(...calls.map((call) => call.sql.length))).toBeLessThan(12_000);
    expect(calls.some((call) => call.sql.includes('jsonb_array_elements_text('))).toBe(true);
    expect(
      calls.every((call) => call.params.filter((value) => value === JSON.stringify(entityIds)).length <= 1),
    ).toBe(true);
    expect(
      calls.every((call) => call.params.filter((value) => value === JSON.stringify(factIds)).length <= 1),
    ).toBe(true);
  });

  it.each([
    {
      resource: 'entities' as const,
      operation: 'search' as const,
      entityCount: MAX_SURFACE_CATALOG_ENTITY_CANDIDATES + 1,
      factCount: 0,
      limit: MAX_SURFACE_CATALOG_ENTITY_CANDIDATES,
    },
    {
      resource: 'facts' as const,
      operation: 'search' as const,
      // A non-empty neighboring set proves neither rights batch starts until
      // both candidate ceilings have passed.
      entityCount: 1,
      factCount: MAX_SURFACE_CATALOG_FACT_CANDIDATES + 1,
      limit: MAX_SURFACE_CATALOG_FACT_CANDIDATES,
    },
    {
      resource: 'entities' as const,
      operation: 'facets' as const,
      entityCount: MAX_SURFACE_CATALOG_ENTITY_CANDIDATES + 1,
      factCount: 0,
      limit: MAX_SURFACE_CATALOG_ENTITY_CANDIDATES,
    },
  ])('fails closed before authorizing a $resource catalog above its bound', async ({
    resource,
    operation,
    entityCount,
    factCount,
    limit,
  }) => {
    const calls: Array<{ sql: string; params: readonly SqlParam[] }> = [];
    const executor = {
      query: async <R extends SqlRow = SqlRow>(
        sql: string,
        params: readonly SqlParam[] = [],
      ): Promise<R[]> => {
        calls.push({ sql, params });
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) {
          return ids(entityCount, '3').map((id) => ({ id })) as unknown as R[];
        }
        if (sql.includes('SELECT f.id')) {
          return ids(factCount, '4').map((id) => ({ id })) as unknown as R[];
        }
        throw new Error(`authorization began after the ${resource} capacity boundary`);
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'authorization capacity probe',
      dialect: 'postgres',
      query: executor.query,
      exec: async () => {},
      transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor),
      close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    const surface = model.forSurface('PUBLIC_WEB');
    const pending = operation === 'search'
      ? surface.search({ vertical_id: VERTICAL_ID, limit: 1 })
      : surface.facets({ vertical_id: VERTICAL_ID });

    await expect(pending).rejects.toEqual(
      expect.objectContaining<Partial<SurfaceCatalogCapacityError>>({
        name: 'SurfaceCatalogCapacityError',
        resource,
        limit,
      }),
    );
    const entityScan = calls.find((call) => call.sql.includes('SELECT id FROM entities'));
    expect(entityScan?.sql).toContain('LIMIT $2');
    expect(entityScan?.sql).not.toContain('ORDER BY');
    expect(entityScan?.params).toEqual([
      VERTICAL_ID,
      MAX_SURFACE_CATALOG_ENTITY_CANDIDATES + 1,
    ]);
    if (resource === 'facts') {
      const factScan = calls.find((call) => call.sql.includes('SELECT f.id'));
      expect(factScan?.sql).toContain('LIMIT $3');
      expect(factScan?.sql).not.toContain('ORDER BY');
      expect(factScan?.params).toEqual([
        VERTICAL_ID,
        expect.any(String),
        MAX_SURFACE_CATALOG_FACT_CANDIDATES + 1,
      ]);
    }
    expect(calls.some((call) => call.sql.includes('authority_evidence'))).toBe(false);
    expect(calls.some((call) => call.sql.includes('authorization_rows AS ('))).toBe(false);
  });

  it('accepts both candidate sets exactly at their checked-in ceilings', async () => {
    const entityRows = ids(MAX_SURFACE_CATALOG_ENTITY_CANDIDATES, '5').map((id) => ({ id }));
    const factRows = ids(MAX_SURFACE_CATALOG_FACT_CANDIDATES, '6').map((id) => ({ id }));
    const calls: Array<{ sql: string; params: readonly SqlParam[] }> = [];
    const executor = {
      query: async <R extends SqlRow = SqlRow>(sql: string, params: readonly SqlParam[] = []): Promise<R[]> => {
        calls.push({ sql, params });
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return entityRows as unknown as R[];
        if (sql.includes('SELECT f.id')) return factRows as unknown as R[];
        if (sql.includes('count(*)')) return [{ total: '0' }] as unknown as R[];
        return [];
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'authorization exact-bound probe',
      dialect: 'postgres',
      query: executor.query,
      exec: async () => {},
      transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor),
      close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    const result = await model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 });

    expect(result).toMatchObject({ hits: [], total: 0 });
    const entityScanIndex = calls.findIndex((call) => call.sql.includes('SELECT id FROM entities'));
    const factScanIndex = calls.findIndex((call) => call.sql.includes('SELECT f.id'));
    const firstAuthorizationIndex = calls.findIndex((call) => call.sql.includes('FROM entity_evidence ee'));
    expect(entityScanIndex).toBeGreaterThanOrEqual(0);
    expect(factScanIndex).toBeGreaterThan(entityScanIndex);
    expect(firstAuthorizationIndex).toBeGreaterThan(factScanIndex);
  });

  it('fails closed at the bounded entity-evidence rowset', async () => {
    const calls: Array<{ sql: string; params: readonly SqlParam[] }> = [];
    const executor = {
      query: async <R extends SqlRow = SqlRow>(sql: string, params: readonly SqlParam[] = []): Promise<R[]> => {
        calls.push({ sql, params });
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return [{ id: ids(1, '7')[0] }] as unknown as R[];
        if (sql.includes('SELECT f.id')) return [];
        if (sql.includes('FROM entity_evidence ee')) return new Array(MAX_SURFACE_AUTHORIZATION_ROWS + 1) as unknown as R[];
        return [];
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'entity evidence bound probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    await expect(model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 }))
      .rejects.toMatchObject({ resource: 'entity_authorization_rows', limit: MAX_SURFACE_AUTHORIZATION_ROWS });

    const call = calls.find((entry) => entry.sql.includes('FROM entity_evidence ee'))!;
    expect(call.params.at(-1)).toBe(MAX_SURFACE_AUTHORIZATION_ROWS + 1);
    expect(call.sql).toContain('LEFT JOIN LATERAL');
    expect(call.sql).not.toContain('EXISTS (');
    expect(call.sql).toContain('ORDER BY ee.id');
  });

  it('fails closed at the bounded fact-evidence rowset', async () => {
    const factId = ids(1, '8')[0]!;
    const calls: Array<{ sql: string; params: readonly SqlParam[] }> = [];
    const executor = {
      query: async <R extends SqlRow = SqlRow>(sql: string, params: readonly SqlParam[] = []): Promise<R[]> => {
        calls.push({ sql, params });
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return [];
        if (sql.includes('SELECT f.id')) return [{ id: factId }] as unknown as R[];
        if (sql.includes('dependency_frontier')) return [];
        if (sql.includes('FROM facts stored')) return [{ fact_id: factId, property: 'capacity_probe', output_kind: 'RAW' }] as unknown as R[];
        if (sql.includes('FROM fact_evidence fe')) return new Array(MAX_SURFACE_AUTHORIZATION_ROWS) as unknown as R[];
        return [];
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'fact evidence bound probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    await expect(model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 }))
      .rejects.toMatchObject({ resource: 'fact_authorization_rows', limit: MAX_SURFACE_AUTHORIZATION_ROWS });

    const call = calls.find((entry) => entry.sql.includes('FROM fact_evidence fe'))!;
    expect(call.params.at(-1)).toBe(MAX_SURFACE_AUTHORIZATION_ROWS);
    expect(call.sql).toContain('CROSS JOIN LATERAL');
    expect(call.sql).toContain('ORDER BY fe.id');
  });

  it('fails closed when dependency edges exceed their explicit budget', async () => {
    const factId = ids(1, '9')[0]!;
    let frontierSql = '';
    const executor = {
      query: async <R extends SqlRow = SqlRow>(sql: string): Promise<R[]> => {
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return [];
        if (sql.includes('SELECT f.id')) return [{ id: factId }] as unknown as R[];
        if (sql.includes('dependency_frontier')) {
          frontierSql = sql;
          return new Array(MAX_SURFACE_FACT_DEPENDENCY_EDGES + 1) as unknown as R[];
        }
        return [];
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'dependency edge bound probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    await expect(model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 }))
      .rejects.toMatchObject({ resource: 'fact_dependency_edges', limit: MAX_SURFACE_FACT_DEPENDENCY_EDGES });
    expect(frontierSql).toContain('CROSS JOIN LATERAL');
    expect(frontierSql).not.toContain('WITH RECURSIVE');
    expect(frontierSql).toContain('ORDER BY edge.input_fact_id');
  });

  it('fails closed when distinct dependency nodes exceed their budget', async () => {
    const factId = ids(1, 'a')[0]!;
    const inputs = ids(MAX_SURFACE_FACT_DEPENDENCY_NODES, 'b');
    const executor = {
      query: async <R extends SqlRow = SqlRow>(sql: string): Promise<R[]> => {
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return [];
        if (sql.includes('SELECT f.id')) return [{ id: factId }] as unknown as R[];
        if (sql.includes('dependency_frontier')) {
          return inputs.map((input_fact_id) => ({ derived_fact_id: factId, input_fact_id })) as unknown as R[];
        }
        return [];
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'dependency node bound probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    await expect(model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 }))
      .rejects.toMatchObject({ resource: 'fact_dependency_nodes', limit: MAX_SURFACE_FACT_DEPENDENCY_NODES });
  });

  it('fails closed when dependency depth exceeds its budget', async () => {
    const chain = ids(MAX_SURFACE_FACT_DEPENDENCY_DEPTH + 2, 'c');
    let level = 0;
    const executor = {
      query: async <R extends SqlRow = SqlRow>(sql: string): Promise<R[]> => {
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return [];
        if (sql.includes('SELECT f.id')) return [{ id: chain[0] }] as unknown as R[];
        if (sql.includes('dependency_frontier')) {
          const row = { derived_fact_id: chain[level]!, input_fact_id: chain[level + 1]! };
          level += 1;
          return [row] as unknown as R[];
        }
        return [];
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'dependency depth bound probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    await expect(model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 }))
      .rejects.toMatchObject({ resource: 'fact_dependency_depth', limit: MAX_SURFACE_FACT_DEPENDENCY_DEPTH });
  });

  it('measures dependency-path depth even when shortcut edges collapse BFS discovery', async () => {
    const chain = ids(MAX_SURFACE_FACT_DEPENDENCY_DEPTH + 2, 'f');
    const root = chain[0]!;
    const executor = {
      query: async <R extends SqlRow = SqlRow>(
        sql: string,
        params: readonly SqlParam[] = [],
      ): Promise<R[]> => {
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return [];
        if (sql.includes('SELECT f.id')) return [{ id: root }] as unknown as R[];
        if (sql.includes('dependency_frontier')) {
          const frontier = JSON.parse(String(params[0])) as string[];
          if (frontier.length === 1 && frontier[0] === root) {
            return chain.slice(1).map((input_fact_id) => ({
              derived_fact_id: root,
              input_fact_id,
            })) as unknown as R[];
          }
          const position = new Map(chain.map((id, index) => [id, index]));
          return frontier.flatMap((derived_fact_id) => {
            const index = position.get(derived_fact_id);
            const input_fact_id = index === undefined ? undefined : chain[index + 1];
            return input_fact_id === undefined ? [] : [{ derived_fact_id, input_fact_id }];
          }) as unknown as R[];
        }
        throw new Error('authorization continued after the dependency-path depth boundary');
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'dependency path-depth probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    await expect(model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 }))
      .rejects.toMatchObject({ resource: 'fact_dependency_depth', limit: MAX_SURFACE_FACT_DEPENDENCY_DEPTH });
  });

  it('bounds a reachable corrupted dependency cycle before contribution expansion', async () => {
    const [first, second] = ids(2, '1');
    const executor = {
      query: async <R extends SqlRow = SqlRow>(
        sql: string,
        params: readonly SqlParam[] = [],
      ): Promise<R[]> => {
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return [];
        if (sql.includes('SELECT f.id')) return [{ id: first }] as unknown as R[];
        if (sql.includes('dependency_frontier')) {
          const frontier = JSON.parse(String(params[0])) as string[];
          return frontier.flatMap((derived_fact_id) => {
            if (derived_fact_id === first) return [{ derived_fact_id, input_fact_id: second }];
            if (derived_fact_id === second) return [{ derived_fact_id, input_fact_id: first }];
            return [];
          }) as unknown as R[];
        }
        throw new Error('authorization continued after the corrupted-cycle boundary');
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'dependency cycle probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    await expect(model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 }))
      .rejects.toMatchObject({ resource: 'fact_dependency_depth', limit: MAX_SURFACE_FACT_DEPENDENCY_DEPTH });
  });

  it('does not authorize the fact catalog for entity-type counts', async () => {
    const entityId = ids(1, '0')[0]!;
    const calls: string[] = [];
    const executor = {
      query: async <R extends SqlRow = SqlRow>(sql: string): Promise<R[]> => {
        calls.push(sql);
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return [{ id: entityId }] as unknown as R[];
        if (sql.includes('SELECT f.id') || sql.includes('dependency_frontier')) {
          throw new Error('entity-type counts touched the unrelated fact catalog');
        }
        if (sql.includes('FROM entity_evidence ee')) {
          return [{
            entity_id: entityId,
            identity_authority: false,
            evidence_id: null,
            source_id: null,
            acquisition_route: null,
            account_or_product_plan: null,
            acquisition_jurisdiction: null,
          }] as unknown as R[];
        }
        return [];
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'entity-only aggregate probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    await expect(model.forSurface('PUBLIC_WEB').entityTypeCounts(VERTICAL_ID))
      .resolves.toEqual(new Map());
    expect(calls.some((sql) => sql.includes('SELECT f.id'))).toBe(false);
    expect(calls.some((sql) => sql.includes('dependency_frontier'))).toBe(false);
  });

  it.each(['entity', 'fact'] as const)('accepts exactly the %s authorization-row ceiling', async (kind) => {
    const entityId = ids(1, 'd')[0]!;
    const factId = ids(1, 'e')[0]!;
    const entityRow = {
      entity_id: entityId, identity_authority: false, evidence_id: null, source_id: null,
      acquisition_route: null, account_or_product_plan: null, acquisition_jurisdiction: null,
    };
    const factEvidenceRow = {
      fact_id: factId, evidence_id: 'f0000000-0000-4000-8000-000000000001',
      source_id: 'f0000000-0000-4000-8000-000000000002', acquisition_route: 'DIRECT_HTTP',
      account_or_product_plan: null, acquisition_jurisdiction: null,
    };
    const calls: string[] = [];
    const executor = {
      query: async <R extends SqlRow = SqlRow>(sql: string): Promise<R[]> => {
        calls.push(sql);
        if (sql.startsWith('SET TRANSACTION')) return [];
        if (sql.includes('SELECT id FROM entities')) return (kind === 'entity' ? [{ id: entityId }] : []) as unknown as R[];
        if (sql.includes('SELECT f.id')) return (kind === 'fact' ? [{ id: factId }] : []) as unknown as R[];
        if (sql.includes('FROM entity_evidence ee')) return new Array(MAX_SURFACE_AUTHORIZATION_ROWS).fill(entityRow) as unknown as R[];
        if (sql.includes('dependency_frontier')) return [];
        if (sql.includes('FROM facts stored')) return [{ fact_id: factId, property: 'capacity_probe', output_kind: 'RAW' }] as unknown as R[];
        if (sql.includes('FROM fact_evidence fe')) return new Array(MAX_SURFACE_AUTHORIZATION_ROWS - 1).fill(factEvidenceRow) as unknown as R[];
        if (sql.includes('count(*)')) return [{ total: '0' }] as unknown as R[];
        return [];
      },
    } as SqlTransactionExecutor;
    const driver = {
      label: 'authorization exact-row-bound probe', dialect: 'postgres', query: executor.query,
      exec: async () => {}, transaction: async <T>(run: (tx: SqlTransactionExecutor) => Promise<T>) => run(executor), close: async () => {},
    } satisfies SqlDriver;
    const model = createQueryModel(createCanonicalStore(driver), { fields });

    const result = await model.forSurface('PUBLIC_WEB').search({ vertical_id: VERTICAL_ID, limit: 1 });

    expect(result).toMatchObject({ hits: [], total: 0 });
    expect(calls.some((sql) => sql.includes(kind === 'entity' ? 'FROM entity_evidence ee' : 'FROM fact_evidence fe'))).toBe(true);
  });
});
