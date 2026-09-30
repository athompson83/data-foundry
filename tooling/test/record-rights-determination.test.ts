import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stringify as stringifyYaml } from 'yaml';
import { loadStoredRightsContext, type SqlDriver } from '@data-foundry/canonical-store';
import {
  authorizeSurface,
  evaluateRights,
  type ContributionRightsEvaluation,
  type RightsSurface,
} from '@data-foundry/rights-engine';
import { createFixtures, type Fixtures } from '../../packages/canonical-store/test/support.js';
import { seedSyntheticSurfaceRights } from '../../packages/query-model/test/support.js';
import {
  DETERMINATION_ACTOR,
  parseRightsDetermination,
  planRightsDetermination,
  RightsDeterminationError,
  type RightsDetermination,
} from '../lib/rights-determination.js';
import {
  loadRightsDeterminationFile,
  parseRecordDeterminationArgs,
  recordRightsDetermination,
  runRecordRightsDeterminationCli,
} from '../scripts/record-rights-determination.js';

const DAY = 86_400_000;
const reviewedAt = new Date(Date.now() - 2 * DAY).toISOString();
const recheckAt = new Date(Date.now() + 300 * DAY).toISOString();

const unknown = (why: string) => ({ decision: 'UNKNOWN' as const, rationale: why });
const allow = (why: string) => ({ decision: 'ALLOW' as const, rationale: why });
const deny = (why: string) => ({ decision: 'DENY' as const, rationale: why });

function determinationInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    source_key: 'acme-hvac-catalog',
    vertical_slug: 'hvac',
    source: { domain: 'catalog.acme-climate.example.com', source_type: 'MANUFACTURER' },
    publisher: { publisher_key: 'acme-climate-synthetic', legal_name: 'Acme Climate (synthetic)' },
    basis: 'PUBLISHED_TERMS_PERMIT',
    evidence: [
      {
        key: 'terms',
        kind: 'TERMS',
        canonical_uri: 'https://catalog.acme-climate.example.com/terms',
        storage_uri: 'r2://rights-evidence/acme/terms-v1.html',
        content_sha256: 'a'.repeat(64),
        mime_type: 'text/html',
        retrieved_at: reviewedAt,
      },
      {
        key: 'memo',
        kind: 'REVIEW_MEMO',
        canonical_uri: 'repo://docs/sources/determinations/acme-hvac-catalog.yaml',
        storage_uri: 'repo://docs/sources/determinations/acme-hvac-catalog.yaml',
        content_sha256: 'b'.repeat(64),
        mime_type: 'application/yaml',
        retrieved_at: reviewedAt,
      },
    ],
    terms_evidence: 'terms',
    decision_evidence: 'memo',
    clause_ref: 'Terms §3 (commercial API redistribution permitted)',
    reviewed_at: reviewedAt,
    recheck_at: recheckAt,
    scope: {
      acquisition_route: 'DIRECT_HTTP',
      account_or_product_plan: null,
      jurisdiction: null,
      asset_class: 'DATA',
      output_class: 'NORMALIZED_FACT',
    },
    surfaces: {
      PUBLIC_WEB: unknown('display terms not reviewed'),
      SEARCH_INDEX: unknown('indexing not reviewed'),
      API_FREE: allow('terms permit API access'),
      API_PAID: allow('terms permit commercial API resale of normalized data'),
      RAPIDAPI: unknown('marketplace sublicensing not addressed by the terms'),
      MCP: unknown('agent retrieval not reviewed'),
      BULK_EXPORT: deny('terms §5 forbid bulk redistribution'),
    },
    internal_processing: {
      ACQUIRE: allow('documented public JSON endpoint'),
      STORE: allow('retention permitted'),
      CACHE: allow('caching permitted'),
    },
    ...overrides,
  };
}

const determination = (overrides: Record<string, unknown> = {}): RightsDetermination =>
  parseRightsDetermination(determinationInput(overrides));

const RIGHTS_TABLES = [
  'rights_publishers',
  'rights_evidence_artifacts',
  'rights_terms_cells',
  'rights_terms_versions',
  'rights_terms_activation_events',
  'rights_cells',
  'rights_decisions',
  'rights_decision_activation_events',
] as const;

async function counts(driver: SqlDriver): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const table of RIGHTS_TABLES) {
    const [row] = await driver.query<{ n: number }>(`SELECT count(*)::integer AS n FROM ${table}`);
    out[table] = row!.n;
  }
  return out;
}

const reasons = (evaluation: ContributionRightsEvaluation): string[] =>
  evaluation.decisions.map((entry) => entry.decision.reasonCode);

async function evaluate(fixtures: Fixtures, sourceId: string) {
  const asOf = new Date(Date.now() + 1000).toISOString();
  const stored = await loadStoredRightsContext(fixtures.driver, sourceId, asOf);
  if (stored === null) throw new Error('source missing');
  const request = {
    source: stored.source,
    sourceStatusRequirement: 'ACTIVE' as const,
    acquisitionRoute: 'DIRECT_HTTP' as const,
    accountOrProductPlan: null,
    jurisdiction: null,
    assetClass: 'DATA' as const,
    fieldKey: null,
    fieldGroupIds: [],
    outputClass: 'NORMALIZED_FACT' as const,
    asOf,
    conditionReceipts: [],
  };
  return {
    surface: (surface: RightsSurface) =>
      authorizeSurface(surface, [{ contributionId: 'c1', request, snapshot: stored.snapshot }]),
    internal: (operation: 'ACQUIRE' | 'STORE' | 'CACHE' | 'NORMALIZE') =>
      evaluateRights({ ...request, operation, channel: 'INTERNAL_PROCESSING' }, stored.snapshot),
  };
}

describe('determination file schema', () => {
  it('accepts a complete determination and plans exactly the declared cells', () => {
    const plan = planRightsDetermination(determination());
    expect(plan.cells.map((cell) => `${cell.state}:${cell.operation}:${cell.channel}`)).toEqual([
      'ALLOW:ACQUIRE:INTERNAL_PROCESSING',
      'ALLOW:CACHE:INTERNAL_PROCESSING',
      'DENY:OFFER_BULK_EXPORT:BULK_DOWNLOAD',
      'DENY:REDISTRIBUTE_NORMALIZED:BULK_DOWNLOAD',
      'ALLOW:REDISTRIBUTE_NORMALIZED:DIRECT_CUSTOMER_API',
      'ALLOW:SELL_API_ACCESS:DIRECT_CUSTOMER_API',
      'ALLOW:SERVE_API_ACCESS:DIRECT_CUSTOMER_API',
      'ALLOW:STORE:INTERNAL_PROCESSING',
    ]);
    expect(plan.unknownSurfaces).toEqual(['PUBLIC_WEB', 'SEARCH_INDEX', 'RAPIDAPI', 'MCP']);
    const acquire = plan.cells.find((cell) => cell.operation === 'ACQUIRE');
    expect(acquire?.outputClass).toBe('NORMALIZED_FACT');
    expect(plan.cells.find((cell) => cell.operation === 'SELL_API_ACCESS')?.outputClass).toBeNull();
  });

  it('rejects recheck_at more than 12 months after reviewed_at', () => {
    const late = new Date(Date.parse(reviewedAt) + 367 * DAY).toISOString();
    expect(() => determination({ recheck_at: late })).toThrow(/no later than 12 months/);
    const edge = new Date(Date.parse(reviewedAt));
    edge.setUTCFullYear(edge.getUTCFullYear() + 1);
    expect(() => determination({ recheck_at: edge.toISOString() })).not.toThrow();
  });

  it('rejects an unknown basis, AUTOMATED-style fields and missing surfaces', () => {
    expect(() => determination({ basis: 'PUBLICLY_AVAILABLE' })).toThrow(RightsDeterminationError);
    expect(() => determination({ reviewer_type: 'AUTOMATED' })).toThrow(/Unrecognized key/);
    const input = determinationInput();
    delete (input['surfaces'] as Record<string, unknown>)['MCP'];
    expect(() => parseRightsDetermination(input)).toThrow(/surfaces\.MCP/);
  });

  it('requires retrieved terms text except for a § 105 federal work, and agreements for approvals', () => {
    expect(() => determination({ terms_evidence: 'memo' })).toThrow(/retrieved TERMS/);
    expect(() =>
      determination({ terms_evidence: 'memo', basis: 'PUBLIC_DOMAIN_US_GOVERNMENT_WORK' }),
    ).not.toThrow();
    // ADR-0018: free public data needs no written permission; its terms may be silent or absent.
    expect(() => determination({ terms_evidence: 'memo', basis: 'FREE_PUBLIC_ACCESS' })).not.toThrow();
    expect(() => determination({ basis: 'DOCUMENTED_APPROVAL' })).toThrow(/AGREEMENT/);
    expect(() => determination({ decision_evidence: 'terms' })).toThrow(/REVIEW_MEMO/);
  });

  it('refuses personal data', () => {
    const scope = { ...(determinationInput()['scope'] as object), asset_class: 'PERSONAL_DATA' };
    expect(() => determination({ scope })).toThrow(/personal data/);
  });

  it('refuses decisions the shared matrix cannot represent', () => {
    const surfaces = determinationInput()['surfaces'] as Record<string, unknown>;
    // API_PAID's serve cell is API_FREE's only requirement.
    expect(() =>
      planRightsDetermination(determination({ surfaces: { ...surfaces, API_FREE: unknown('x') } })),
    ).toThrow(/API_FREE is declared UNKNOWN but every cell it requires is granted/);
    expect(() =>
      planRightsDetermination(determination({ surfaces: { ...surfaces, API_FREE: deny('x') } })),
    ).toThrow(/cannot hold both/);
  });
});

describe('recordRightsDetermination', () => {
  let fixtures: Fixtures;
  let sourceId: string;

  beforeAll(async () => {
    fixtures = await createFixtures({ trigram: false });
    sourceId = fixtures.sources.manufacturer.source.id;
  });
  afterAll(async () => {
    await fixtures.driver.close();
  });

  it('grants exactly API_PAID/API_FREE and acquisition, refuses UNKNOWN surfaces and writes DENY', async () => {
    const before = await evaluate(fixtures, sourceId);
    expect(before.surface('API_PAID').permitted).toBe(false);

    const result = await recordRightsDetermination(fixtures.driver, determination());
    expect(result).toMatchObject({
      committed: true,
      changed: true,
      publisher: 'CREATED',
      publisher_mapping: 'CREATED',
      evidence: { created: 2, existing: 0 },
      terms: 'CREATED',
      warnings: [],
    });
    expect(result.cells.every((cell) => cell.action === 'CREATED')).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/postgres:/);

    const after = await evaluate(fixtures, sourceId);
    expect(after.surface('API_PAID')).toMatchObject({ permitted: true, reasonCode: 'ALLOW' });
    expect(after.surface('API_FREE').permitted).toBe(true);
    for (const surface of ['RAPIDAPI', 'PUBLIC_WEB', 'SEARCH_INDEX', 'MCP'] as const) {
      expect(after.surface(surface).permitted).toBe(false);
      expect(new Set(reasons(after.surface(surface)))).toEqual(new Set(['NO_GRANT']));
    }
    expect(after.surface('BULK_EXPORT').permitted).toBe(false);
    expect(new Set(after.surface('BULK_EXPORT').decisions.map((entry) => entry.decision.state))).toEqual(
      new Set(['DENY']),
    );
    for (const operation of ['ACQUIRE', 'STORE', 'CACHE'] as const) {
      expect(after.internal(operation).permitted).toBe(true);
    }
    expect(after.internal('NORMALIZE').permitted).toBe(false);

    const [denied] = await fixtures.driver.query<{ n: number }>(
      `SELECT count(*)::integer AS n FROM rights_decisions d JOIN rights_cells c ON c.id = d.cell_id
        WHERE c.source_id = $1 AND d.state = 'DENY' AND c.channel = 'BULK_DOWNLOAD'`,
      [sourceId],
    );
    expect(denied?.n).toBe(2);
  });

  it('never uses AUTOMATED and records the fixed determination identity', async () => {
    const reviewers = await fixtures.driver.query<{ kind: string; type: string; who: string }>(
      `SELECT 'decision' AS kind, reviewer_type AS type, reviewed_by AS who FROM rights_decisions
       UNION ALL SELECT 'decision_activation', actor_type, actor FROM rights_decision_activation_events
       UNION ALL SELECT 'terms_activation', actor_type, actor FROM rights_terms_activation_events
       UNION ALL SELECT 'mapping', rights_publisher_mapping_reviewer_type, rights_publisher_mapping_reviewed_by
                   FROM sources WHERE rights_publisher_id IS NOT NULL`,
    );
    expect(reviewers.length).toBeGreaterThan(0);
    for (const row of reviewers) {
      expect(row.type).toBe('DETERMINATION');
      expect(row.who).toBe(DETERMINATION_ACTOR);
    }
  });

  it('is a no-op when the same determination is already current', async () => {
    const before = await counts(fixtures.driver);
    const result = await recordRightsDetermination(fixtures.driver, determination());
    expect(result).toMatchObject({
      changed: false,
      publisher: 'EXISTING',
      publisher_mapping: 'EXISTING',
      evidence: { created: 0, existing: 2 },
      terms: 'CURRENT',
    });
    expect(result.cells.every((cell) => cell.action === 'NO_CHANGE')).toBe(true);
    expect(await counts(fixtures.driver)).toEqual(before);
  });

  it('dry-run validates a change against the real triggers and writes nothing', async () => {
    const before = await counts(fixtures.driver);
    const changed = determination({
      surfaces: {
        ...(determinationInput()['surfaces'] as object),
        MCP: allow('terms permit agent retrieval'),
      },
    });
    const result = await recordRightsDetermination(fixtures.driver, changed, { dryRun: true });
    expect(result).toMatchObject({ dry_run: true, committed: false, changed: true });
    expect(result.cells.find((cell) => cell.operation === 'LLM_RETRIEVAL')?.action).toBe('CREATED');
    expect(await counts(fixtures.driver)).toEqual(before);
    expect((await evaluate(fixtures, sourceId)).surface('MCP').permitted).toBe(false);
  });

  it('supersedes when the determination changes and retires grants it no longer declares', async () => {
    const previous = await fixtures.driver.query<{ cell_id: string; decision_id: string }>(
      `SELECT DISTINCT ON (e.cell_id) e.cell_id, e.decision_id
         FROM rights_decision_activation_events e JOIN rights_cells c ON c.id = e.cell_id
        WHERE c.source_id = $1 ORDER BY e.cell_id, e.sequence_no DESC`,
      [sourceId],
    );
    const newRecheck = new Date(Date.now() + 200 * DAY).toISOString();
    const surfaces = determinationInput()['surfaces'] as Record<string, unknown>;
    const result = await recordRightsDetermination(
      fixtures.driver,
      determination({
        recheck_at: newRecheck,
        surfaces: {
          ...surfaces,
          API_FREE: unknown('re-review pending'),
          API_PAID: unknown('re-review pending'),
          MCP: allow('terms permit agent retrieval'),
        },
      }),
    );
    expect(result).toMatchObject({ changed: true, terms: 'SUPERSEDED', publisher_mapping: 'EXISTING' });
    const actions = Object.fromEntries(
      result.cells.map((cell) => [`${cell.operation}:${cell.channel}`, `${cell.state}:${cell.action}`]),
    );
    expect(actions).toMatchObject({
      'ACQUIRE:INTERNAL_PROCESSING': 'ALLOW:SUPERSEDED',
      'LLM_RETRIEVAL:MCP_AGENT': 'ALLOW:CREATED',
      'OFFER_BULK_EXPORT:BULK_DOWNLOAD': 'DENY:SUPERSEDED',
      'SELL_API_ACCESS:DIRECT_CUSTOMER_API': 'UNKNOWN:RETIRED_TO_UNKNOWN',
      'SERVE_API_ACCESS:DIRECT_CUSTOMER_API': 'UNKNOWN:RETIRED_TO_UNKNOWN',
    });

    // Every prior current decision is explicitly superseded by its successor.
    for (const row of previous) {
      const [next] = await fixtures.driver.query<{ supersedes_decision_id: string }>(
        `SELECT d.supersedes_decision_id FROM rights_decision_activation_events e
           JOIN rights_decisions d ON d.id = e.decision_id
          WHERE e.cell_id = $1 ORDER BY e.sequence_no DESC LIMIT 1`,
        [row.cell_id],
      );
      expect(next?.supersedes_decision_id).toBe(row.decision_id);
    }
    const [terms] = await fixtures.driver.query<{ n: number; superseding: number }>(
      `SELECT count(*)::integer AS n,
              count(supersedes_terms_version_id)::integer AS superseding
         FROM rights_terms_versions v JOIN rights_terms_cells c ON c.id = v.terms_cell_id
        WHERE c.source_id = $1`,
      [sourceId],
    );
    expect(terms).toEqual({ n: 2, superseding: 1 });

    const after = await evaluate(fixtures, sourceId);
    expect(after.surface('MCP').permitted).toBe(true);
    expect(after.surface('API_PAID').permitted).toBe(false);
    expect(new Set(reasons(after.surface('API_PAID')))).toEqual(new Set(['EXPLICIT_UNKNOWN']));
    expect(after.surface('RAPIDAPI').permitted).toBe(false);
    expect(after.internal('ACQUIRE').permitted).toBe(true);

    // And the changed file is itself idempotent.
    const rerun = await recordRightsDetermination(
      fixtures.driver,
      determination({
        recheck_at: newRecheck,
        surfaces: {
          ...surfaces,
          API_FREE: unknown('re-review pending'),
          API_PAID: unknown('re-review pending'),
          MCP: allow('terms permit agent retrieval'),
        },
      }),
    );
    expect(rerun.changed).toBe(false);
  });

  it('refuses a stale determination and never mutates an evidenced mapping', async () => {
    const past = new Date(Date.now() - 300 * DAY).toISOString();
    await expect(
      recordRightsDetermination(
        fixtures.driver,
        determination({ reviewed_at: past, recheck_at: new Date(Date.now() - DAY).toISOString() }),
      ),
    ).rejects.toThrow(/not current/);

    await seedSyntheticSurfaceRights(fixtures, ['API_PAID'], ['certifier']);
    const before = await counts(fixtures.driver);
    await expect(
      recordRightsDetermination(
        fixtures.driver,
        determination({
          source_key: 'ratings-directory',
          source: { domain: 'ratings-directory.example.org', source_type: 'CERTIFICATION_BODY' },
          publisher: { publisher_key: 'ratings-directory-det', legal_name: 'Ratings Directory' },
        }),
      ),
    ).rejects.toThrow(/different rights publisher/);
    expect(await counts(fixtures.driver)).toEqual(before);
  });
});

describe('determination file and CLI', () => {
  let root: string;
  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'df-determination-'));
    await mkdir(join(root, 'docs/sources/determinations'), { recursive: true });
    await mkdir(join(root, 'verticals/hvac/sources'), { recursive: true });
  });
  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('loads a committed file and enforces its name and registry agreement', async () => {
    const file = join(root, 'docs/sources/determinations/acme-hvac-catalog.yaml');
    await writeFile(file, stringifyYaml(determinationInput()));
    await expect(loadRightsDeterminationFile(file, root)).resolves.toMatchObject({
      source_key: 'acme-hvac-catalog',
    });

    const misnamed = join(root, 'docs/sources/determinations/other.yaml');
    await writeFile(misnamed, stringifyYaml(determinationInput()));
    await expect(loadRightsDeterminationFile(misnamed, root)).rejects.toThrow(/file name/);

    const outside = join(root, 'acme-hvac-catalog.yaml');
    await writeFile(outside, stringifyYaml(determinationInput()));
    await expect(loadRightsDeterminationFile(outside, root)).rejects.toThrow(/docs\/sources\/determinations/);

    await writeFile(
      join(root, 'verticals/hvac/sources/acme-hvac-catalog.yaml'),
      stringifyYaml({
        key: 'acme-hvac-catalog',
        vertical_slug: 'hvac',
        domain: 'elsewhere.example.com',
        source_type: 'MANUFACTURER',
      }),
    );
    await expect(loadRightsDeterminationFile(file, root)).rejects.toThrow(/registry declaration/);
  });

  it('parses arguments and requires POSTGRES_URL without echoing it', async () => {
    expect(parseRecordDeterminationArgs(['--', '--file', 'x.yaml', '--dry-run'])).toEqual({
      file: 'x.yaml',
      dryRun: true,
    });
    expect(() => parseRecordDeterminationArgs(['--dry-run'])).toThrow(/--file is required/);
    expect(() => parseRecordDeterminationArgs(['--file', 'a', '--postgres-url', 'x'])).toThrow(
      /unsupported argument/,
    );

    await writeFile(
      join(root, 'verticals/hvac/sources/acme-hvac-catalog.yaml'),
      stringifyYaml({
        key: 'acme-hvac-catalog',
        vertical_slug: 'hvac',
        domain: 'catalog.acme-climate.example.com',
        source_type: 'MANUFACTURER',
      }),
    );
    const args = ['--file', 'docs/sources/determinations/acme-hvac-catalog.yaml', '--dry-run'];
    await expect(
      runRecordRightsDeterminationCli(args, {
        env: {},
        repoRoot: root,
        createDriver: async () => {
          throw new Error('unreachable');
        },
        writeStdout: () => undefined,
      }),
    ).rejects.toThrow(/POSTGRES_URL is required/);

    const fixtures = await createFixtures({ trigram: false });
    const output: string[] = [];
    const secretUrl = 'postgres://admin:do-not-print@db.internal/data_foundry';
    try {
      const result = await runRecordRightsDeterminationCli(args, {
        env: { POSTGRES_URL: secretUrl },
        repoRoot: root,
        createDriver: async () => ({ ...fixtures.driver, close: async () => undefined }),
        writeStdout: (text) => output.push(text),
      });
      expect(result).toMatchObject({ dry_run: true, committed: false, changed: true });
      expect(output.join('')).not.toContain('do-not-print');
      expect(JSON.parse(output.join(''))).toMatchObject({ kind: 'data-foundry.rights-determination-record.v1' });
      expect(await counts(fixtures.driver)).toMatchObject({ rights_decisions: 0, rights_publishers: 0 });
    } finally {
      await fixtures.driver.close();
    }
  });
});
