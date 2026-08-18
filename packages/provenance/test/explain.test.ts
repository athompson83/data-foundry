import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { explainEntity, explainFact } from '../src/index.js';
import { claim, createFixtures, ts, type Fixtures } from './support.js';

let fixtures: Fixtures;
const AT = ts('2026-07-01T00:00:00Z');

beforeAll(async () => {
  fixtures = await createFixtures();

  // A genuine disagreement: the manufacturer and an aggregator do not agree,
  // and the aggregator spoke more recently.
  await claim(fixtures, 'manufacturer', {
    property: 'refrigerant',
    value: 'R-454B',
    source_value: 'Refrigerant: R-454B',
    valid_from: '2026-02-01T00:00:00Z',
    observed_at: '2026-02-01T00:00:00Z',
  });
  await claim(fixtures, 'aggregator', {
    property: 'refrigerant',
    value: 'R-410A',
    source_value: 'R410A',
    status: 'PROPOSED',
    valid_from: '2026-05-01T00:00:00Z',
    observed_at: '2026-05-01T00:00:00Z',
  });
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('explainFact', () => {
  it('names the winner, the rule and the reason', async () => {
    const explanation = await explainFact(fixtures.store, fixtures.entity.id, 'refrigerant', {
      at: AT,
    });

    expect(explanation).not.toBeNull();
    expect(explanation?.selected?.value).toBe('R-454B');
    expect(explanation?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
    expect(explanation?.reason).toContain('authoritative');
    expect(explanation?.entity.canonical_slug).toBe('carrier-infinity-24anb7');
  });

  it('shows which source claims what, with locator and retrieval time', async () => {
    const explanation = await explainFact(fixtures.store, fixtures.entity.id, 'refrigerant', {
      at: AT,
    });

    expect(explanation?.claims).toHaveLength(2);
    const winner = explanation?.claims.find((claimSummary) => claimSummary.selected);
    const loser = explanation?.claims.find((claimSummary) => !claimSummary.selected);

    expect(winner?.attributions[0]?.publisher).toBe('Carrier');
    expect(winner?.attributions[0]?.source_value).toBe('Refrigerant: R-454B');
    expect(winner?.attributions[0]?.locator).toContain('CSS_SELECTOR');
    expect(winner?.attributions[0]?.retrieved_at).toBe(ts('2026-01-05T00:00:00Z'));

    expect(loser?.value).toBe('R-410A');
    expect(loser?.attributions[0]?.publisher).toBe('SpecAggregator');
  });

  it('retains and reports the conflict rather than collapsing it', async () => {
    const explanation = await explainFact(fixtures.store, fixtures.entity.id, 'refrigerant', {
      at: AT,
    });

    expect(explanation?.unresolved_conflict).toBe(true);
    expect(explanation?.conflicts).toHaveLength(1);
    expect(explanation?.conflicts[0]?.value).toBe('R-410A');
    expect(explanation?.conflicts[0]?.claimed_by.map((source) => source.publisher)).toEqual([
      'SpecAggregator',
    ]);

    // ...and the losing row is still in the database, evidence intact.
    const stored = await fixtures.store.listFacts(fixtures.entity.id, { property: 'refrigerant' });
    expect(stored).toHaveLength(2);
    const rival = stored.find((fact) => fact.normalized_value === 'R-410A');
    expect(await fixtures.store.listFactEvidence(rival!.id)).toHaveLength(1);
  });

  it('produces narrative lines a trust panel can render', async () => {
    const explanation = await explainFact(fixtures.store, fixtures.entity.id, 'refrigerant', {
      at: AT,
    });
    const narrative = explanation?.narrative ?? [];

    expect(narrative.some((line) => line.includes('Carrier') && line.includes('carrier.com'))).toBe(true);
    expect(narrative.some((line) => line.startsWith('Published value for refrigerant'))).toBe(true);
    expect(narrative.some((line) => line.startsWith('Criterion '))).toBe(true);
    expect(narrative.some((line) => line.startsWith('Unresolved conflict retained'))).toBe(true);
  });

  it('attaches the full lineage of the winning claim', async () => {
    const explanation = await explainFact(fixtures.store, fixtures.entity.id, 'refrigerant', {
      at: AT,
    });
    expect(explanation?.lineage?.traceable).toBe(true);
    expect(explanation?.lineage?.chain[0]?.artifact.content_hash).toHaveLength(64);
    expect(explanation?.lineage?.chain[0]?.source_record.entity_type).toBe('equipment');
  });

  it('explains why nothing is published when every source is rights-blocked', async () => {
    await claim(fixtures, 'blocked', {
      property: 'street_price',
      value: 6200,
      value_type: 'number',
      valid_from: '2026-02-01T00:00:00Z',
    });

    const explanation = await explainFact(fixtures.store, fixtures.entity.id, 'street_price', {
      at: AT,
    });

    expect(explanation?.selected).toBeNull();
    expect(explanation?.rule).toBe('NO_ELIGIBLE_CANDIDATE');
    expect(explanation?.excluded[0]?.reason).toBe('RIGHTS_BLOCKED');
    // The claim itself is still visible in the explanation — hidden from
    // publication, not from the audit trail.
    expect(explanation?.claims).toHaveLength(1);
    expect(explanation?.narrative.some((line) => line.startsWith('No value is published'))).toBe(true);
  });

  it('explains every property of an entity at once', async () => {
    const all = await explainEntity(fixtures.store, fixtures.entity.id, { at: AT });
    expect([...all.keys()].sort()).toEqual(['refrigerant', 'street_price']);
    expect(all.get('refrigerant')?.rule).toBe('DIRECT_AUTHORITATIVE_SOURCE');
  });

  it('returns null for an entity that does not exist', async () => {
    const missing = await explainFact(
      fixtures.store,
      '00000000-0000-4000-8000-00000000beef' as never,
      'refrigerant',
    );
    expect(missing).toBeNull();
  });

  // ADR-0002. Declared last so the fixture set the earlier assertions count is
  // untouched: these claims exist only for this test.
  it('surfaces an editorial correction with its reason and reviewer', async () => {
    const REASON = 'Manufacturer erratum EC-2026-14 supersedes the printed nameplate value.';
    const REVIEWER = 'j.okafor@data-foundry.example';

    await claim(fixtures, 'manufacturer', {
      property: 'stage_count',
      value: 1,
      value_type: 'integer',
      valid_from: '2026-02-01T00:00:00Z',
    });
    await claim(fixtures, 'editorial', {
      property: 'stage_count',
      value: 2,
      value_type: 'integer',
      status: 'PROPOSED',
      valid_from: '2026-02-01T00:00:00Z',
    });

    const explanation = await explainFact(fixtures.store, fixtures.entity.id, 'stage_count', {
      at: AT,
      editorialOverrides: [{ source: 'editorial.internal', reason: REASON, reviewer: REVIEWER }],
    });

    expect(explanation?.rule).toBe('EDITORIAL_OVERRIDE');
    expect(explanation?.selected?.value).toBe(2);
    expect(explanation?.editorially_corrected).toBe(true);
    expect(explanation?.editorial_correction?.reason).toBe(REASON);
    expect(explanation?.editorial_correction?.reviewer).toBe(REVIEWER);

    // The trust panel has to be able to say so in words, not just in a boolean.
    const line = explanation?.narrative.find((entry) => entry.startsWith('Editorially corrected'));
    expect(line).toBeDefined();
    expect(line).toContain(REASON);
    expect(line).toContain(REVIEWER);

    // The manufacturer's value is still on the record, still explained.
    expect(explanation?.conflicts.map((conflict) => conflict.value)).toEqual([1]);
    expect(explanation?.claims).toHaveLength(2);
  });

  it('does not label an ordinary selection as editorially corrected', async () => {
    const explanation = await explainFact(fixtures.store, fixtures.entity.id, 'refrigerant', {
      at: AT,
    });
    expect(explanation?.editorially_corrected).toBe(false);
    expect(explanation?.editorial_correction).toBeNull();
    expect(explanation?.narrative.some((entry) => entry.startsWith('Editorially corrected'))).toBe(
      false,
    );
  });
});
