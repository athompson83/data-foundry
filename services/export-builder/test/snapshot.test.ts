/**
 * Where the bytes go, and the `dataset_snapshots` row that records they went
 * there.
 *
 * `dataset_snapshots` has existed since migration 0007 and nothing has ever
 * written or read it as a product. These tests are the first thing that does,
 * against the real table in a real (PGlite) Postgres with the real migrations
 * applied — so "the manifest conforms to the schema" is checked by the schema
 * rather than by a type assertion.
 */
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FACTS_JSONL,
  MANIFEST_JSON,
  buildDatasetExport,
  createDirectorySink,
  createMemorySink,
  recordDatasetSnapshot,
  sha256,
} from '../src/index.js';
import { baseOptions, createExportFixtures, type ExportFixtures } from './support.js';

let fixtures: ExportFixtures;
let directory: string;

beforeAll(async () => {
  fixtures = await createExportFixtures();
  directory = await mkdtemp(join(tmpdir(), 'df-export-'));
}, 120_000);

afterAll(async () => {
  await fixtures?.driver.close();
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
});

describe('the directory sink', () => {
  it('writes every artifact, and the bytes on disk match the manifest checksums', async () => {
    const sink = createDirectorySink(directory);
    const result = await buildDatasetExport({ ...baseOptions(fixtures), sink });

    expect((await readdir(directory)).sort()).toEqual(
      ['evidence.jsonl', 'facts.csv', FACTS_JSONL, MANIFEST_JSON].sort(),
    );
    for (const file of result.manifest.files) {
      const bytes = await readFile(join(directory, file.path));
      expect(sha256(new Uint8Array(bytes))).toBe(file.sha256);
      expect(bytes.byteLength).toBe(file.bytes);
    }
    const manifestOnDisk = await readFile(join(directory, MANIFEST_JSON));
    expect(sha256(new Uint8Array(manifestOnDisk))).toBe(result.manifestSha256);
  });

  it('records a scheme-qualified URI that resolves to the file it wrote', async () => {
    const sink = createDirectorySink(directory);
    const result = await buildDatasetExport({ ...baseOptions(fixtures), sink });
    expect(result.manifest.manifest_uri.startsWith('file://')).toBe(true);
    const path = fileURLToPath(result.manifest.manifest_uri);
    expect(JSON.parse(await readFile(path, 'utf8'))).toMatchObject({ version: '2026-08-14.1' });
  });

  it('refuses a path that would escape the export root', () => {
    const sink = createDirectorySink(directory);
    expect(() => sink.uriFor('../escape.json')).toThrow(/traversal/);
    expect(() => sink.uriFor('/etc/passwd')).toThrow(/relative/);
    expect(() => sink.uriFor('a\\b')).toThrow(/relative/);
  });
});

describe('recording the snapshot in dataset_snapshots', () => {
  it('writes the row the manifest projects to, and reads it back unchanged', async () => {
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      version: '2026-08-14.2',
      sink: createMemorySink('recorded'),
    });

    const snapshot = await recordDatasetSnapshot(fixtures.store, result.manifest);
    expect(snapshot.vertical_id).toBe(fixtures.vertical.id);
    expect(snapshot.version).toBe('2026-08-14.2');
    expect(snapshot.status).toBe('PUBLISHED');
    expect(snapshot.checksums).toEqual(result.manifest.checksums);
    expect(snapshot.record_counts).toEqual(result.manifest.record_counts);
    expect(snapshot.manifest_uri).toBe(result.manifest.manifest_uri);
    expect(snapshot.schema_version).toBe(fixtures.vertical.schema_version);

    const readBack = await fixtures.store.getDatasetSnapshot(fixtures.vertical.id, '2026-08-14.2');
    expect(readBack).toEqual(snapshot);
  });

  it('lets a build be marked BUILDING first and PUBLISHED after, on one row', async () => {
    const result = await buildDatasetExport({
      ...baseOptions(fixtures),
      version: '2026-08-14.3',
      sink: createMemorySink('two-phase'),
    });

    const building = await recordDatasetSnapshot(fixtures.store, result.manifest, 'BUILDING');
    expect(building.status).toBe('BUILDING');
    const published = await recordDatasetSnapshot(fixtures.store, result.manifest, 'PUBLISHED');
    expect(published.status).toBe('PUBLISHED');
    expect(published.id).toBe(building.id);

    const rows = await fixtures.driver.query<{ count: string }>(
      'SELECT count(*)::text AS count FROM dataset_snapshots WHERE vertical_id = $1 AND version = $2',
      [fixtures.vertical.id, '2026-08-14.3'],
    );
    expect(rows[0]?.count).toBe('1');
  });

  it('keeps distinct versions as distinct, immutable rows', async () => {
    const rows = await fixtures.driver.query<{ version: string }>(
      'SELECT version FROM dataset_snapshots WHERE vertical_id = $1 ORDER BY version',
      [fixtures.vertical.id],
    );
    expect(rows.map((row) => row.version)).toEqual(['2026-08-14.2', '2026-08-14.3']);
  });
});
