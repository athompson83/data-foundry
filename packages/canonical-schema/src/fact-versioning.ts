import type { FactConfidence } from './confidence.js';
import type { EntityId, FactId } from './ids.js';
import type { Identifier, IsoDateTime } from './primitives.js';
import type {
  CanonicalScalar,
  CanonicalValue,
  Fact,
  FactInsert,
  FactStatus,
  FactValueType,
} from './objects/facts.js';

/**
 * Append-with-validity helpers for `facts`.
 *
 * The rule this module exists to enforce: **a changed value is a new row.** The
 * previous version is closed by setting `valid_to`, never by rewriting
 * `normalized_value`. That is what makes "what did this page say last March,
 * and which artifact backed it" answerable, and what lets a bad extractor run
 * be unwound without re-crawling. See docs/decisions/ADR-0001.
 */

export class FactVersioningError extends Error {
  override readonly name = 'FactVersioningError';
}

const epoch = (iso: IsoDateTime): number => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) {
    throw new FactVersioningError(`Not a parseable ISO-8601 timestamp: ${iso}`);
  }
  return ms;
};

/** Structural equality for canonical values (scalar, scalar array, flat scalar map). */
export function canonicalValuesEqual(left: CanonicalValue, right: CanonicalValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    if (left.length !== right.length) return false;
    return left.every((item, index) => Object.is(item, right[index]));
  }
  const leftIsMap = typeof left === 'object' && left !== null;
  const rightIsMap = typeof right === 'object' && right !== null;
  if (leftIsMap || rightIsMap) {
    if (!leftIsMap || !rightIsMap) return false;
    const a = left as Record<string, CanonicalScalar>;
    const b = right as Record<string, CanonicalScalar>;
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) return false;
    return aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && Object.is(a[key], b[key]));
  }
  return Object.is(left, right);
}

/** A version with no `valid_to` is the open, current one. */
export function isFactVersionOpen(fact: Pick<Fact, 'valid_to'>): boolean {
  return fact.valid_to === null;
}

/**
 * Is this version the truth at `at`? Requires ACTIVE status *and* validity
 * interval containment; `[valid_from, valid_to)` — half-open, so a close and the
 * next version's open at the same instant do not both match.
 */
export function isFactActiveAt(
  fact: Pick<Fact, 'status' | 'valid_from' | 'valid_to'>,
  at: IsoDateTime,
): boolean {
  if (fact.status !== 'ACTIVE') return false;
  const t = epoch(at);
  if (t < epoch(fact.valid_from)) return false;
  return fact.valid_to === null || t < epoch(fact.valid_to);
}

/** All versions of one property, oldest first. */
export function factVersionsFor(facts: readonly Fact[], property: Identifier): Fact[] {
  return facts
    .filter((fact) => fact.property === property)
    .sort((a, b) => epoch(a.valid_from) - epoch(b.valid_from));
}

/** The single version in force for a property at `at`, if any. */
export function currentFactVersion(
  facts: readonly Fact[],
  property: Identifier,
  at: IsoDateTime,
): Fact | null {
  const matches = factVersionsFor(facts, property).filter((fact) => isFactActiveAt(fact, at));
  return matches[matches.length - 1] ?? null;
}

/** Property → the version in force at `at`. The canonical view for one entity. */
export function currentFactsByProperty(
  facts: readonly Fact[],
  at: IsoDateTime,
): Map<Identifier, Fact> {
  const byProperty = new Map<Identifier, Fact>();
  for (const property of new Set(facts.map((fact) => fact.property))) {
    const current = currentFactVersion(facts, property, at);
    if (current !== null) byProperty.set(property, current);
  }
  return byProperty;
}

/** The `supersedes_fact_id` chain ending at `fact`, oldest first. */
export function factVersionChain(facts: readonly Fact[], fact: Fact): Fact[] {
  const byId = new Map(facts.map((candidate) => [candidate.id, candidate] as const));
  const chain: Fact[] = [fact];
  const seen = new Set<FactId>([fact.id]);
  let cursor = fact.supersedes_fact_id;
  while (cursor !== null) {
    if (seen.has(cursor)) {
      throw new FactVersioningError(`Cycle in fact supersession chain at ${cursor}`);
    }
    const previous = byId.get(cursor);
    if (previous === undefined) break;
    seen.add(previous.id);
    chain.unshift(previous);
    cursor = previous.supersedes_fact_id;
  }
  return chain;
}

/** The shape a caller wants to record. `id`/`valid_to`/`supersedes_fact_id` are derived. */
export interface FactVersionDraft {
  readonly entity_id: EntityId;
  readonly property: Identifier;
  readonly normalized_value: CanonicalValue;
  readonly value_type: FactValueType;
  readonly unit: string | null;
  readonly valid_from: IsoDateTime;
  readonly confidence: FactConfidence;
  readonly recorded_at: IsoDateTime;
  readonly status: Extract<FactStatus, 'PROPOSED' | 'ACTIVE'>;
}

/** UPDATE patch that closes the previous version. Touches only validity metadata. */
export interface FactVersionClose {
  readonly id: FactId;
  readonly valid_to: IsoDateTime;
  readonly status: 'SUPERSEDED';
}

export interface FactAppendResult {
  /** `null` when this is the first version of the property. */
  readonly close: FactVersionClose | null;
  readonly insert: FactInsert;
}

/**
 * Produce the two writes that record a new value: close the old version, insert
 * the new one. Never returns an update to `normalized_value` — that is the
 * whole point.
 *
 * Throws when the draft would corrupt the timeline (wrong entity/property,
 * backdated before the version it supersedes, or overlapping a version that was
 * already closed later).
 */
export function appendFactVersion(previous: Fact | null, draft: FactVersionDraft): FactAppendResult {
  const insertBase: FactInsert = {
    entity_id: draft.entity_id,
    property: draft.property,
    normalized_value: draft.normalized_value,
    value_type: draft.value_type,
    unit: draft.unit,
    valid_from: draft.valid_from,
    valid_to: null,
    status: draft.status,
    confidence: draft.confidence,
    supersedes_fact_id: previous === null ? null : previous.id,
    recorded_at: draft.recorded_at,
  };

  if (previous === null) {
    return { close: null, insert: insertBase };
  }

  if (previous.entity_id !== draft.entity_id) {
    throw new FactVersioningError(
      `Cannot supersede a fact belonging to a different entity (${previous.entity_id} vs ${draft.entity_id})`,
    );
  }
  if (previous.property !== draft.property) {
    throw new FactVersioningError(
      `Cannot supersede property "${previous.property}" with property "${draft.property}"`,
    );
  }
  const from = epoch(draft.valid_from);
  if (from < epoch(previous.valid_from)) {
    throw new FactVersioningError(
      `New version starts (${draft.valid_from}) before the version it supersedes (${previous.valid_from})`,
    );
  }
  if (previous.valid_to !== null && epoch(previous.valid_to) > from) {
    throw new FactVersioningError(
      `Previous version is already closed at ${previous.valid_to}, after the new version starts at ${draft.valid_from}`,
    );
  }

  return {
    close: { id: previous.id, valid_to: draft.valid_from, status: 'SUPERSEDED' },
    insert: insertBase,
  };
}

/** True when the draft actually changes something worth a new row. */
export function needsNewFactVersion(previous: Fact | null, draft: FactVersionDraft): boolean {
  if (previous === null) return true;
  if (!isFactVersionOpen(previous)) return true;
  return (
    !canonicalValuesEqual(previous.normalized_value, draft.normalized_value) ||
    previous.value_type !== draft.value_type ||
    previous.unit !== draft.unit
  );
}

/** Withdraw a version without deleting it (corrections, takedowns, bad extractor runs). */
export function retractFactVersion(fact: Fact, at: IsoDateTime): FactVersionClose & { status: 'SUPERSEDED' } {
  if (epoch(at) < epoch(fact.valid_from)) {
    throw new FactVersioningError(`Cannot retract ${fact.id} before it became valid`);
  }
  return { id: fact.id, valid_to: at, status: 'SUPERSEDED' };
}

/** Columns of `facts` that must never change once written. */
export const IMMUTABLE_FACT_FIELDS = [
  'id',
  'entity_id',
  'property',
  'normalized_value',
  'value_type',
  'unit',
  'valid_from',
  'supersedes_fact_id',
  'recorded_at',
  'created_at',
] as const satisfies readonly (keyof Fact)[];

/** Columns of `facts` an UPDATE may legitimately touch. */
export const MUTABLE_FACT_FIELDS = ['valid_to', 'status', 'confidence'] as const satisfies readonly (keyof Fact)[];

/**
 * Guard for the write path: reject any UPDATE that would overwrite a recorded
 * claim instead of superseding it.
 */
export function assertNonDestructiveFactUpdate(patch: Readonly<Partial<Fact>>): void {
  const illegal = Object.keys(patch).filter((key) =>
    (IMMUTABLE_FACT_FIELDS as readonly string[]).includes(key),
  );
  if (illegal.length > 0) {
    throw new FactVersioningError(
      `Destructive fact update rejected: ${illegal.join(', ')} are immutable. ` +
        `Append a new version with appendFactVersion() instead.`,
    );
  }
}
