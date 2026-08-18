/**
 * Finding #3 — canonical entities were committed before the publish gate ran.
 *
 * `#resolveRecord` wrote entities, aliases and MERGE judgments, and only THEN
 * did `evaluateSourcePublishGate` run. Nothing wrapped the two, so a
 * `RightsViolationError` left every one of those writes standing.
 *
 * That is not a cosmetic ordering problem. `canonical_name` and
 * `canonical_slug` ARE derivative normalization of the source's data, so a
 * source whose own gate message reads "canonical facts cannot be built from it"
 * was nonetheless producing live canonical entities — and no read path filters
 * entities by source rights, so `query-model` served them.
 *
 * The vertical is copied to a temp directory with the right revoked, because
 * `Pipeline.create` loads its own config from `verticalsDir` — patching an
 * in-memory registry does not reach it, and `InMemorySourceRegistry` deep-copies
 * its entries on construction anyway.
 *
 * AGENTS.md rule 1: unreviewed/RED sources must not publish.
 */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryArtifactStore, Pipeline } from '../../services/ingest-worker/src/index.js';
import { REPO_ROOT, migratedDriver, RUN_1_AT } from '../support/harness.js';

type Driver = Awaited<ReturnType<typeof migratedDriver>>;

const BLOCKED_SOURCE = 'acme-hvac-catalog';

let driver: Driver;
let verticalsDir: string;
let runFailed = false;
let failureText = '';

async function count(table: string): Promise<number> {
  const rows = await driver.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`);
  return Number(rows[0]?.n ?? '0');
}

beforeAll(async () => {
  verticalsDir = mkdtempSync(join(tmpdir(), 'df-gate-'));
  cpSync(join(REPO_ROOT, 'verticals'), verticalsDir, { recursive: true });

  // Revoke the one right the gate exists to protect.
  const sourceFile = join(verticalsDir, 'hvac', 'sources', `${BLOCKED_SOURCE}.yaml`);
  const original = readFileSync(sourceFile, 'utf8');
  const revoked = original.replace(
    /derivative_normalization_allowed:\s*true/,
    'derivative_normalization_allowed: false',
  );
  expect(revoked, 'the flag must actually have been flipped').not.toBe(original);
  writeFileSync(sourceFile, revoked, 'utf8');

  driver = await migratedDriver();

  const pipeline = await Pipeline.create({
    driver,
    verticalSlug: 'hvac',
    verticalsDir,
    artifactStore: new InMemoryArtifactStore(),
    now: RUN_1_AT,
    runId: 'gate-ordering-probe',
  });

  try {
    const result = await pipeline.runVertical({ sources: [BLOCKED_SOURCE] });
    failureText = JSON.stringify(result);
    runFailed = /DERIVATIVE_NORMALIZATION_NOT_ALLOWED|RightsViolation|FAILED/i.test(failureText);
  } catch (error) {
    runFailed = true;
    failureText = String(error);
  }
});

afterAll(async () => {
  await driver?.close();
  if (verticalsDir !== undefined) rmSync(verticalsDir, { recursive: true, force: true });
});

describe('the publish gate runs before any canonical write', () => {
  it('refuses the source', () => {
    expect(runFailed).toBe(true);
    expect(failureText).toMatch(/DERIVATIVE_NORMALIZATION_NOT_ALLOWED/i);
  });

  it('commits no canonical entities from a source that may not be normalized', async () => {
    // The audit measured 7 entities and 20 aliases surviving here.
    expect(await count('entities')).toBe(0);
    expect(await count('entity_aliases')).toBe(0);
  });

  it('writes no merge judgments for a blocked source', async () => {
    // A MERGE judgment asserts a canonical identity decision was taken. Taking
    // one for a source that may not be normalized is the same violation as the
    // entity write, one layer down.
    expect(await count('resolution_judgments')).toBe(0);
    expect(await count('resolution_candidates')).toBe(0);
  });

  it('writes no facts or relationships', async () => {
    expect(await count('facts')).toBe(0);
    expect(await count('relationships')).toBe(0);
  });

  it('leaves no ACTIVE entity for the query layer to serve', async () => {
    // The reason the ordering mattered: no read path filters entities by source
    // rights, so anything committed here is immediately queryable. Asserted in
    // SQL rather than through the query model, because the repo-root `tests/`
    // project resolves relative paths only — the guarantee is the same.
    const rows = await driver.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM entities WHERE status = 'ACTIVE'`,
    );
    expect(Number(rows[0]?.n ?? '0')).toBe(0);
  });
});
