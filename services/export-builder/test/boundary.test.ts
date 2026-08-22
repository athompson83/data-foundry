/**
 * The two boundaries this service is bound by, asserted rather than reviewed.
 *
 * ADR-0004 records the requirement and then says: *"Enforcement (deferred).
 * When the first customer-facing surface lands, add a boundary test asserting
 * that no module outside `@data-foundry/query-model` constructs a fact wire
 * object literal — the same shape of dependency-boundary test used elsewhere in
 * the repository, rather than reviewer discipline."* This is that surface, so
 * this is that test.
 *
 * It is a BEHAVIOURAL check, not a grep for object literals. A text scan asks
 * "does this look hand-rolled"; what actually matters is whether a published
 * row carries every field the shared serializer produces. So the test takes a
 * real `CanonicalFactView` out of the query layer, runs it through
 * `toExportRow`, and asserts the published row contains that projection
 * verbatim. A surface that re-implemented the mapper and dropped
 * `selectionWarnings` fails here whatever its code looks like.
 *
 * The second boundary is `tests/contract/ordering-determinism`: every layer
 * that decides what gets published orders by code unit, never by the host
 * collator. That test's guarded roots do not include this service — it predates
 * it — so the same rule is asserted here over this service's own sources.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { toExportRow, type CanonicalFactView } from '@data-foundry/query-model';
import {
  EXPORT_FACT_COLUMNS,
  buildDatasetExport,
  createMemorySink,
  type DatasetExportResult,
} from '../src/index.js';
import { GENERATED_AT, baseOptions, createExportFixtures, type ExportFixtures } from './support.js';

const SERVICE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(SERVICE_ROOT, 'src');

function sourceFiles(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) found.push(path);
    }
  };
  walk(root);
  return found;
}

/** Comments name the banned APIs to explain them; only code is scanned. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

let fixtures: ExportFixtures;
let result: DatasetExportResult;
let views: CanonicalFactView[];

beforeAll(async () => {
  fixtures = await createExportFixtures();
  result = await buildDatasetExport({ ...baseOptions(fixtures), sink: createMemorySink('bound') });
  views = await fixtures.qm.canonicalFacts(fixtures.equipment.id, { at: GENERATED_AT });
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('ADR-0004 — one producer for the fact wire object', () => {
  it('publishes the shared serializer’s projection verbatim, field for field', () => {
    const published = new Map(
      result.rows
        .filter((row) => row.entity_id === fixtures.equipment.id)
        .map((row) => [row.property, row] as const),
    );
    let compared = 0;
    for (const view of views) {
      const row = published.get(view.property);
      if (row === undefined) continue; // excluded by the property policy
      const expected = toExportRow(view);
      for (const [field, value] of Object.entries(expected)) {
        expect(
          (row as unknown as Record<string, unknown>)[field],
          `${view.property}.${field} must come from toExportRow`,
        ).toEqual(value);
      }
      compared += 1;
    }
    expect(compared, 'the comparison must not pass vacuously').toBeGreaterThan(3);
  });

  it('publishes every field the shared serializer produces, none dropped', () => {
    const sample = views[0];
    expect(sample).toBeDefined();
    expect(Object.keys(toExportRow(sample as CanonicalFactView)).sort()).toEqual(
      [...EXPORT_FACT_COLUMNS].sort(),
    );
  });

  it('imports the shared serializer exactly once across the service', () => {
    const hits = sourceFiles(SRC).filter((file) =>
      stripComments(readFileSync(file, 'utf8')).includes('toExportRow'),
    );
    expect(hits.map((file) => relative(SERVICE_ROOT, file))).toEqual([join('src', 'rows.ts')]);
  });

  it('never re-implements the fact projection from a CanonicalFactView', () => {
    // `toExportRow` is the only thing allowed to read a canonical view's value
    // and correction fields. Nothing else in the service may touch them.
    for (const file of sourceFiles(SRC)) {
      if (file.endsWith(join('src', 'rows.ts'))) continue;
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${relative(SERVICE_ROOT, file)} must not read a view's value directly`).not.toMatch(
        /view\.(normalized_)?value\b|view\.selection_warnings\b|view\.editorial_correction_reason\b/,
      );
    }
  });
});

describe('published decisions are locale-independent', () => {
  it('scans a non-trivial number of files, so a path typo cannot pass vacuously', () => {
    expect(sourceFiles(SRC).length).toBeGreaterThan(5);
  });

  it('consults no collator anywhere on the path to a published byte', () => {
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(
        code,
        `${relative(SERVICE_ROOT, file)} must order by code unit (compareCodeUnits), ` +
          'never by the host collator',
      ).not.toMatch(/\.localeCompare\(|toLocale[A-Z]|\bIntl\./);
    }
  });

  it('makes no network call and reaches no cloud SDK', () => {
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${relative(SERVICE_ROOT, file)} must not fetch`).not.toMatch(
        /\bfetch\(|node:https?\b|XMLHttpRequest|@aws-sdk|S3Client/,
      );
    }
  });
});

describe('rule 5 — the service reads through the query layer and nothing beneath it', () => {
  it('never imports the store’s SQL driver or opens a connection', () => {
    for (const file of sourceFiles(SRC)) {
      const code = stripComments(readFileSync(file, 'utf8'));
      expect(code, `${relative(SERVICE_ROOT, file)}`).not.toMatch(
        /createPgliteDriver|createPostgresDriver|createDriverFromEnv/,
      );
      // Raw SQL belongs to the store. An export builder writing SELECT is the
      // start of a second, quietly divergent definition of the canonical view.
      expect(code, `${relative(SERVICE_ROOT, file)} must not write SQL`).not.toMatch(
        /\bSELECT\s+[\w*]|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b/i,
      );
    }
  });

  it('touches the store only where a write genuinely needs one', () => {
    const importers = sourceFiles(SRC).filter((file) =>
      /from '@data-foundry\/canonical-store'/.test(stripComments(readFileSync(file, 'utf8'))),
    );
    // `privacy.ts` imports a TYPE only. `builder.ts` imports a VALUE —
    // `resolveFactSelectionPolicy`, called to record the effective policy in
    // the manifest — and `snapshot.ts` takes an injected `CanonicalStore` to
    // write the snapshot row. This comment used to say all three were type-only
    // imports, which was wrong about two of them, so the value imports are now
    // pinned by name rather than described.
    expect(importers.map((file) => relative(SERVICE_ROOT, file)).sort()).toEqual(
      [join('src', 'builder.ts'), join('src', 'privacy.ts'), join('src', 'snapshot.ts')].sort(),
    );

    const valueImporters = sourceFiles(SRC).filter((file) =>
      /^import\s+(?!type\b)[^;]*from '@data-foundry\/canonical-store'/m.test(
        stripComments(readFileSync(file, 'utf8')),
      ),
    );
    expect(
      valueImporters.map((file) => relative(SERVICE_ROOT, file)).sort(),
      'a new file executing store code is a boundary decision, not a detail',
    ).toEqual([join('src', 'builder.ts')]);
  });
});
