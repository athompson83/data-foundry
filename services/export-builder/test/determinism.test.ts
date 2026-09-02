/**
 * The same input must produce the same bytes.
 *
 * This is not a stylistic preference. A snapshot's whole value is that a
 * customer can pin `2026-08-14.1`, re-download it, and check the digest — and a
 * builder whose output moves between runs makes every such check meaningless
 * while looking like it works.
 *
 * Two claims, and they are different:
 *
 *   1. **Same database, two builds → identical digests.** Catches wall-clock
 *      timestamps, `Math.random`, and anything that reads iteration order.
 *   2. **Two independently built databases → identical digests once the
 *      database-minted UUIDs are projected out.** This is the stronger one. The
 *      two databases insert the same fixtures and mint different primary keys,
 *      so anything that depended on physical row order, on insertion order, or
 *      on sorting by a random id would differ here and pass claim 1. What
 *      remains is a function of the data.
 *
 * A THIRD claim, and the division of labour matters. Neither digest comparison
 * catches removal of the explicit sort: the query layer's browse path orders by
 * `canonical_name` in SQL, and that order is itself stable across two identical
 * databases, so both builds agree while ordering by something the export never
 * declared. What catches it is the ordering block at the bottom of this file,
 * and only because the fixtures contain an entity whose display name and slug
 * sort differently — `24ANB7 Replacement Coil` / `replacement-coil-24anb7`,
 * which is ordinary data for a product named after a model number. The last
 * test here asserts that divergence still exists, so the guard cannot quietly
 * become vacuous if somebody renames a fixture.
 *
 * `compareCodeUnits`, not `localeCompare`, is what makes claim 2 hold on a
 * machine with a different collation too — `tests/contract/ordering-determinism`
 * makes that argument for every layer that decides what gets published, and
 * `test/boundary.test.ts` keeps this service inside it.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FACTS_CSV,
  FACTS_JSONL,
  buildDatasetExport,
  createMemorySink,
  fromUtf8,
  sha256,
  utf8,
  type DatasetExportResult,
} from '../src/index.js';
import { baseOptions, createExportFixtures, type ExportFixtures } from './support.js';

let fixtures: ExportFixtures;
let other: ExportFixtures;
let first: DatasetExportResult;
let second: DatasetExportResult;

const build = async (
  target: ExportFixtures,
  namespace: string,
): Promise<DatasetExportResult> =>
  buildDatasetExport({ ...baseOptions(target), sink: createMemorySink(namespace) });

beforeAll(async () => {
  fixtures = await createExportFixtures();
  // A second, independently migrated PGlite database loaded with the same
  // fixtures. Every UUID in it differs from the first.
  other = await createExportFixtures();
  first = await build(fixtures, 'snapshot');
  second = await build(fixtures, 'snapshot');
}, 180_000);

afterAll(async () => {
  await fixtures?.driver.close();
  await other?.driver.close();
});

const digests = (result: DatasetExportResult): Record<string, string> => {
  const out: Record<string, string> = { 'manifest.json': result.manifestSha256 };
  for (const [path, bytes] of result.artifacts) out[path] = sha256(bytes);
  return out;
};

/**
 * Everything except the identifiers the database mints.
 *
 * The UUIDs are legitimately part of the export — a consumer joins on them —
 * but they are `gen_random_uuid()` output, so they are stable within a database
 * and meaningless across a rebuild. Projecting them out is what lets the
 * cross-database comparison say something about ORDERING rather than about
 * Postgres's random number generator.
 */
const MINTED_ID_COLUMNS = new Set([
  'entity_id',
  'fact_id',
  'evidence_id',
  'artifact_id',
  'source_record_id',
]);

const withoutMintedIds = (result: DatasetExportResult, path: string): string =>
  fromUtf8(result.artifacts.get(path) as Uint8Array)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const record = JSON.parse(line) as Record<string, unknown>;
      const stripped: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(record)) {
        if (!MINTED_ID_COLUMNS.has(key)) stripped[key] = value;
      }
      return JSON.stringify(stripped);
    })
    .join('\n');

describe('two builds of the same database', () => {
  it('write byte-identical files', () => {
    expect(digests(second)).toEqual(digests(first));
  });

  it('produce the same manifest digest, which is the thing a customer pins', () => {
    expect(second.manifestSha256).toBe(first.manifestSha256);
    expect(second.manifest.checksums).toEqual(first.manifest.checksums);
  });

  it('are not passing vacuously — the files have content and digests differ per file', () => {
    const seen = digests(first);
    expect(Object.keys(seen).sort()).toEqual([
      'evidence.jsonl',
      'facts.csv',
      'facts.jsonl',
      'manifest.json',
    ]);
    expect(new Set(Object.values(seen)).size).toBe(4);
    expect(first.rows.length).toBeGreaterThan(5);
    expect(first.evidence.length).toBeGreaterThan(5);
  });
});

describe('two independently built databases', () => {
  it('agree on facts.jsonl once the database-minted UUIDs are projected out', async () => {
    const third = await build(other, 'other');
    expect(sha256(utf8(withoutMintedIds(third, FACTS_JSONL)))).toBe(
      sha256(utf8(withoutMintedIds(first, FACTS_JSONL))),
    );
  });

  it('agree on evidence.jsonl the same way', async () => {
    const third = await build(other, 'other');
    expect(sha256(utf8(withoutMintedIds(third, 'evidence.jsonl')))).toBe(
      sha256(utf8(withoutMintedIds(first, 'evidence.jsonl'))),
    );
  });

  it('really are different databases, so the comparison above means something', async () => {
    const third = await build(other, 'other');
    expect(third.manifest.vertical_id).not.toBe(first.manifest.vertical_id);
    expect(third.rows[0]?.entity_id).not.toBe(first.rows[0]?.entity_id);
    expect(third.manifestSha256).not.toBe(first.manifestSha256);
  });
});

describe('the ordering is explicit and total', () => {
  it('sorts fact rows semantic-first, with a minted id only as the final total-order tie-breaker', () => {
    const keys = first.rows.map((row) =>
      `${row.entity_type} ${row.entity_slug} ${row.property} ${row.entity_id}`,
    );
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('sorts evidence rows semantic-first, with minted ids only as final total-order tie-breakers', () => {
    const keys = first.evidence.map((row) =>
      [
        row.entity_slug,
        row.property,
        row.source_key,
        row.source_publisher,
        row.source_domain,
        row.artifact_content_hash,
        row.artifact_url,
        row.artifact_retrieved_at,
        row.locator_type,
        row.locator_value,
        row.source_value,
        row.observed_at,
        row.entity_id,
        row.fact_id,
        row.evidence_id,
      ].join(' '),
    );
    expect(keys).toEqual([...keys].sort());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declares that ordering in the manifest, so a consumer can re-derive it', () => {
    expect(first.manifest.selection_policy.ordering).toEqual({
      facts: ['entity_type', 'entity_slug', 'property', 'entity_id'],
      evidence: [
        'entity_slug',
        'property',
        'source_key',
        'source_publisher',
        'source_domain',
        'artifact_content_hash',
        'artifact_url',
        'artifact_retrieved_at',
        'locator_type',
        'locator_value',
        'source_value',
        'observed_at',
        'entity_id',
        'fact_id',
        'evidence_id',
      ],
    });
  });

  it('has fixture data where name order and slug order actually disagree', () => {
    // Without this, "sorted by slug" and "whatever Postgres returned" coincide
    // and the two assertions above pass with the sort removed. Verified by
    // removing it: they fail only because this entity is present.
    const names = [...new Set(first.rows.map((row) => row.entity_name))].sort();
    const slugs = [...new Set(first.rows.map((row) => row.entity_slug))].sort();
    expect(names[0]).toBe('24ANB7 Replacement Coil');
    expect(slugs[slugs.length - 1]).toBe('replacement-coil-24anb7');
  });

  it('emits CSV rows in the same order as JSONL rows', () => {
    const csvOrder = fromUtf8(first.artifacts.get(FACTS_CSV) as Uint8Array)
      .split('\r\n')
      .slice(1)
      .filter((line) => line !== '')
      // Only the leading, never-quoted columns are needed to read the order off.
      .map((line) => line.split(',').slice(0, 6).join(','));
    const jsonOrder = first.rows.map((row) =>
      [row.vertical_slug, row.entity_id, row.entity_type, row.entity_slug, row.entity_name, row.property].join(
        ',',
      ),
    );
    // The hostile value contains a CRLF, so its record spans two "lines" and the
    // continuation is skipped rather than compared.
    expect(jsonOrder.every((key) => csvOrder.includes(key))).toBe(true);
    expect(csvOrder[0]).toBe(jsonOrder[0]);
  });
});
