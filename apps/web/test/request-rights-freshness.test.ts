import { afterEach, describe, expect, it } from 'vitest';
import {
  addSyntheticEntityEvidence,
  createQueryFixtures,
  seedSyntheticSurfaceRights,
  ts,
  type QueryFixtures,
} from '../../../packages/query-model/test/support.js';
import { createWebApp } from '../src/app.js';
import { resolveContext } from '../src/config.js';
import { getDeployment, resetDeployments } from '../src/composition.js';
import { RUNTIMES } from '../src/index.js';
import type { WebHandler } from '../src/http.js';
import type { WebRuntime } from '../src/seo.js';

const ORIGIN = 'https://fresh-rights.data-foundry.test';
const FIRST_REQUEST_AT = new Date('2026-05-01T00:00:00Z');
const AFTER_REVOCATION_AT = new Date('2026-07-01T00:00:00Z');
const BEFORE_RECHECK_AT = new Date('2026-12-31T00:00:00Z');
const AFTER_RECHECK_AT = new Date('2027-01-02T00:00:00Z');
const SURFACE_REQUIREMENT = {
  PUBLIC_WEB: { operation: 'DISPLAY_PUBLICLY', channel: 'PUBLIC_WEBSITE' },
  SEARCH_INDEX: { operation: 'DISPLAY_PUBLICLY', channel: 'SEARCH_INDEX' },
} as const;

const TEST_RUNTIME: WebRuntime = {
  ...RUNTIMES['hvac']!,
  vertical_status: 'ACTIVE',
  seo: {
    ...RUNTIMES['hvac']!.seo,
    page_classes: [
      {
        id: 'equipment_detail',
        route_kind: 'entity_detail',
        entity_type: 'equipment',
        path: '/data/hvac/equipment/{canonical_slug}',
        title: '{canonical_name}',
        structured_data: null,
        sitemap: 'entities',
        indexable: 'conditional',
        quality_gate: 'none',
      },
    ],
    quality_gates: { none: {} },
    sitemaps: {
      ...RUNTIMES['hvac']!.seo.sitemaps,
      max_urls_per_file: 100,
      segments: [{ id: 'entities', path: '/sitemaps/entities-{n}.xml' }],
    },
  },
};

interface FreshnessHarness {
  readonly app: WebHandler;
  readonly setNow: (value: Date) => void;
  readonly opens: () => number;
  readonly clockReads: () => number;
}

let fixtures: QueryFixtures | undefined;

afterEach(async () => {
  resetDeployments();
  await fixtures?.driver.close();
  fixtures = undefined;
});

async function createHarness(
  firstNow: Date,
  rechecks: {
    readonly terms: string;
    readonly decisions: string;
    readonly decisionOverrides?: Readonly<Record<string, string>>;
  } = {
    terms: '2027-01-01T00:00:00Z',
    decisions: '2027-01-01T00:00:00Z',
  },
): Promise<FreshnessHarness> {
  fixtures = await createQueryFixtures();
  await seedSyntheticSurfaceRights(
    fixtures,
    ['PUBLIC_WEB', 'SEARCH_INDEX'],
    ['manufacturer'],
    {
      termsRecheckAt: ts(rechecks.terms),
      decisionRecheckAt: ts(rechecks.decisions),
      decisionRecheckAtByRequirement: Object.fromEntries(
        Object.entries(rechecks.decisionOverrides ?? {}).map(([key, value]) => [key, ts(value)]),
      ),
    },
  );
  await addSyntheticEntityEvidence(fixtures, fixtures.equipment, 'manufacturer');

  let driverOpens = 0;
  const options = {
    env: { DEPLOYMENT_ENVIRONMENT: 'development', POSTGRES_URL: 'postgres://fresh-rights/db', PUBLIC_ORIGIN: ORIGIN },
    runtimes: { hvac: TEST_RUNTIME },
    openDriver: async () => {
      driverOpens += 1;
      return fixtures!.driver;
    },
  } as const;
  const deployment = await getDeployment(options);
  expect(await getDeployment(options)).toBe(deployment);
  expect(driverOpens).toBe(1);

  let requestNow = firstNow;
  let clockReads = 0;
  return {
    app: (request) => {
      const context = resolveContext(deployment, () => {
        clockReads += 1;
        return requestNow;
      });
      return createWebApp(context)(request);
    },
    setNow: (value) => {
      requestNow = value;
    },
    opens: () => driverOpens,
    clockReads: () => clockReads,
  };
}

const entityUrl = (): string =>
  `/data/hvac/equipment/${fixtures!.equipment.canonical_slug}`;
const sitemapUrl = '/data/hvac/sitemaps/entities-1.xml';

async function expectInitiallyPublished(app: WebHandler): Promise<void> {
  const page = await app({ method: 'GET', url: entityUrl() });
  const sitemap = await app({ method: 'GET', url: sitemapUrl });
  expect(page.status).toBe(200);
  expect(page.body).toContain('name="robots" content="index,follow"');
  expect(sitemap.status).toBe(200);
  expect(sitemap.body).toContain(fixtures!.equipment.canonical_slug);
}

async function expectSurfaceRefused(
  app: WebHandler,
  surface: 'PUBLIC_WEB' | 'SEARCH_INDEX',
): Promise<void> {
  const page = await app({ method: 'GET', url: entityUrl() });
  const sitemap = await app({ method: 'GET', url: sitemapUrl });
  if (surface === 'PUBLIC_WEB') {
    expect(page.status).toBe(404);
  } else {
    expect(page.status).toBe(200);
    expect(page.body).toContain('name="robots" content="noindex,follow"');
  }
  expect(sitemap.body).not.toContain(fixtures!.equipment.canonical_slug);
}

async function supersedeSurfaceDecision(
  surface: 'PUBLIC_WEB' | 'SEARCH_INDEX',
  state: 'UNKNOWN' | 'DENY',
): Promise<void> {
  const current = fixtures!;
  const source = current.sources.manufacturer.source;
  const occurredAt = ts('2026-06-01T00:00:00Z');
  await current.driver.exec('BEGIN');
  try {
    for (const requirement of [SURFACE_REQUIREMENT[surface]]) {
      const [active] = await current.driver.query<{
        cell_id: string;
        decision_id: string;
        controlling_terms_version_id: string;
        evidence_artifact_id: string;
      }>(
        `SELECT cell.id AS cell_id,
                event.decision_id,
                decision.controlling_terms_version_id,
                decision.evidence_artifact_id
           FROM rights_cells cell
           JOIN rights_decision_activation_events event ON event.cell_id = cell.id
           JOIN rights_decisions decision ON decision.id = event.decision_id
          WHERE cell.source_id = $1
            AND cell.operation = $2
            AND cell.channel = $3
          ORDER BY event.sequence_no DESC
          LIMIT 1`,
        [source.id, requirement.operation, requirement.channel],
      );
      if (active === undefined) throw new Error(`active ${surface} decision not found`);
      const decisionId = crypto.randomUUID();
      await current.driver.query(
        `INSERT INTO rights_decisions
           (id, cell_id, state, controlling_terms_version_id, evidence_artifact_id,
            clause_ref, review_status, reviewer_type, reviewed_by, reviewed_at,
            effective_from, recheck_at, rationale, supersedes_decision_id, created_by)
         VALUES ($1, $2, $3, $4, $5, 'synthetic freshness fixture', 'APPROVED',
                 'HUMAN', 'test-fixture', $6, $6, $7,
                 'explicit synthetic revocation', $8, 'test-fixture')`,
        [
          decisionId,
          active.cell_id,
          state,
          active.controlling_terms_version_id,
          active.evidence_artifact_id,
          occurredAt,
          ts('2028-01-01T00:00:00Z'),
          active.decision_id,
        ],
      );
      await current.driver.query(
        `SELECT activate_rights_decision($1, 'HUMAN', 'test-fixture',
                                         'freshness revocation', $2)`,
        [decisionId, occurredAt],
      );
    }
    await current.driver.exec('COMMIT');
  } catch (error) {
    await current.driver.exec('ROLLBACK');
    throw error;
  }
}

describe('request-scoped public rights freshness', () => {
  it('reuses one deployment driver but refuses the next render and sitemap after the kill switch engages', async () => {
    const harness = await createHarness(FIRST_REQUEST_AT);
    await expectInitiallyPublished(harness.app);

    await fixtures!.driver.query(
      'UPDATE sources SET kill_switch_engaged = TRUE WHERE id = $1',
      [fixtures!.sources.manufacturer.source.id],
    );
    harness.setNow(AFTER_REVOCATION_AT);

    await expectSurfaceRefused(harness.app, 'PUBLIC_WEB');
    expect(harness.opens()).toBe(1);
    expect(harness.clockReads(), 'the clock is frozen once for each of four requests').toBe(4);
  });

  it('refuses the next public render after its ALLOW is superseded by UNKNOWN', async () => {
    const harness = await createHarness(FIRST_REQUEST_AT);
    await expectInitiallyPublished(harness.app);

    await supersedeSurfaceDecision('PUBLIC_WEB', 'UNKNOWN');
    harness.setNow(AFTER_REVOCATION_AT);

    await expectSurfaceRefused(harness.app, 'PUBLIC_WEB');
    expect(harness.opens()).toBe(1);
  });

  it('keeps rendering but removes search eligibility after its ALLOW is superseded by DENY', async () => {
    const harness = await createHarness(FIRST_REQUEST_AT);
    await expectInitiallyPublished(harness.app);

    await supersedeSurfaceDecision('SEARCH_INDEX', 'DENY');
    harness.setNow(AFTER_REVOCATION_AT);

    await expectSurfaceRefused(harness.app, 'SEARCH_INDEX');
    expect(harness.opens()).toBe(1);
  });

  it.each([
    ['PUBLIC_WEB', 'rendering'],
    ['SEARCH_INDEX', 'search eligibility'],
  ] as const)(
    'refreshes %s %s when the decision recheck instant passes',
    async (surface, _description) => {
      const harness = await createHarness(BEFORE_RECHECK_AT, {
        terms: '2028-01-01T00:00:00Z',
        decisions: '2028-01-01T00:00:00Z',
        decisionOverrides: {
          [`${SURFACE_REQUIREMENT[surface].operation}:${SURFACE_REQUIREMENT[surface].channel}`]:
            '2027-01-01T00:00:00Z',
        },
      });
      await expectInitiallyPublished(harness.app);

      harness.setNow(AFTER_RECHECK_AT);

      await expectSurfaceRefused(harness.app, surface);
      expect(harness.opens()).toBe(1);
    },
  );

  it('refreshes both public and search rights when the controlling terms recheck instant passes', async () => {
    const harness = await createHarness(BEFORE_RECHECK_AT, {
      terms: '2027-01-01T00:00:00Z',
      decisions: '2028-01-01T00:00:00Z',
    });
    await expectInitiallyPublished(harness.app);

    harness.setNow(AFTER_RECHECK_AT);

    await expectSurfaceRefused(harness.app, 'PUBLIC_WEB');
    expect(harness.opens()).toBe(1);
  });
});
