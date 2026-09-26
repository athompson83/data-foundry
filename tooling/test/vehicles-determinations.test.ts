/**
 * The two committed ADR-0013 determinations for the US federal vehicle
 * sources (docs/sources/determinations/*.yaml).
 *
 * Proves that each file (1) parses under the exact schema `pnpm rights:record`
 * accepts, including its registry cross-check; (2) plans exactly the intended
 * cells; (3) cites evidence whose committed bytes still hash to the recorded
 * digest; and (4) records cleanly in a dry run against a migrated WASM
 * Postgres whose only vehicles state is the committed (fail-closed) registry.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCanonicalStore, type SqlDriver } from '@data-foundry/canonical-store';
import type { Vertical } from '@data-foundry/canonical-schema';
import { toSourceInsert } from '../../packages/source-registry/src/index.js';
import { loadVerticalConfig } from '../../services/ingest-worker/src/index.js';
import { REPO_ROOT, migratedDriver } from '../../tests/support/harness.js';
import {
  DETERMINATION_SURFACES,
  planRightsDetermination,
  type RightsDetermination,
} from '../lib/rights-determination.js';
import {
  loadRightsDeterminationFile,
  recordRightsDetermination,
} from '../scripts/record-rights-determination.js';

const FILES = {
  nhtsa: 'docs/sources/determinations/nhtsa-recalls.yaml',
  epa: 'docs/sources/determinations/epa-fueleconomy-vehicles.yaml',
} as const;

let nhtsa: RightsDetermination;
let epa: RightsDetermination;

beforeAll(async () => {
  nhtsa = await loadRightsDeterminationFile(FILES.nhtsa, REPO_ROOT);
  epa = await loadRightsDeterminationFile(FILES.epa, REPO_ROOT);
});

const cells = (determination: RightsDetermination): string[] =>
  planRightsDetermination(determination).cells.map((cell) => `${cell.state}:${cell.operation}:${cell.channel}`);

describe('nhtsa-recalls determination', () => {
  it('is a § 105 determination that allows every surface and internal operation', () => {
    expect(nhtsa.basis).toBe('PUBLIC_DOMAIN_US_GOVERNMENT_WORK');
    expect(nhtsa.source).toEqual({ domain: 'static.nhtsa.gov', source_type: 'REGULATORY_FILING' });
    expect(nhtsa.scope).toMatchObject({ acquisition_route: 'BULK_FILE', asset_class: 'DATA', output_class: 'NORMALIZED_FACT' });
    for (const surface of DETERMINATION_SURFACES) expect(nhtsa.surfaces[surface].decision, surface).toBe('ALLOW');
    const plan = planRightsDetermination(nhtsa);
    expect(plan.unknownSurfaces).toEqual([]);
    expect(plan.unknownInternalOperations).toEqual([]);
    expect(plan.cells.every((cell) => cell.state === 'ALLOW')).toBe(true);
    expect(cells(nhtsa)).toEqual(expect.arrayContaining([
      'ALLOW:ACQUIRE:INTERNAL_PROCESSING',
      'ALLOW:SELL_API_ACCESS:DIRECT_CUSTOMER_API',
      'ALLOW:OFFER_BULK_EXPORT:BULK_DOWNLOAD',
    ]));
  });
});

describe('epa-fueleconomy-vehicles determination', () => {
  it('rests on the published terms and refuses every customer surface', () => {
    // fueleconomy.gov's copyright statement limits use to non-commercial,
    // scientific and educational purposes, so § 105 is not available.
    expect(epa.basis).toBe('PUBLISHED_TERMS_PERMIT');
    expect(epa.evidence.find((entry) => entry.key === epa.terms_evidence)?.kind).toBe('TERMS');
    for (const surface of DETERMINATION_SURFACES) expect(epa.surfaces[surface].decision, surface).toBe('UNKNOWN');
    const plan = planRightsDetermination(epa);
    expect(plan.unknownSurfaces).toEqual([...DETERMINATION_SURFACES]);
    expect(plan.unknownInternalOperations).toEqual(['NORMALIZE', 'DERIVE']);
    expect(cells(epa)).toEqual([
      'ALLOW:ACQUIRE:INTERNAL_PROCESSING',
      'ALLOW:CACHE:INTERNAL_PROCESSING',
      'ALLOW:STORE:INTERNAL_PROCESSING',
    ]);
  });
});

describe('committed evidence', () => {
  it.each(Object.entries(FILES))('%s: every repo:// evidence digest matches the committed bytes', async (_name, file) => {
    const determination = await loadRightsDeterminationFile(file, REPO_ROOT);
    for (const entry of determination.evidence) {
      expect(entry.storage_uri.startsWith('repo://'), entry.key).toBe(true);
      const bytes = await readFile(join(REPO_ROOT, entry.storage_uri.slice('repo://'.length)));
      expect(createHash('sha256').update(bytes).digest('hex'), entry.key).toBe(entry.content_sha256);
      expect(Date.parse(entry.retrieved_at), entry.key).toBeLessThanOrEqual(Date.parse(determination.reviewed_at));
    }
    expect(determination.determination_document).toBe('docs/sources/vehicles-federal-rights-determination-20260926.md');
  });

  it('keeps the vehicle source registry fail-closed until activation', async () => {
    const config = await loadVerticalConfig('vehicles', { verticalsDir: join(REPO_ROOT, 'verticals') });
    for (const entry of config.sources) {
      expect(entry.status, entry.key).toBe('UNDER_REVIEW');
      expect(entry.rights_classification, entry.key).toBe('UNREVIEWED');
    }
  });
});

describe('dry-run recording against a migrated database', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = await migratedDriver();
    const store = createCanonicalStore(driver);
    const config = await loadVerticalConfig('vehicles', { verticalsDir: join(REPO_ROOT, 'verticals') });
    const vertical = await store.upsertVertical({
      slug: config.slug,
      name: config.name,
      schema_version: config.schemaVersion,
      status: config.status as Vertical['status'],
      default_refresh_policy: config.defaultRefreshPolicy as Vertical['default_refresh_policy'],
    });
    for (const entry of config.sources) await store.upsertSource(toSourceInsert(entry, vertical.id));
  }, 120_000);

  afterAll(async () => {
    await driver?.close();
  });

  it.each(Object.entries(FILES))('%s records in a dry run and leaves nothing behind', async (_name, file) => {
    const determination = await loadRightsDeterminationFile(file, REPO_ROOT);
    const result = await recordRightsDetermination(driver, determination, { dryRun: true });
    expect(result.dry_run).toBe(true);
    expect(result.committed).toBe(false);
    const [decisions] = await driver.query<{ n: number }>(`SELECT count(*)::integer AS n FROM rights_decisions`);
    const [publishers] = await driver.query<{ n: number }>(`SELECT count(*)::integer AS n FROM rights_publishers`);
    expect(decisions?.n).toBe(0);
    expect(publishers?.n).toBe(0);
  }, 120_000);
});
