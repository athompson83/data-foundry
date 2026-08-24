/**
 * `evaluateGate` is pure comparison logic; these are its unit tests. The
 * property that matters most is the fail-closed default: a threshold the
 * evaluator has no signal for must not silently pass (see `gates.ts`'s
 * `UNMEASURED` convention) — a vacuous "always true" gate is worse than no
 * gate at all, because it reads as a control that was checked.
 */
import { describe, expect, it } from 'vitest';
import { countContentWords, evaluateGate, type GateSignals } from '../src/gates.js';
import type { QualityGate } from '../src/seo.js';

describe('evaluateGate', () => {
  it('passes when every declared threshold is met', () => {
    const gate: QualityGate = { min_entity_quality_score: 0.6, min_total_facts: 6 };
    const signals: GateSignals = { entity_quality_score: 0.8, total_facts: 8 };
    expect(evaluateGate(gate, signals)).toEqual({ passed: true, failures: [] });
  });

  it('fails when a threshold is not met, and names which one', () => {
    const gate: QualityGate = { min_entity_quality_score: 0.6 };
    const signals: GateSignals = { entity_quality_score: 0.4 };
    const verdict = evaluateGate(gate, signals);
    expect(verdict.passed).toBe(false);
    expect(verdict.failures[0]).toContain('entity_quality_score');
  });

  it('fails closed when the gate declares a dimension this deployment has no signal for', () => {
    // The regression this guards: a gate that declares min_related_entities
    // but is evaluated with a signals object that never set it must not pass
    // by omission — that is exactly how a thin page would sneak past doc 07's
    // "quality/demand gated" rule.
    const gate: QualityGate = { min_related_entities: 3 };
    const verdict = evaluateGate(gate, {});
    expect(verdict.passed).toBe(false);
    expect(verdict.failures[0]).toContain('related_entities');
  });

  it('fails closed on demand_threshold — no traffic/analytics system exists in this deployment', () => {
    const gate: QualityGate = { demand_threshold: 0.5 };
    const verdict = evaluateGate(gate, { entity_quality_score: 1 });
    expect(verdict.passed).toBe(false);
  });

  it('fails closed on block_on_open_dispute — no dispute ledger beyond per-fact conflicts exists', () => {
    const gate: QualityGate = { block_on_open_dispute: true };
    const verdict = evaluateGate(gate, {});
    expect(verdict.passed).toBe(false);
  });

  it('fails closed on require_distinct_value — no measurement of "says something the sources do not" exists', () => {
    // hvac's real entity_detail gate declares this. Review found evaluateGate
    // never checked it at all, so an entity page could pass without proving
    // distinct value — the fail-closed default this test pins is the fix.
    const gate: QualityGate = { require_distinct_value: true };
    const verdict = evaluateGate(gate, { entity_quality_score: 1, total_facts: 999 });
    expect(verdict.passed).toBe(false);
  });

  it('does not fail on block_on_open_dispute when the gate does not declare it', () => {
    const gate: QualityGate = { min_entity_quality_score: 0 };
    const verdict = evaluateGate(gate, { entity_quality_score: 1 });
    expect(verdict.passed).toBe(true);
  });

  it('blocks on a disputed critical property when the gate requires it', () => {
    const gate: QualityGate = { block_on_disputed_critical_property: true };
    const passing = evaluateGate(gate, { disputed_critical_property: false });
    const failing = evaluateGate(gate, { disputed_critical_property: true });
    expect(passing.passed).toBe(true);
    expect(failing.passed).toBe(false);
  });

  it('enforces max_staleness_days as an upper bound, not a lower one', () => {
    const gate: QualityGate = { max_staleness_days: 400 };
    expect(evaluateGate(gate, { staleness_days: 100 }).passed).toBe(true);
    expect(evaluateGate(gate, { staleness_days: 500 }).passed).toBe(false);
  });

  it('requires boolean gates to be exactly true, not merely present', () => {
    const gate: QualityGate = { require_terminal_model_indexable: true };
    expect(evaluateGate(gate, { terminal_model_indexable: false }).passed).toBe(false);
    expect(evaluateGate(gate, { terminal_model_indexable: true }).passed).toBe(true);
  });

  it('an empty gate always passes — nothing was declared to check', () => {
    expect(evaluateGate({}, {}).passed).toBe(true);
  });
});

describe('countContentWords', () => {
  it('counts whitespace-delimited words', () => {
    expect(countContentWords('one two three')).toBe(3);
  });

  it('ignores leading/trailing whitespace and collapses runs', () => {
    expect(countContentWords('  one   two  ')).toBe(2);
  });

  it('is zero for empty content', () => {
    expect(countContentWords('   ')).toBe(0);
  });
});
