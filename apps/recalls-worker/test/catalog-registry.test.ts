/**
 * Keeps the public catalog (data.aroqon.com/#datasets) in step with the
 * dataset pipeline registry. A dataset that reaches LIVE in
 * docs/sources/pipeline/candidates.yaml fails this test until it has a
 * DATASETS entry, and a catalog entry can never point at a registry entry that
 * has not been built.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { DATASETS, type DatasetEntry } from '../src/catalog.js';

const REGISTRY = fileURLToPath(new URL('../../../docs/sources/pipeline/candidates.yaml', import.meta.url));

interface RegistryEntry {
  readonly key: string;
  readonly stage: string;
  readonly sources?: readonly string[];
}

const registry = parseYaml(readFileSync(REGISTRY, 'utf8')) as { candidates: RegistryEntry[]; datasets: RegistryEntry[] };
const entries: DatasetEntry[] = Object.values(DATASETS);
const byKey = new Map([...registry.candidates, ...registry.datasets].map((entry) => [entry.key, entry]));
const memberOfDataset = new Set(registry.datasets.flatMap((dataset) => dataset.sources ?? []));

describe('public catalog and pipeline registry', () => {
  it('lists every LIVE registry dataset, and every LIVE feed no dataset has adopted', () => {
    const catalogued = new Set(entries.map((entry) => entry.registry));
    const live = [...registry.datasets, ...registry.candidates.filter((candidate) => !memberOfDataset.has(candidate.key))].filter((entry) => entry.stage === 'LIVE');
    expect(live.length).toBeGreaterThan(0);
    for (const entry of live) expect(catalogued.has(entry.key), `${entry.key} is LIVE but missing from DATASETS in src/catalog.ts`).toBe(true);
  });

  it('only catalogs registry entries that are built (BUILDING or LIVE)', () => {
    for (const entry of entries) {
      const source = byKey.get(entry.registry);
      expect(source, `${entry.key}: registry key ${entry.registry} is not in candidates.yaml`).toBeDefined();
      expect(['BUILDING', 'LIVE'], `${entry.key}: ${entry.registry} is ${source?.stage}`).toContain(source?.stage);
    }
  });

  it('gives every entry its own key, registry entry, paths and docs anchor', () => {
    for (const [key, entry] of Object.entries(DATASETS)) expect(entry.key).toBe(key);
    for (const field of ['registry', 'path', 'browsePath', 'docsAnchor', 'statsPath'] as const) {
      const values = entries.map((entry) => entry[field]);
      expect(new Set(values).size, `${field} is unique`).toBe(values.length);
    }
    for (const entry of entries) {
      expect(entry.path).toMatch(/^\/[a-z0-9-]+$/);
      expect(entry.browsePath.startsWith(`${entry.path}/`)).toBe(true);
      expect(entry.docsAnchor).toMatch(/^#[a-z0-9-]+$/);
      const sample = (JSON.parse(entry.sample.response) as { data: Record<string, unknown> }).data;
      for (const field of entry.sample.heroFields) expect(sample, `${entry.key} hero field ${field}`).toHaveProperty(field);
      expect(entry.sample.request).toContain(entry.sample.path);
    }
  });
});
