/**
 * The reviewer never reaches a customer.
 *
 * `serialization.ts` draws the line: the override's declared REASON is
 * customer-visible by contract — it is written in version-controlled vertical
 * config and reviewed in a pull request — while the REVIEWER's identity stays
 * in `explainFact` and the audit record. A staff name in a public spec sheet is
 * a privacy incident that no amount of "we meant the reason field" undoes.
 *
 * Two of these tests are removal proofs rather than assertions. It is easy to
 * write `expect(body).not.toContain(reviewer)` against a payload that never had
 * a reviewer in it for unrelated reasons, and to believe a guard is working
 * when nothing is guarding anything. So the same fact view is serialized twice:
 * once through the raw shared mapper, where the identity DOES come through, and
 * once through this surface's boundary, where it must not.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ReviewerIdentityLeak,
  toRestFact,
  type CanonicalFactView,
  type RestFact,
} from '../../../packages/query-model/src/index.js';
import {
  factConfidence,
  type FactConfidence,
} from '../../../packages/canonical-schema/src/index.js';
import { createApiApp } from '../src/index.js';
import { ROUTES } from '../src/routes.js';
import { factWire } from '../src/wire.js';
import type { ApiFactSelectionPolicy } from '../src/config.js';
import type { ApiHandler } from '../src/http.js';
import {
  call,
  claim,
  createApiFixtures,
  dataOf,
  errorOf,
  relate,
  ts,
  type ApiFixtures,
} from './support.js';

const PROPERTY = 'blower_rpm';
const REVIEWER = 'j.okafor@example.com';
const PUBLIC_REASON = 'The manufacturer bulletin supersedes the earlier catalog specification.';
/** A reason that names the person. Authored by a human, so it can happen. */
const LEAKING_REASON = 'Corrected by j.okafor after a supplier call.';

const policyWith = (reason: string): ApiFactSelectionPolicy => ({
  editorialOverrides: [{ source: 'editorial.internal', reason, reviewer: REVIEWER }],
});

const CLEAN = policyWith(PUBLIC_REASON);
const LEAKING = policyWith(LEAKING_REASON);

let fixtures: ApiFixtures;
let leakingApp: ApiHandler;
let leakingLog: unknown[];

beforeAll(async () => {
  fixtures = await createApiFixtures({ factSelection: CLEAN });

  // A rival claim must be PROPOSED: one open ACTIVE version per
  // (entity, property) is a database constraint, so a second ACTIVE claim
  // would supersede rather than compete.
  await claim(fixtures, 'manufacturer', { property: PROPERTY, value: 1000, value_type: 'number' });
  await claim(fixtures, 'editorial', {
    property: PROPERTY,
    value: 1100,
    value_type: 'number',
    status: 'PROPOSED',
  });

  leakingLog = [];
  leakingApp = createApiApp({
    queryModel: fixtures.qm,
    verticalId: fixtures.vertical.id,
    factSelection: LEAKING,
    onError: (error) => leakingLog.push(error),
  });
}, 300_000);

afterAll(async () => {
  await fixtures?.driver.close();
});

async function correctedView(): Promise<CanonicalFactView> {
  const views = await fixtures.qm.canonicalFacts(fixtures.equipment.id, CLEAN);
  const view = views.find((candidate) => candidate.property === PROPERTY);
  if (view === undefined) throw new Error(`no canonical view for ${PROPERTY}`);
  return view;
}

describe('a correction with a public reason', () => {
  it('publishes the correction state and the reason', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/facts?property=${PROPERTY}`,
    );
    expect(response.status).toBe(200);
    const fact = dataOf<RestFact[]>(response)[0];
    expect(fact?.value).toBe(1100);
    expect(fact?.rule).toBe('EDITORIAL_OVERRIDE');
    expect(fact?.editoriallyCorrected).toBe(true);
    expect(fact?.editorialCorrectionReason).toBe(PUBLIC_REASON);
  });

  it('carries no reviewer identity in the response body', async () => {
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/facts?limit=100`,
    );
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain(REVIEWER);
    expect(raw).not.toContain('okafor');
  });

  it('carries no reviewer identity on any other route either', async () => {
    const urls = [
      '/v1',
      '/v1/health',
      `/v1/entities/${fixtures.equipment.id}`,
      `/v1/entities/${fixtures.equipment.id}/relationships`,
      '/v1/search?q=carrier&facets=true&limit=100',
      `/v1/compare?ids=${fixtures.equipment.id},${fixtures.heatPump.id}`,
    ];
    for (const url of urls) {
      const raw = JSON.stringify((await call(fixtures.app, url)).body);
      expect(raw.toLowerCase(), url).not.toContain('okafor');
    }
  });

  it('keeps the reviewer on the internal audit surface, which is not routed', async () => {
    // The guarantee is a projection boundary, not deletion: an auditor asking
    // "who changed this" must still get an answer.
    const explained = await fixtures.qm.explainFact(fixtures.equipment.id, PROPERTY, CLEAN);
    expect(explained?.editorial_correction?.reviewer).toBe(REVIEWER);

    // …and nothing in this surface routes to it.
    expect(ROUTES.map((route) => route.path).join(' ')).not.toMatch(/explain|provenance|coverage/);
    const response = await call(fixtures.app, `/v1/entities/${fixtures.equipment.id}/explain`);
    expect(response.status).toBe(404);
    expect(errorOf(response).code).toBe('ROUTE_NOT_FOUND');
  });
});

describe('a correction whose reason names its reviewer', () => {
  it('is refused rather than published', async () => {
    const response = await call(
      leakingApp,
      `/v1/entities/${fixtures.equipment.id}/facts?property=${PROPERTY}`,
    );
    expect(response.status).toBe(500);
    expect(errorOf(response).code).toBe('INTERNAL_ERROR');
  });

  it('leaks nothing through the error envelope — not the name, not the guard’s message', async () => {
    const response = await call(
      leakingApp,
      `/v1/entities/${fixtures.equipment.id}/facts?limit=100`,
    );
    const raw = JSON.stringify(response.body);
    expect(raw.toLowerCase()).not.toContain('okafor');
    expect(raw).not.toContain('reviewer');
    expect(raw).not.toContain(LEAKING_REASON);
  });

  it('hands the real cause to the operator channel and nowhere else', async () => {
    leakingLog.length = 0;
    await call(leakingApp, `/v1/entities/${fixtures.equipment.id}/facts?property=${PROPERTY}`);
    expect(leakingLog).toHaveLength(1);
    expect(leakingLog[0]).toBeInstanceOf(ReviewerIdentityLeak);
  });

  it('fails the whole page rather than dropping one fact from it', async () => {
    // Silently omitting the offending row would publish a canonical view that
    // is missing a property, with nothing anywhere saying so.
    const response = await call(leakingApp, `/v1/entities/${fixtures.equipment.id}/facts?limit=100`);
    expect(response.status).toBe(500);
  });
});

describe('the guard is what stops it (removal proof)', () => {
  it('the shared mapper alone carries the identity straight onto the wire', async () => {
    const leaky: CanonicalFactView = {
      ...(await correctedView()),
      editorially_corrected: true,
      editorial_correction_reason: LEAKING_REASON,
    };
    // This is the surface WITHOUT the guarantee: `toRestFact` is a mapper, not
    // a policy, and it will happily serialize a reviewer's name.
    expect(JSON.stringify(toRestFact(leaky))).toContain('j.okafor');
  });

  it('the same view through this surface’s boundary throws instead', async () => {
    const leaky: CanonicalFactView = {
      ...(await correctedView()),
      editorially_corrected: true,
      editorial_correction_reason: LEAKING_REASON,
    };
    expect(() => factWire(leaky, [REVIEWER])).toThrow(ReviewerIdentityLeak);
  });

  it('catches the email local part, not only the declared spelling', async () => {
    const leaky: CanonicalFactView = {
      ...(await correctedView()),
      editorially_corrected: true,
      editorial_correction_reason: 'Reviewed by J.Okafor, standards desk.',
    };
    // The reason never contains the full address; the guard derives the local
    // part from it and case-folds both sides.
    expect(() => factWire(leaky, [REVIEWER])).toThrow(ReviewerIdentityLeak);
  });

  it('does not refuse an innocent reason, which would make the guard useless', async () => {
    const clean = await correctedView();
    expect(() => factWire(clean, [REVIEWER])).not.toThrow();
    expect(factWire(clean, [REVIEWER]).editorialCorrectionReason).toBe(PUBLIC_REASON);
  });

  it('is not disarmed by an empty reviewer entry', () => {
    // The empty string is a substring of everything; treating it as a match
    // would refuse every correction, and skipping the whole check would arm
    // nothing. `reviewerIdentityTokens` skips the blank and keeps the rest.
    const view = {
      property: PROPERTY,
      value: 1,
      value_type: 'number',
      unit: null,
      confidence: null,
      fact_id: null,
      rule: 'EDITORIAL_OVERRIDE',
      reason: 'x',
      sources: [],
      conflicts: [],
      unresolved_conflict: false,
      editorially_corrected: true,
      editorial_correction_reason: 'Corrected by j.okafor.',
      selection_warnings: [],
    } as unknown as CanonicalFactView;
    expect(() => factWire(view, ['   ', REVIEWER])).toThrow(ReviewerIdentityLeak);
    expect(() => factWire(view, ['   '])).not.toThrow();
  });
});

describe('a value backed by one publishable and one blocked source', () => {
  const PROPERTY_MIXED = 'mixed_evidence_spec';

  it('publishes the value and credits only the source it may name', async () => {
    const green = fixtures.sources.manufacturer;
    const blocked = fixtures.sources.blocked;
    await fixtures.store.appendFactWithEvidence(
      {
        entity_id: fixtures.heatPump.id,
        property: PROPERTY_MIXED,
        normalized_value: 42,
        value_type: 'number',
        unit: null,
        valid_from: ts('2026-02-01T00:00:00Z'),
        confidence: factConfidence(0.9) as FactConfidence,
        recorded_at: ts('2026-02-01T00:00:00Z'),
        status: 'ACTIVE',
      },
      [
        {
          artifact_id: green.artifact.id,
          source_record_id: green.record.id,
          source_value: '42',
          locator_type: 'CSS_SELECTOR',
          locator_value: 'table.specs [data-field="mixed"]',
          observed_at: ts('2026-02-01T00:00:00Z'),
        },
        {
          artifact_id: blocked.artifact.id,
          source_record_id: blocked.record.id,
          source_value: '42',
          locator_type: 'CSS_SELECTOR',
          locator_value: 'div.post [data-field="mixed"]',
          observed_at: ts('2026-02-01T00:00:00Z'),
        },
      ],
    );

    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.heatPump.id}/facts?property=${PROPERTY_MIXED}`,
    );
    const fact = dataOf<RestFact[]>(response)[0];

    // The value stands: a publishable source backs it, so rule 1 does not
    // withhold it. What rule 1 also governs is the CREDIT — and this assertion
    // used to run the other way. It pinned `sources` containing the UNREVIEWED
    // publisher's name as a known gap, on the reasoning that naming who else
    // said something is attribution rather than data.
    //
    // That reasoning was wrong, and review was right to press it. Telling a
    // customer that a published value is backed by a source the publish gate
    // says must not publish is both a disclosure and a false provenance claim,
    // whatever the field is called. It is fixed once in `canonicalFacts` for
    // every surface rather than filtered again here (rule 5), by reading the
    // rights-filtered source list `fact-selection` had already computed.
    expect(fact?.value).toBe(42);
    expect(fact?.sources).toContain('Carrier');
    expect(fact?.sources, 'a blocked source must not be credited for the value').not.toContain(
      'HVAC Forum',
    );
  });
});

describe('the published contract for relationship traversal', () => {
  /**
   * The contract document at `/v1` is a promise, not a comment: callers read it
   * to decide what an edge means. It used to warn that traversal "carries no
   * rights gate in the query layer today, unlike facts" — true when written,
   * and false the moment the gate landed. A caller told an edge proves nothing
   * about publishability will build their own filter, and two filters that
   * disagree is exactly what rule 5 exists to prevent.
   *
   * Checking the wording is not enough on its own, and the first version of
   * this test proved it: it asserted the caveat did not say "no rights gate"
   * and did say "withheld", in an `it` block that never called the route. A
   * caveat reading "Traversal withholds nothing. […] an edge here is proof its
   * backing source is publishable" satisfied both — the precise falsehood the
   * test existed to prevent. So the behaviour and the wording are now observed
   * in the same test, and the wording assertions are written to reject the
   * inversions rather than to spot a keyword.
   */
  const PREDICATE = 'blocked_only_edge';

  it('withholds an edge no publishable source vouches for, and says so in the contract', async () => {
    await relate(fixtures, fixtures.equipment, PREDICATE, fixtures.heatPump, 'blocked');

    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/relationships?predicate=${PREDICATE}`,
    );
    expect(response.status).toBe(200);

    // Observed: the route DOES withhold.
    expect(
      dataOf<{ predicate: string }[]>(response),
      'the only evidence for this edge comes from an UNREVIEWED source',
    ).toEqual([]);

    // …and says nothing anywhere about what it withheld. A rights refusal that
    // varied any number in this payload would be a yes/no oracle about the
    // triple the caller named — see the query layer's `unevidenced_edge_count`.
    const body = response.body as { traversal: { unevidencedEdgeCount: number } };
    expect(body.traversal.unevidencedEdgeCount, 'a rights refusal is not an unevidenced edge').toBe(
      0,
    );
    expect(
      JSON.stringify(response.body),
      'nothing may name who was refused, either',
    ).not.toContain('HVAC Forum');

    // Published: the caveat must assert the withholding, and must not be
    // satisfiable by a sentence that denies it.
    const document = (await call(fixtures.app, '/v1')).body as {
      routes: { path: string; caveat?: string }[];
    };
    const caveat =
      document.routes.find((candidate) => candidate.path.includes('/relationships'))?.caveat ?? '';
    expect(caveat, 'the contract must still describe the traversal route').not.toBe('');
    expect(caveat, 'it must not deny the gate').not.toMatch(
      /no rights gate|withholds? nothing|never withh|returns every edge/i,
    );
    expect(caveat, 'nor claim an edge proves its source is publishable').not.toMatch(
      /proof (that )?(its|the) backing source|proof its backing source/i,
    );
    expect(caveat, 'it must say the view is partial').toMatch(/withheld|withholds/i);
    expect(caveat, 'and name what the edge list actually is').toMatch(/publishable graph/i);
  });

  it('reports no unevidenced edges on a route that served real ones', async () => {
    // Without a zero control taken with the gate ON and edges actually served,
    // hard-coding the field to 1 passed the entire API suite.
    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/relationships?predicate=has_part`,
    );
    expect(response.status).toBe(200);
    expect(
      dataOf<{ predicate: string }[]>(response).length,
      'the control must serve at least one real edge',
    ).toBeGreaterThan(0);
    const body = response.body as { traversal: { unevidencedEdgeCount: number } };
    expect(body.traversal.unevidencedEdgeCount).toBe(0);
  });
});
