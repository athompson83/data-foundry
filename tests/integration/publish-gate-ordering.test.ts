/**
 * A missing internal DERIVE grant must stop before canonical identity writes.
 *
 * The accepted rights matrix replaces the old source-wide publication
 * booleans. Synthetic ACQUIRE/STORE/CACHE/NORMALIZE permissions are explicit
 * here, while DERIVE is intentionally absent. The source may retain its raw
 * evidence, but it may not turn that evidence into entities, aliases, facts,
 * relationships, or resolution judgments.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  InMemoryArtifactStore,
  Pipeline,
  loadVerticalConfig,
} from '../../services/ingest-worker/src/index.js';
import {
  REPO_ROOT,
  migratedDriver,
  RUN_1_AT,
  seedSyntheticInternalRights,
} from '../support/harness.js';
import { createCanonicalStore } from '../../packages/canonical-store/src/index.js';

type Driver = Awaited<ReturnType<typeof migratedDriver>>;

const BLOCKED_SOURCE = 'acme-hvac-catalog';

let driver: Driver;
let resultText = '';

async function count(table: string): Promise<number> {
  const rows = await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(rows[0]?.n ?? '0');
}

beforeAll(async () => {
  driver = await migratedDriver();
  const verticalsDir = join(REPO_ROOT, 'verticals');
  const config = await loadVerticalConfig('hvac', { verticalsDir });
  await seedSyntheticInternalRights(driver, createCanonicalStore(driver), config, {
    omit: { [BLOCKED_SOURCE]: ['DERIVE'] },
  });

  const pipeline = await Pipeline.create({
    driver,
    verticalSlug: 'hvac',
    verticalsDir,
    artifactStore: new InMemoryArtifactStore(),
    now: RUN_1_AT,
    runId: 'matrix-derive-ordering-probe',
  });
  resultText = JSON.stringify(await pipeline.runVertical({ sources: [BLOCKED_SOURCE] }));
});

afterAll(async () => {
  await driver?.close();
});

describe('the internal rights matrix runs before any canonical write', () => {
  it('records the exact refused operation', () => {
    expect(resultText).toMatch(/RIGHTS_MATRIX_REFUSED/i);
    expect(resultText).toMatch(/DERIVE\/METADATA\/\*=NO_GRANT/i);
  });

  it('commits no canonical entities or aliases', async () => {
    expect(await count('entities')).toBe(0);
    expect(await count('entity_aliases')).toBe(0);
    expect(await count('entity_evidence')).toBe(0);
  });

  it('writes no merge judgments, facts, or relationships', async () => {
    expect(await count('resolution_judgments')).toBe(0);
    expect(await count('resolution_candidates')).toBe(0);
    expect(await count('facts')).toBe(0);
    expect(await count('relationships')).toBe(0);
  });

  it('leaves no ACTIVE entity for any query surface to inspect', async () => {
    const rows = await driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM entities WHERE status = 'ACTIVE'`,
    );
    expect(Number(rows[0]?.n ?? '0')).toBe(0);
  });
});
