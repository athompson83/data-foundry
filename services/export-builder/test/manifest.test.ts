/**
 * What a snapshot actually publishes.
 *
 * Three things are being pinned here, and they are different claims:
 *
 *   1. The manifest conforms to `dataset_snapshots`, the table migration 0007
 *      shipped and nothing has ever written. If the manifest and the table
 *      disagree, the snapshot is unrecordable and the version is unquotable.
 *   2. Attribution and licence terms travel with the data, per source.
 *      DATA_RIGHTS.md: the MIT licence covers the code and cannot license the
 *      data, and attribution must be honoured on bulk exports "alike".
 *   3. Every published value can be explained. A file of numbers with no
 *      evidence is exactly the artifact rule 10 exists to prevent.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatasetSnapshotInsertSchema, type Identifier } from '@data-foundry/canonical-schema';
import {
  EVIDENCE_JSONL,
  FACTS_CSV,
  FACTS_JSONL,
  MANIFEST_JSON,
  buildDatasetExport,
  createMemorySink,
  fromUtf8,
  sha256,
  toSnapshotInsert,
  type DatasetExportResult,
} from '../src/index.js';
import {
  CSV_HOSTILE_PROPERTY,
  CSV_HOSTILE_VALUE,
  GENERATED_AT,
  INTERNAL_PROPERTY,
  INTERNAL_VALUE,
  baseOptions,
  createExportFixtures,
  type ExportFixtures,
} from './support.js';

let fixtures: ExportFixtures;
let result: DatasetExportResult;
let sink: ReturnType<typeof createMemorySink>;

beforeAll(async () => {
  fixtures = await createExportFixtures();
  sink = createMemorySink('snapshot');
  result = await buildDatasetExport({ ...baseOptions(fixtures), sink });
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

const text = (path: string): string => {
  const bytes = result.artifacts.get(path);
  if (bytes === undefined) throw new Error(`no artifact at ${path}`);
  return fromUtf8(bytes);
};

const jsonLines = (path: string): Record<string, unknown>[] =>
  text(path)
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);

describe('the manifest identifies the snapshot', () => {
  it('carries identity, vertical, creation time and contract versions', () => {
    expect(result.manifest.vertical_id).toBe(fixtures.vertical.id);
    expect(result.manifest.vertical_slug).toBe('hvac');
    expect(result.manifest.version).toBe('2026-08-14.1');
    expect(result.manifest.generated_at).toBe(GENERATED_AT);
    expect(result.manifest.schema_version).toBe(fixtures.vertical.schema_version);
    expect(result.manifest.status).toBe('PUBLISHED');
    expect(result.manifest.manifest_version).toBe('1');
    expect(result.manifest.contract_version).toBe('2.0.0');
    expect(result.manifest.manifest_uri).toBe('memory://snapshot/manifest.json');
  });

  it('conforms to the dataset_snapshots row it becomes', () => {
    const insert = toSnapshotInsert(result.manifest);
    expect(() => DatasetSnapshotInsertSchema.parse(insert)).not.toThrow();
    expect(insert.version).toBe(result.manifest.version);
    expect(insert.manifest_uri).toBe(result.manifest.manifest_uri);
    expect(insert.checksums).toEqual(result.manifest.checksums);
    expect(insert.record_counts).toEqual(result.manifest.record_counts);
  });

  it('counts rows per canonical object, keyed by table name', () => {
    expect(Object.keys(result.manifest.record_counts).sort()).toEqual([
      'entities',
      'fact_evidence',
      'facts',
      'sources',
    ]);
    // `record_counts` counts canonical objects; `files[].rows` counts lines.
    // They coincide only while every exported property has a selected value.
    expect(result.manifest.record_counts['facts']).toBe(
      result.rows.filter((row) => row.fact_id !== null).length,
    );
    expect(result.manifest.record_counts['fact_evidence']).toBe(result.evidence.length);
    for (const file of result.manifest.files) {
      expect(file.rows).toBe(file.content === 'facts' ? result.rows.length : result.evidence.length);
    }
    expect(result.manifest.record_counts['sources']).toBe(result.manifest.sources.length);
    expect(result.manifest.record_counts['entities']).toBeGreaterThan(0);
  });

  it('checksums every emitted file, and the digests are of the bytes written', () => {
    for (const file of result.manifest.files) {
      const bytes = result.artifacts.get(file.path);
      expect(bytes, `${file.path} was written`).toBeDefined();
      expect(sha256(bytes as Uint8Array)).toBe(file.sha256);
      expect(result.manifest.checksums[file.path]).toBe(file.sha256);
      expect(file.bytes).toBe((bytes as Uint8Array).byteLength);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(result.manifest.files.map((file) => file.path).sort()).toEqual(
      [EVIDENCE_JSONL, FACTS_CSV, FACTS_JSONL].sort(),
    );
  });

  it('does not try to contain its own digest', () => {
    expect(Object.keys(result.manifest.checksums)).not.toContain(MANIFEST_JSON);
    expect(result.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(result.manifestSha256).toBe(sha256(result.artifacts.get(MANIFEST_JSON) as Uint8Array));
  });

  it('publishes each entity once even when a caller names a type twice', async () => {
    const twice = await buildDatasetExport({
      ...baseOptions(fixtures),
      sink: createMemorySink('twice'),
      entityTypes: ['equipment' as Identifier, 'equipment' as Identifier],
    });
    const single = await buildDatasetExport({
      ...baseOptions(fixtures),
      sink: createMemorySink('once'),
      entityTypes: ['equipment' as Identifier],
    });
    expect(twice.rows).toEqual(single.rows);
    expect(twice.manifestSha256).not.toBe(single.manifestSha256); // entity_types differs
    expect(new Set(twice.rows.map((row) => `${row.entity_id}|${row.property}`)).size).toBe(
      twice.rows.length,
    );
  });

  it('records the selection policy that was actually in force', () => {
    const policy = result.manifest.selection_policy;
    expect(policy.at).toBe(GENERATED_AT);
    expect(policy.require_publishable_rights).toBe(true);
    expect(policy.authoritative_source_types).toContain('MANUFACTURER');
    expect(policy.consistency_checks.length).toBeGreaterThan(0);
    expect(policy.entity_statuses).toEqual(['ACTIVE']);
    expect(policy.properties).toEqual({
      mode: 'allowlist',
      include: expect.arrayContaining(['refrigerant', 'seer2_rating']) as unknown,
    });
    expect(policy.ordering.facts).toEqual(['entity_slug', 'entity_id', 'property']);
  });
});

describe('rights and attribution travel with the data', () => {
  it('lists every contributing source with its classification', () => {
    const keys = result.manifest.sources.map((source) => source.source_key);
    expect(keys).toEqual([...keys].sort());
    expect(keys).toContain('acme-docs');
    expect(keys).toContain('ratings-directory');
    expect(keys).toContain('spec-aggregator');
    // The forum backs nothing in this export, so it is not in the manifest.
    expect(keys).not.toContain('hvac-forum');
  });

  it('carries the required credit line for the source that demands one', () => {
    const certifier = result.manifest.sources.find((source) => source.source_key === 'ratings-directory');
    expect(certifier).toBeDefined();
    expect(certifier?.rights.attribution_required).toBe(true);
    expect(certifier?.rights.attribution_text).toBe('Certification data courtesy of the Ratings Directory');
    expect(certifier?.rights.attribution_url).toBe('https://www.ratings-directory.example.org/');
    expect(certifier?.rights.license_id).toBe('CC-BY-4.0');
    expect(certifier?.rights.data_license_id).toBe('CC-BY-4.0');
    expect(certifier?.rights.terms_url).toBe('https://ratings-directory.example.org/terms');
  });

  it('says out loud that an AMBER source publishes with conditions', () => {
    const aggregator = result.manifest.sources.find(
      (source) => source.source_key === 'spec-aggregator',
    );
    expect(aggregator?.rights.rights_classification).toBe('AMBER');
    expect(aggregator?.rights.requires_legal_review).toBe(true);
    expect(aggregator?.rights.warnings.join(' ')).toContain('AMBER');
  });

  it('records the redistribution terms each source was published under', () => {
    for (const source of result.manifest.sources) {
      expect(source.rights.redistribution_allowed).toBe(true);
      expect(source.rights.commercial_use_allowed).toBe(true);
      expect(source.rights.derivative_normalization_allowed).toBe(true);
      expect(typeof source.rights.personal_data_present).toBe('boolean');
      expect(source.fact_count).toBeGreaterThan(0);
      expect(source.evidence_count).toBeGreaterThan(0);
    }
  });

  it('contradicts the assumption that the data is MIT', () => {
    expect(result.manifest.rights_notice).toContain('not MIT-licensed');
    expect(result.manifest.rights_notice).toContain('cannot license data');
  });
});

describe('the fact files', () => {
  it('JSONL round-trips to exactly the rows that were built', () => {
    expect(jsonLines(FACTS_JSONL)).toEqual(result.rows.map((row) => ({ ...row })));
  });

  it('emits no JSONL line a reader cannot parse', () => {
    // Driven off the manifest's own file list rather than a hard-coded pair, so
    // a fourth file added later is covered by this on the day it ships. The
    // line count is checked against the manifest too: a file whose lines all
    // parse because there are none would otherwise pass this quietly.
    const jsonl = result.manifest.files.filter((file) => file.format === 'jsonl');
    expect(jsonl.length).toBeGreaterThan(0);
    let parsed = 0;
    for (const file of jsonl) {
      for (const line of text(file.path).split('\n').filter((candidate) => candidate !== '')) {
        expect(() => JSON.parse(line) as unknown, `${file.path}: ${line.slice(0, 80)}`).not.toThrow();
        parsed += 1;
      }
    }
    expect(parsed).toBe(jsonl.reduce((total, file) => total + file.rows, 0));
  });

  it('publishes the shared serializer’s columns plus the entity identity', () => {
    const [first] = jsonLines(FACTS_JSONL);
    expect(first).toBeDefined();
    expect(Object.keys(first as Record<string, unknown>)).toEqual(
      result.manifest.files.find((file) => file.path === FACTS_JSONL)?.columns,
    );
    expect(Object.keys(first as Record<string, unknown>)).toEqual([
      'vertical_slug',
      'entity_id',
      'entity_type',
      'entity_slug',
      'entity_name',
      'property',
      'value',
      'value_type',
      'unit',
      'confidence',
      'fact_id',
      'rule',
      'sources',
      'unresolved_conflict',
      'editorially_corrected',
      'editorial_correction_reason',
      'selection_warnings',
    ]);
  });

  it('CSV has one record per fact row despite an embedded CRLF in a value', () => {
    const csv = text(FACTS_CSV);
    const hostile = result.rows.find((row) => row.property === CSV_HOSTILE_PROPERTY);
    expect(hostile?.value).toBe(CSV_HOSTILE_VALUE);
    // The raw text contains more newlines than there are records, which is why
    // the row count has to come from the manifest and a reader, not a split.
    expect(csv.split('\n').length).toBeGreaterThan(result.rows.length + 2);
    expect(csv).toContain('"Parts, labor ""included""');
  });

  it('carries the trust surface, not just the value', () => {
    const seer = result.rows.find(
      (row) => row.property === 'seer2_rating' && row.entity_slug === 'carrier-infinity-24anb7',
    );
    expect(seer?.value).toBe('16');
    expect(seer?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(seer?.sources).toBe('Acme Climate');
    expect(seer?.editorially_corrected).toBe(false);
    expect(seer?.editorial_correction_reason).toBeNull();
    expect(typeof seer?.unresolved_conflict).toBe('boolean');
  });

  it('never publishes an excluded property', () => {
    expect(result.rows.some((row) => row.property === INTERNAL_PROPERTY)).toBe(false);
    for (const path of [FACTS_JSONL, FACTS_CSV, EVIDENCE_JSONL, MANIFEST_JSON]) {
      expect(text(path)).not.toContain(INTERNAL_PROPERTY);
      expect(text(path)).not.toContain(INTERNAL_VALUE);
    }
  });
});

describe('every published value can be explained (rule 10)', () => {
  it('ships an evidence row for every fact row that has a value', () => {
    const evidenced = new Set(result.evidence.map((row) => row.fact_id));
    for (const row of result.rows) {
      if (row.fact_id === null) continue;
      expect(evidenced.has(row.fact_id), `${row.entity_slug}.${row.property}`).toBe(true);
    }
  });

  it('each evidence row names the artifact, its hash, when it was fetched and where in it', () => {
    const [link] = result.evidence;
    expect(link).toBeDefined();
    expect(link?.artifact_url).toMatch(/^https:\/\//);
    expect(link?.artifact_content_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(link?.artifact_retrieved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(link?.locator_type).toBe('CSS_SELECTOR');
    expect(link?.locator_value).toContain('data-field=');
    expect(link?.source_value.length).toBeGreaterThan(0);
    expect(link?.source_key).not.toBe('');
  });

  it('does not publish the internal object-store layout of our artifacts', () => {
    expect(text(EVIDENCE_JSONL)).not.toContain('r2://');
    expect(text(MANIFEST_JSON)).not.toContain('r2://');
  });

  it('evidence joins back to the fact rows by (entity_id, property, fact_id)', () => {
    const factKeys = new Set(
      result.rows
        .filter((row) => row.fact_id !== null)
        .map((row) => `${row.entity_id}|${row.property}|${row.fact_id ?? ''}`),
    );
    for (const link of result.evidence) {
      expect(factKeys.has(`${link.entity_id}|${link.property}|${link.fact_id}`)).toBe(true);
    }
  });
});
