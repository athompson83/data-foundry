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
   * and false the moment the gate landed. A caveat that understates the
   * guarantee is not a safe direction to be wrong in either: a caller told an
   * edge proves nothing about publishability will build their own filter, and
   * two filters that disagree is exactly what rule 5 exists to prevent.
   *
   * So the wording is checked against what the route actually does, in the
   * same test, rather than trusted to stay in step on its own.
   */
  const PREDICATE = 'blocked_only_edge';

  it('withholds an edge no publishable source vouches for', async () => {
    await relate(fixtures, fixtures.equipment, PREDICATE, fixtures.heatPump, 'blocked');

    const response = await call(
      fixtures.app,
      `/v1/entities/${fixtures.equipment.id}/relationships?predicate=${PREDICATE}`,
    );
    expect(response.status).toBe(200);
    expect(
      dataOf<{ predicate: string }[]>(response),
      'the only evidence for this edge comes from an UNREVIEWED source',
    ).toEqual([]);

    // Withheld, and said so. An empty edge list on its own tells a caller the
    // graph holds nothing here, which is a stronger claim than the truth.
    const body = response.body as { traversal: { withheldEdgeCount: number } };
    expect(body.traversal.withheldEdgeCount).toBe(1);
    expect(
      JSON.stringify(response.body),
      'the count reports the gap; it must not name who was refused',
    ).not.toContain('HVAC Forum');
  });

  it('does not tell callers that traversal is ungated', async () => {
    const response = await call(fixtures.app, '/v1');
    expect(response.status).toBe(200);
    const document = response.body as { routes: { path: string; caveat?: string }[] };
    const route = document.routes.find((candidate) => candidate.path.includes('/relationships'));
    expect(route, 'the contract must still describe the traversal route').toBeDefined();
    const caveat = route?.caveat ?? '';
    expect(caveat, 'traversal does gate on rights; the contract must not deny it').not.toMatch(
      /no rights gate/i,
    );
    expect(caveat, 'and it must say so, so callers do not re-filter').toMatch(/withheld|withhold/i);
  });
});
