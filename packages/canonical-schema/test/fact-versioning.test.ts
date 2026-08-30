import { describe, expect, it } from 'vitest';
import { factConfidence } from '../src/confidence.js';
import { entityId, factId } from '../src/ids.js';
import type { Fact } from '../src/objects/facts.js';
import {
  FactVersioningError,
  IMMUTABLE_FACT_FIELDS,
  MUTABLE_FACT_FIELDS,
  appendFactVersion,
  assertNonDestructiveFactUpdate,
  canonicalValuesEqual,
  currentFactVersion,
  currentFactsByProperty,
  factVersionChain,
  factVersionsFor,
  isFactActiveAt,
  isFactVersionOpen,
  needsNewFactVersion,
  retractFactVersion,
  type FactVersionDraft,
} from '../src/fact-versioning.js';

const ENTITY = entityId('11111111-1111-4111-8111-111111111111');
const OTHER_ENTITY = entityId('22222222-2222-4222-8222-222222222222');
const FACT_A = factId('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const FACT_B = factId('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const FACT_C = factId('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

const JAN = '2026-01-01T00:00:00.000Z';
const JUN = '2026-06-01T00:00:00.000Z';
const DEC = '2026-12-01T00:00:00.000Z';

const fact = (overrides: Partial<Fact> = {}): Fact => ({
  id: FACT_A,
  entity_id: ENTITY,
  property: 'seer2_rating',
  normalized_value: 15.2,
  value_type: 'number',
  output_kind: 'NORMALIZED_FACT',
  unit: null,
  valid_from: JAN,
  valid_to: null,
  status: 'ACTIVE',
  confidence: factConfidence(0.9),
  supersedes_fact_id: null,
  recorded_at: JAN,
  created_at: JAN,
  ...overrides,
});

const draft = (overrides: Partial<FactVersionDraft> = {}): FactVersionDraft => ({
  entity_id: ENTITY,
  property: 'seer2_rating',
  normalized_value: 16.0,
  value_type: 'number',
  unit: null,
  valid_from: JUN,
  confidence: factConfidence(0.95),
  recorded_at: JUN,
  status: 'ACTIVE',
  ...overrides,
});

describe('appendFactVersion', () => {
  it('opens the first version without a close', () => {
    const result = appendFactVersion(null, draft({ valid_from: JAN }));
    expect(result.close).toBeNull();
    expect(result.insert.valid_to).toBeNull();
    expect(result.insert.supersedes_fact_id).toBeNull();
    expect(result.insert.status).toBe('ACTIVE');
  });

  it('closes the previous version and links the new one', () => {
    const previous = fact();
    const result = appendFactVersion(previous, draft());

    expect(result.close).toEqual({ id: FACT_A, valid_to: JUN, status: 'SUPERSEDED' });
    expect(result.insert.supersedes_fact_id).toBe(FACT_A);
    expect(result.insert.normalized_value).toBe(16.0);
    expect(result.insert.valid_to).toBeNull();
  });

  it('never proposes an overwrite of the recorded value', () => {
    const previous = fact();
    const result = appendFactVersion(previous, draft());

    // The close patch touches validity metadata only. If this ever grows a
    // `normalized_value` key, append-versioning has been broken.
    expect(Object.keys(result.close ?? {}).sort()).toEqual(['id', 'status', 'valid_to']);
    expect(previous.normalized_value).toBe(15.2);
  });

  it('closes the old version exactly where the new one opens, leaving no gap', () => {
    const result = appendFactVersion(fact(), draft({ valid_from: JUN }));
    expect(result.close?.valid_to).toBe(result.insert.valid_from);
  });

  it('rejects a version backdated before the one it supersedes', () => {
    expect(() => appendFactVersion(fact({ valid_from: JUN }), draft({ valid_from: JAN }))).toThrow(
      FactVersioningError,
    );
  });

  it('rejects superseding across entities', () => {
    expect(() => appendFactVersion(fact({ entity_id: OTHER_ENTITY }), draft())).toThrow(
      /different entity/,
    );
  });

  it('rejects superseding a different property', () => {
    expect(() => appendFactVersion(fact({ property: 'voltage' }), draft())).toThrow(
      /property "voltage"/,
    );
  });

  it('rejects overlapping an already-closed version', () => {
    const previous = fact({ valid_from: JAN, valid_to: DEC, status: 'SUPERSEDED' });
    expect(() => appendFactVersion(previous, draft({ valid_from: JUN }))).toThrow(
      /already closed at/,
    );
  });

  it('rejects an unparseable timestamp rather than silently ordering by string', () => {
    expect(() => appendFactVersion(fact(), draft({ valid_from: 'last tuesday' }))).toThrow(
      FactVersioningError,
    );
  });
});

describe('validity windows', () => {
  const v1 = fact({ id: FACT_A, valid_from: JAN, valid_to: JUN, status: 'SUPERSEDED' });
  const v2 = fact({
    id: FACT_B,
    valid_from: JUN,
    valid_to: null,
    normalized_value: 16.0,
    supersedes_fact_id: FACT_A,
  });

  it('treats an open version as current', () => {
    expect(isFactVersionOpen(v2)).toBe(true);
    expect(isFactVersionOpen(v1)).toBe(false);
  });

  it('uses half-open intervals so exactly one version matches at a boundary', () => {
    const active = fact({ valid_from: JAN, valid_to: JUN });
    expect(isFactActiveAt(active, JAN)).toBe(true);
    expect(isFactActiveAt(active, '2026-03-01T00:00:00.000Z')).toBe(true);
    expect(isFactActiveAt(active, JUN)).toBe(false);
  });

  it('ignores non-ACTIVE versions', () => {
    expect(isFactActiveAt(fact({ status: 'RETRACTED' }), DEC)).toBe(false);
    expect(isFactActiveAt(fact({ status: 'PROPOSED' }), DEC)).toBe(false);
  });

  it('resolves the version in force at a given instant', () => {
    const facts = [v2, v1];
    expect(currentFactVersion(facts, 'seer2_rating', '2026-03-01T00:00:00.000Z')).toBeNull();
    expect(currentFactVersion(facts, 'seer2_rating', DEC)?.id).toBe(FACT_B);
  });

  it('compares timestamps by instant, not by string', () => {
    const offsetFact = fact({ valid_from: '2026-01-01T02:00:00.000+02:00', valid_to: null });
    expect(isFactActiveAt(offsetFact, JAN)).toBe(true);
  });

  it('builds the canonical per-property view', () => {
    const voltage = fact({ id: FACT_C, property: 'voltage', normalized_value: 240, unit: 'V' });
    const view = currentFactsByProperty([v1, v2, voltage], DEC);
    expect([...view.keys()].sort()).toEqual(['seer2_rating', 'voltage']);
    expect(view.get('seer2_rating')?.id).toBe(FACT_B);
  });

  it('orders versions oldest first', () => {
    expect(factVersionsFor([v2, v1], 'seer2_rating').map((f) => f.id)).toEqual([FACT_A, FACT_B]);
  });
});

describe('factVersionChain', () => {
  it('reconstructs the full lineage of a value', () => {
    const v1 = fact({ id: FACT_A, valid_from: JAN, valid_to: JUN, status: 'SUPERSEDED' });
    const v2 = fact({ id: FACT_B, valid_from: JUN, valid_to: DEC, status: 'SUPERSEDED', supersedes_fact_id: FACT_A });
    const v3 = fact({ id: FACT_C, valid_from: DEC, supersedes_fact_id: FACT_B });

    expect(factVersionChain([v1, v2, v3], v3).map((f) => f.id)).toEqual([FACT_A, FACT_B, FACT_C]);
  });

  it('stops cleanly when an ancestor is not in the provided set', () => {
    const orphan = fact({ id: FACT_C, supersedes_fact_id: FACT_B });
    expect(factVersionChain([orphan], orphan).map((f) => f.id)).toEqual([FACT_C]);
  });

  it('detects a corrupted cyclic chain instead of hanging', () => {
    const a = fact({ id: FACT_A, supersedes_fact_id: FACT_B });
    const b = fact({ id: FACT_B, supersedes_fact_id: FACT_A });
    expect(() => factVersionChain([a, b], a)).toThrow(/Cycle/);
  });
});

describe('canonicalValuesEqual', () => {
  it('compares scalars', () => {
    expect(canonicalValuesEqual(15.2, 15.2)).toBe(true);
    expect(canonicalValuesEqual(15.2, 16)).toBe(false);
    expect(canonicalValuesEqual(null, null)).toBe(true);
    expect(canonicalValuesEqual(null, 0)).toBe(false);
    expect(canonicalValuesEqual('R-410A', 'R-410A')).toBe(true);
  });

  it('compares arrays order-sensitively', () => {
    expect(canonicalValuesEqual(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(canonicalValuesEqual(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(canonicalValuesEqual(['a'], ['a', 'b'])).toBe(false);
  });

  it('compares flat maps', () => {
    expect(canonicalValuesEqual({ min: 1, max: 2 }, { max: 2, min: 1 })).toBe(true);
    expect(canonicalValuesEqual({ min: 1 }, { min: 1, max: 2 })).toBe(false);
  });

  it('does not confuse shapes', () => {
    expect(canonicalValuesEqual(['a'], { 0: 'a' })).toBe(false);
    expect(canonicalValuesEqual(null, {})).toBe(false);
  });
});

describe('needsNewFactVersion', () => {
  it('is true when there is no previous version', () => {
    expect(needsNewFactVersion(null, draft())).toBe(true);
  });

  it('is false when re-observing an identical open value', () => {
    const previous = fact({ normalized_value: 16.0 });
    expect(needsNewFactVersion(previous, draft({ normalized_value: 16.0 }))).toBe(false);
  });

  it('is true when the value, type or unit changes', () => {
    const previous = fact({ normalized_value: 16.0, unit: null });
    expect(needsNewFactVersion(previous, draft({ normalized_value: 17.0 }))).toBe(true);
    expect(needsNewFactVersion(previous, draft({ normalized_value: 16.0, unit: 'SEER2' }))).toBe(true);
    expect(
      needsNewFactVersion(previous, draft({ normalized_value: 16.0, value_type: 'string' })),
    ).toBe(true);
  });

  it('is true when the previous version is already closed', () => {
    const closed = fact({ normalized_value: 16.0, valid_to: DEC, status: 'SUPERSEDED' });
    expect(needsNewFactVersion(closed, draft({ normalized_value: 16.0 }))).toBe(true);
  });
});

describe('retractFactVersion', () => {
  it('closes without deleting', () => {
    const patch = retractFactVersion(fact(), DEC);
    expect(patch).toEqual({ id: FACT_A, valid_to: DEC, status: 'SUPERSEDED' });
  });

  it('refuses to retract before the version existed', () => {
    expect(() => retractFactVersion(fact({ valid_from: JUN }), JAN)).toThrow(FactVersioningError);
  });
});

describe('assertNonDestructiveFactUpdate', () => {
  it('allows validity and confidence maintenance', () => {
    expect(() =>
      assertNonDestructiveFactUpdate({ valid_to: DEC, status: 'SUPERSEDED', confidence: factConfidence(0.5) }),
    ).not.toThrow();
  });

  it.each([
    'normalized_value',
    'valid_from',
    'property',
    'entity_id',
    'value_type',
    'output_kind',
    'unit',
  ] as const)(
    'rejects an update to %s',
    (field) => {
      expect(() => assertNonDestructiveFactUpdate({ [field]: null } as never)).toThrow(
        FactVersioningError,
      );
    },
  );

  it('names every offending column at once', () => {
    expect(() =>
      assertNonDestructiveFactUpdate({ normalized_value: 1, valid_from: JAN } as never),
    ).toThrow(/normalized_value.*valid_from/s);
  });

  it('partitions the columns of facts with no overlap', () => {
    const overlap = IMMUTABLE_FACT_FIELDS.filter((field) =>
      (MUTABLE_FACT_FIELDS as readonly string[]).includes(field),
    );
    expect(overlap).toEqual([]);
  });
});
