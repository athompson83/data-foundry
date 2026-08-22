/**
 * The reviewer behind an editorial correction is never published.
 *
 * ADR-0002 splits one editorial correction into two audiences. The declared
 * REASON is customer-visible by contract: it is authored in version-controlled
 * vertical config and reviewed in a pull request, and a reader comparing our
 * value against a manufacturer's is owed it. The REVIEWER is not: that stays in
 * `explainFact` and the audit record.
 *
 * `explainFact` is exactly what the `explain_fact` tool reads. It carries
 * `editorial_correction.reviewer` verbatim AND renders a narrative line reading
 * "Reviewer: <name>". So this app is one careless `...spread` away from
 * publishing a staff member's name to every agent that asks why a value
 * changed, and the guarantee has to be a control rather than a comment — which
 * is the mistake `serialization.ts` records having already made once.
 *
 * The first test in this file proves the raw query-layer answer really does
 * carry the name. Without it every assertion below could pass because the
 * fixture never had an identity to leak.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AT,
  CORRECTION_REASON,
  POISONED_REASON,
  REVIEWER,
  createMcpFixtures,
  errorOf,
  policyWithOverride,
  resultOf,
  type McpFixtures,
} from './support.js';
import {
  assertPayloadCarriesNoReviewer,
  createMcpServer,
  namesReviewer,
  reviewerTokens,
  reviewersIn,
  type ExplainFactResult,
  type GetEntityResult,
  type ListFactsResult,
} from '../src/index.js';
import { explanation, withheldSourceTokens } from '../src/projection.js';

let fixtures: McpFixtures;

/** The local part of the reviewer's address identifies them just as completely. */
const LOCAL_PART = 'j.okafor';

const carriesReviewer = (value: unknown): boolean => {
  const serialized = JSON.stringify(value)?.toLowerCase() ?? '';
  return serialized.includes(REVIEWER.toLowerCase()) || serialized.includes(LOCAL_PART);
};

beforeAll(async () => {
  fixtures = await createMcpFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('the fixture is not vacuous', () => {
  it('the raw query-layer explanation really does name the reviewer', async () => {
    const raw = await fixtures.qm.explainFact(
      fixtures.equipment.id,
      'refrigerant',
      fixtures.policy,
    );
    expect(raw).not.toBeNull();
    expect(raw?.editorially_corrected).toBe(true);
    expect(raw?.editorial_correction?.reviewer).toBe(REVIEWER);
    // And it is rendered into prose, not merely held in a field.
    expect(raw?.narrative.some((line) => line.includes(REVIEWER))).toBe(true);
    expect(carriesReviewer(raw)).toBe(true);
  });

  it('the correction itself is published — this is not a test that hides everything', async () => {
    const result = resultOf<ExplainFactResult>(
      await fixtures.server.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: 'refrigerant',
      }),
    );
    expect(result.editoriallyCorrected).toBe(true);
    expect(result.editorialCorrectionReason).toBe(CORRECTION_REASON);
    expect(result.canonicalValue).toBe('R-32');
  });
});

describe('no tool result carries the reviewer', () => {
  it('holds for every tool that can reach a corrected value', async () => {
    const calls = [
      await fixtures.server.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: 'refrigerant',
      }),
      await fixtures.server.callTool('get_entity', { identifier: '24ANB7' }),
      await fixtures.server.callTool('list_facts', { entity_id: fixtures.equipment.id }),
      await fixtures.server.callTool('list_facts', {
        entity_id: fixtures.equipment.id,
        properties: ['refrigerant'],
        as_of: AT,
      }),
      await fixtures.server.callTool('compare_entities', {
        entity_ids: [fixtures.equipment.id, fixtures.heatPump.id],
      }),
      await fixtures.server.callTool('search_entities', { query: 'Carrier' }),
      await fixtures.server.callTool('traverse_relationships', {
        entity_id: fixtures.equipment.id,
      }),
    ];

    for (const call of calls) {
      expect(call.isError).toBe(false);
      // Both halves of the envelope, because a transport may forward either.
      expect(carriesReviewer(call.structuredContent)).toBe(false);
      expect(carriesReviewer(call.content)).toBe(false);
    }
  });

  it('drops the narrative line that named them and says a line was dropped', async () => {
    const result = resultOf<ExplainFactResult>(
      await fixtures.server.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: 'refrigerant',
      }),
    );
    for (const line of result.narrative) expect(line.toLowerCase()).not.toContain(LOCAL_PART);
    // Redaction is disclosed. A silently shorter explanation is a different
    // explanation, and the reader should know something was withheld.
    expect(result.narrative.some((line) => line.includes('internal reviewer'))).toBe(true);
    // The rest of the trail is intact, not sacrificed to the redaction.
    expect(result.claims.length).toBeGreaterThan(0);
    expect(result.conflicts.length).toBeGreaterThan(0);
  });

  it('does not project the correction object, only its reason', async () => {
    const result = resultOf<Record<string, unknown>>(
      await fixtures.server.callTool('explain_fact', {
        entity_id: fixtures.equipment.id,
        property: 'refrigerant',
      }),
    );
    expect(result['editorial_correction']).toBeUndefined();
    expect(result['editorialCorrection']).toBeUndefined();
    expect(result['reviewer']).toBeUndefined();
    expect(result['editorialCorrectionReason']).toBe(CORRECTION_REASON);
  });
});

describe('removing the guarantee makes it fail', () => {
  it('the payload sweep catches a projection that forwarded the narrative', async () => {
    const raw = await fixtures.qm.explainFact(
      fixtures.equipment.id,
      'refrigerant',
      fixtures.policy,
    );
    expect(raw).not.toBeNull();
    if (raw === null) return;

    // Layer 1 removed: project with NO reviewer tokens, which is what a
    // future edit that forgot to compute them would produce. The narrative
    // line survives...
    const unfiltered = explanation(raw, [], withheldSourceTokens(raw));
    expect(carriesReviewer(unfiltered)).toBe(true);

    // ...and layer 2 refuses it rather than returning it. This is the layer
    // that survives someone editing the projection without reading it.
    const tokens = reviewerTokens(reviewersIn([raw]));
    expect(() => assertPayloadCarriesNoReviewer(unfiltered, tokens)).toThrowError(
      /REVIEWER|reviewer/i,
    );

    // With both layers in place the same explanation is clean.
    const filtered = explanation(raw, tokens, withheldSourceTokens(raw));
    expect(carriesReviewer(filtered)).toBe(false);
    expect(() => assertPayloadCarriesNoReviewer(filtered, tokens)).not.toThrow();
  });

  it('the sweep matches the email local part, not just the declared string', () => {
    const tokens = reviewerTokens([REVIEWER]);
    expect(tokens).toContain(REVIEWER.toLowerCase());
    expect(tokens).toContain(LOCAL_PART);
    expect(namesReviewer('corrected by J.Okafor after a supplier call', tokens)).toBe(true);
    expect(namesReviewer('corrected after a supplier call', tokens)).toBe(false);
    // The sweep takes TOKENS, not raw reviewer names: a payload naming only
    // the local part must still be refused.
    expect(() =>
      assertPayloadCarriesNoReviewer({ note: 'signed off by j.okafor' }, tokens),
    ).toThrow();
    expect(() =>
      assertPayloadCarriesNoReviewer({ note: 'signed off after a call' }, tokens),
    ).not.toThrow();
  });

  it('an empty or blank reviewer name does not blacklist every string', () => {
    // The empty string is a substring of everything; treating it as a match
    // would refuse to publish any correction at all.
    expect(reviewerTokens(['', '   '])).toEqual([]);
    expect(() => assertPayloadCarriesNoReviewer({ anything: 'at all' }, [])).not.toThrow();
    expect(reviewersIn([])).toEqual([]);
  });
});

describe('a correction reason that names its own reviewer', () => {
  it('is refused as a structured error, with the name absent from the refusal', async () => {
    const poisoned = createMcpServer({
      queryModel: fixtures.qm,
      vertical: { id: fixtures.vertical.id, slug: 'hvac' },
      policy: policyWithOverride(POISONED_REASON),
    });

    // Three different paths reach the same refusal: `canonicalFacts` throws the
    // query layer's own `ReviewerIdentityLeak`, and `explainFact` — which does
    // not — is caught by this app's own layer-1 assertion instead.
    const calls: readonly (readonly [string, unknown])[] = [
      ['get_entity', { identifier: '24ANB7' }],
      ['list_facts', { entity_id: fixtures.equipment.id }],
      ['explain_fact', { entity_id: fixtures.equipment.id, property: 'refrigerant' }],
      [
        'compare_entities',
        { entity_ids: [fixtures.equipment.id, fixtures.heatPump.id] },
      ],
    ];

    for (const [tool, args] of calls) {
      const call = await poisoned.callTool(tool, args);
      expect(call.isError, tool).toBe(true);
      expect(errorOf(call).code, tool).toBe('REVIEWER_IDENTITY_BLOCKED');
      // A privacy guard that repeats the thing it guards is worse than none —
      // and an error message ends up in logs and exception trackers.
      expect(carriesReviewer(call.structuredContent), tool).toBe(false);
      expect(JSON.stringify(call.structuredContent), tool).not.toContain('supplier call');
    }
  });

  it('fails closed for the whole sheet, and leaves the other tools working', async () => {
    const poisoned = createMcpServer({
      queryModel: fixtures.qm,
      vertical: { id: fixtures.vertical.id, slug: 'hvac' },
      policy: policyWithOverride(POISONED_REASON),
    });

    // Narrowing to an uncorrected property does NOT rescue the call, and that
    // is the right answer rather than a limitation: the canonical view is
    // computed for the entity before any property filter applies, so the leak
    // is detected for the entity. Serving a narrowed sheet would mean the same
    // entity is publishable or not depending on which argument was passed.
    const narrowed = await poisoned.callTool('list_facts', {
      entity_id: fixtures.equipment.id,
      properties: ['tonnage'],
    });
    expect(narrowed.isError).toBe(true);
    expect(errorOf(narrowed).code).toBe('REVIEWER_IDENTITY_BLOCKED');

    // Tools that never read a fact sheet are unaffected: a misworded override
    // reason is a publishing fault on one entity's values, not an outage.
    const search = await poisoned.callTool('search_entities', { query: '24ANB7' });
    expect(search.isError).toBe(false);

    const traverse = await poisoned.callTool('traverse_relationships', {
      entity_id: fixtures.equipment.id,
    });
    expect(traverse.isError).toBe(false);

    const identity = await poisoned.callTool('get_entity', {
      identifier: '24ANB7',
      include_facts: false,
    });
    expect(identity.isError).toBe(false);

    // And a different entity, with no correction on it, still publishes.
    const other = await poisoned.callTool('list_facts', { entity_id: fixtures.heatPump.id });
    expect(other.isError).toBe(false);
    expect(resultOf<ListFactsResult>(other).facts.length).toBeGreaterThan(0);
  });
});

describe('the clean fixture still proves the sheet is guarded', () => {
  it('guards a corrected fact sheet without withholding it', async () => {
    const sheet = resultOf<GetEntityResult>(
      await fixtures.server.callTool('get_entity', { identifier: '24ANB7' }),
    );
    const refrigerant = (sheet.facts ?? []).find((fact) => fact.property === 'refrigerant');
    expect(refrigerant?.editoriallyCorrected).toBe(true);
    expect(refrigerant?.editorialCorrectionReason).toBe(CORRECTION_REASON);
    expect(carriesReviewer(sheet)).toBe(false);
  });
});
