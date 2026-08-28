/**
 * Per-source ingestion.
 *
 * Each source is run on its own database so that what it contributes is
 * attributable to it alone. That matters more than it sounds: the argument for
 * maintaining four dissimilar sources is that four facts exist in exactly one
 * source each, and the only way to keep that argument honest is to check, per
 * source, that the thing only it can supply actually arrives.
 *
 * Every assertion here goes through the real migrations, the real registry, the
 * real extractors and the real store. The fixture provider replaces the network
 * and nothing else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFactory, type Factory } from '../support/harness.js';
import type { SourceRunResult } from '../../services/ingest-worker/src/index.js';
import type { AcquisitionMethod } from '@data-foundry/canonical-schema';

interface SourceExpectation {
  readonly key: string;
  readonly format: string;
  readonly acquisitionRoute: AcquisitionMethod;
  /** Source records the mapping's streams should yield from one artifact. */
  readonly records: number;
  /** Entity type → number of canonical entities this source alone produces. */
  readonly entities: Readonly<Record<string, number>>;
  /** Properties no other source in this vertical publishes. */
  readonly uniqueProperties: readonly string[];
  /** Alias types no other source supplies. */
  readonly uniqueAliasTypes: readonly string[];
  readonly predicates: Readonly<Record<string, number>>;
}

const EXPECTATIONS: readonly SourceExpectation[] = [
  {
    key: 'acme-hvac-catalog',
    format: 'json',
    acquisitionRoute: 'DIRECT_HTTP',
    records: 6,
    entities: { manufacturer: 1, equipment_model: 6 },
    // The only source that asserts electrical data and lifecycle succession.
    uniqueProperties: ['voltage', 'phase', 'stage_count'],
    uniqueAliasTypes: ['manufacturer_sku'],
    predicates: { manufactures: 6, supersedes: 2 },
  },
  {
    key: 'acme-spec-sheets',
    format: 'pdf',
    acquisitionRoute: 'DIRECT_HTTP',
    records: 3,
    entities: { manufacturer: 1, equipment_model: 3 },
    uniqueProperties: ['sound_level_db'],
    uniqueAliasTypes: [],
    predicates: { manufactures: 3 },
  },
  {
    key: 'ahri-directory-export',
    format: 'csv',
    acquisitionRoute: 'BULK_FILE',
    // One CSV row yields two records: the certification, and the certified model.
    records: 22,
    entities: { manufacturer: 3, equipment_model: 11, certification: 11 },
    uniqueProperties: ['eer2', 'hspf2'],
    uniqueAliasTypes: ['ahri_ref'],
    predicates: { manufactures: 11, certified_by: 11 },
  },
  {
    key: 'coolsupply-distributor',
    format: 'html',
    acquisitionRoute: 'BROWSER_RUN',
    records: 5,
    entities: { manufacturer: 3, equipment_model: 5 },
    uniqueProperties: [],
    // The whole reason to keep a low-authority source: it holds the UPCs.
    uniqueAliasTypes: ['upc'],
    predicates: { manufactures: 5 },
  },
];

describe.each(EXPECTATIONS)('source $key ($format)', (expectation) => {
  let factory: Factory;
  let result: SourceRunResult;

  beforeAll(async () => {
    factory = await createFactory();
    const run = await factory.run({ sources: [expectation.key] });
    const [first] = run.sources;
    expect(first).toBeDefined();
    result = first as SourceRunResult;
  }, 120_000);

  afterAll(async () => {
    await factory?.close();
  });

  it('walks the job to PUBLISHED without a normalization failure', () => {
    expect(result.error).toBeNull();
    expect(result.finalState).toBe('PUBLISHED');
    expect(result.outcome).toBe('FETCHED');
    // A recorded failure is not a crash — but on a fixture we author ourselves
    // it is a mapping bug, so the bar is zero.
    expect(result.normalizationFailures).toBe(0);
  });

  it('stores exactly one content-addressed artifact', async () => {
    const rows = await factory.driver.query(
      `SELECT artifact.content_hash, artifact.r2_uri, artifact.http_status,
              artifact.policy_snapshot_id, artifact.acquisition_route,
              artifact.account_or_product_plan, artifact.acquisition_jurisdiction,
              snapshot.snapshot
         FROM source_artifacts artifact
         LEFT JOIN acquisition_policy_snapshots snapshot
           ON snapshot.id = artifact.policy_snapshot_id`,
    );
    expect(rows).toHaveLength(1);
    expect(String(rows[0]?.['content_hash'])).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]?.['http_status']).toBe(200);
    // Doc 13: every artifact must be able to answer "why were we allowed to
    // fetch this?" months later.
    expect(rows[0]?.['policy_snapshot_id']).not.toBeNull();
    expect(rows[0]?.['acquisition_route']).toBe(expectation.acquisitionRoute);
    expect(rows[0]?.['account_or_product_plan']).toBeNull();
    expect(rows[0]?.['acquisition_jurisdiction']).toBeNull();
    expect(rows[0]?.['snapshot']).toMatchObject({
      acquisition_method: expectation.acquisitionRoute,
      account_or_product_plan: null,
      acquisition_jurisdiction: null,
    });
  });

  it('extracts the declared number of source records', async () => {
    expect(result.records).toBe(expectation.records);
    const rows = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM source_records`,
    );
    expect(Number(rows[0]?.n)).toBe(expectation.records);
  });

  it('leaves every source record with a normalized payload', async () => {
    const rows = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM source_records WHERE normalized_payload IS NULL`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('resolves the entities this source can see, and no others', async () => {
    const rows = await factory.driver.query<{ entity_type: string; n: string }>(
      `SELECT entity_type, count(*)::text AS n FROM entities GROUP BY entity_type`,
    );
    const actual = Object.fromEntries(rows.map((row) => [row.entity_type, Number(row.n)]));
    expect(actual).toEqual(expectation.entities);
  });

  it('supplies the facts and identifiers only it can supply', async () => {
    const properties = new Set(
      (
        await factory.driver.query<{ property: string }>(`SELECT DISTINCT property FROM facts`)
      ).map((row) => row.property),
    );
    for (const property of expectation.uniqueProperties) {
      expect(properties, `${expectation.key} must publish ${property}`).toContain(property);
    }

    const aliasTypes = new Set(
      (
        await factory.driver.query<{ alias_type: string }>(
          `SELECT DISTINCT alias_type FROM entity_aliases`,
        )
      ).map((row) => row.alias_type),
    );
    for (const aliasType of expectation.uniqueAliasTypes) {
      expect(aliasTypes, `${expectation.key} must supply ${aliasType}`).toContain(aliasType);
    }
  });

  it('writes the declared relationships and nothing it did not assert', async () => {
    const rows = await factory.driver.query<{ predicate: string; n: string }>(
      `SELECT predicate, count(*)::text AS n FROM relationships GROUP BY predicate`,
    );
    const actual = Object.fromEntries(rows.map((row) => [row.predicate, Number(row.n)]));
    expect(actual).toEqual(expectation.predicates);
    // Rule: compatibility is never inferred, from any source, ever.
    expect(actual['compatible_with']).toBeUndefined();
  });

  it('backs every published claim with evidence that resolves to this source', async () => {
    const rows = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM facts f
        WHERE NOT EXISTS (
          SELECT 1 FROM fact_evidence fe
            JOIN source_records sr ON sr.id = fe.source_record_id
            JOIN source_artifacts sa ON sa.id = fe.artifact_id
            JOIN sources s ON s.id = sr.source_id
           WHERE fe.fact_id = f.id)`,
    );
    expect(Number(rows[0]?.n)).toBe(0);
  });

  it('records an auditable resolution decision for every source record', async () => {
    const candidates = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM resolution_candidates
        WHERE left_source_record_id IS NOT NULL AND decision = 'MATCH'`,
    );
    expect(Number(candidates[0]?.n)).toBe(expectation.records);

    const judgments = await factory.driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM resolution_judgments
        WHERE verdict = 'MERGE' AND decided_by_kind = 'RULE' AND active`,
    );
    expect(Number(judgments[0]?.n)).toBe(expectation.records);
  });
});
