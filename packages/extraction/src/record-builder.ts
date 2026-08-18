import type { Identifier, JsonObject, SourceArtifact } from '@data-foundry/canonical-schema';
import { computeExtractionConfidence } from './confidence.js';
import type { EvidenceLocator } from './locator.js';
import type { ExtractPattern, ExtractionSchema, FieldRule } from './schema.js';
import type {
  ExtractedRecord,
  ExtractedValue,
  ExtractionIssue,
  ExtractionIssueCode,
  ExtractionSignals,
} from './types.js';

/**
 * What a provider reports back for one field of one record. Providers differ
 * entirely in *how* they find a value; they agree completely on what they must
 * report about it — including, always, a locator.
 */
export interface FieldOutcome {
  readonly field: Identifier;
  readonly raw: string | null;
  readonly locator: EvidenceLocator;
  readonly match_count: number;
  readonly failure?: { readonly code: ExtractionIssueCode; readonly message: string };
}

export interface BuildRecordInput {
  readonly schema: ExtractionSchema;
  readonly artifact: SourceArtifact;
  readonly ordinal: number;
  readonly record_locator: EvidenceLocator;
  readonly outcomes: readonly FieldOutcome[];
  readonly extra_issues?: readonly ExtractionIssue[];
}

/**
 * Applies a declared `extract` regex to a selected raw value.
 *
 * Regexes are compiled per call and never carry `g`-flag `lastIndex` state
 * between records, so extraction stays deterministic under reordering.
 */
export function applyExtractPattern(
  raw: string,
  pattern: ExtractPattern,
): { readonly ok: true; readonly value: string } | { readonly ok: false; readonly message: string } {
  const flags = (pattern.flags ?? '').replace(/g/g, '');
  let regex: RegExp;
  try {
    regex = new RegExp(pattern.pattern, flags);
  } catch (error) {
    return { ok: false, message: `invalid extract pattern: ${String(error)}` };
  }
  const match = regex.exec(raw);
  if (match === null) {
    return { ok: false, message: `extract pattern ${pattern.pattern} did not match` };
  }
  const group = pattern.group ?? (match.length > 1 ? 1 : 0);
  const captured = match[group];
  if (captured === undefined) {
    return { ok: false, message: `extract pattern ${pattern.pattern} has no group ${group}` };
  }
  return { ok: true, value: captured };
}

/** A candidate value together with the address it was read from. */
export interface LocatedValue {
  readonly value: string;
  readonly locator: EvidenceLocator;
}

export type MatchSelection =
  | { readonly ok: true; readonly selected: LocatedValue | null }
  | { readonly ok: false; readonly message: string };

/**
 * Reduces a multi-match selection to a single located value according to the
 * rule's declared policy.
 *
 * The locator travels with the value rather than defaulting to the first match:
 * `on_multiple: 'last'` that reported the first match's address would produce
 * evidence pointing at a value we did not use, which is worse than no evidence.
 */
export function selectMatch(rule: FieldRule, matches: readonly LocatedValue[]): MatchSelection {
  if (matches.length === 0) return { ok: true, selected: null };
  if (matches.length === 1) return { ok: true, selected: matches[0] ?? null };

  switch (rule.on_multiple ?? 'first') {
    case 'first':
      return { ok: true, selected: matches[0] ?? null };
    case 'last':
      return { ok: true, selected: matches[matches.length - 1] ?? null };
    case 'join': {
      const head = matches[0];
      if (head === undefined) return { ok: true, selected: null };
      return {
        ok: true,
        selected: {
          value: matches.map((match) => match.value).join(rule.join_separator ?? ' '),
          locator: head.locator,
        },
      };
    }
    case 'fail':
      return {
        ok: false,
        message: `field ${rule.field} matched ${matches.length} times and on_multiple=fail`,
      };
  }
}

/**
 * Shared tail of every provider's per-field read: apply the declared `extract`
 * regex, then package the outcome. Keeping this in one place is what stops the
 * four providers from drifting on locator or failure semantics.
 */
export function finishField(
  rule: FieldRule,
  matches: readonly LocatedValue[],
  fallbackLocator: EvidenceLocator,
): FieldOutcome {
  const selection = selectMatch(rule, matches);
  if (!selection.ok) {
    return {
      field: rule.field,
      raw: null,
      locator: matches[0]?.locator ?? fallbackLocator,
      match_count: matches.length,
      failure: { code: 'MULTIPLE_MATCH_REJECTED', message: selection.message },
    };
  }

  const selected = selection.selected;
  if (selected === null) {
    return { field: rule.field, raw: null, locator: fallbackLocator, match_count: 0 };
  }

  if (rule.extract !== undefined) {
    const extracted = applyExtractPattern(selected.value, rule.extract);
    if (!extracted.ok) {
      return {
        field: rule.field,
        raw: null,
        locator: selected.locator,
        match_count: matches.length,
        failure: { code: 'FIELD_PARSE_FAILURE', message: extracted.message },
      };
    }
    return {
      field: rule.field,
      raw: extracted.value,
      locator: selected.locator,
      match_count: matches.length,
    };
  }

  return {
    field: rule.field,
    raw: selected.value,
    locator: selected.locator,
    match_count: matches.length,
  };
}

const RAW_PAYLOAD_ABSENT = null;

/**
 * Assembles a provider's per-field outcomes into a `SourceRecord`-shaped claim:
 * raw payload, business key, issue list, signals and the computed
 * `extraction_confidence`.
 */
export function buildRecord(input: BuildRecordInput): ExtractedRecord {
  const { schema, artifact, outcomes } = input;
  const ruleByField = new Map<Identifier, FieldRule>(
    schema.fields.map((rule) => [rule.field, rule] as const),
  );

  const values: ExtractedValue[] = [];
  const issues: ExtractionIssue[] = [...(input.extra_issues ?? [])];
  const rawPayload: JsonObject = {};

  let requiredExpected = 0;
  let requiredPresent = 0;
  let optionalExpected = 0;
  let optionalPresent = 0;
  let parseFailures = 0;
  let ambiguousFields = 0;

  for (const outcome of outcomes) {
    const rule = ruleByField.get(outcome.field);
    const required = rule?.required === true;
    if (required) requiredExpected += 1;
    else optionalExpected += 1;

    const ambiguous = outcome.match_count > 1;
    if (ambiguous) {
      ambiguousFields += 1;
      issues.push({
        code: 'AMBIGUOUS_MATCH',
        field: outcome.field,
        message: `field ${outcome.field} matched ${outcome.match_count} locations; resolved by on_multiple=${rule?.on_multiple ?? 'first'}`,
        locator: outcome.locator,
      });
    }

    if (outcome.failure !== undefined) {
      parseFailures += 1;
      issues.push({
        code: outcome.failure.code,
        field: outcome.field,
        message: outcome.failure.message,
        locator: outcome.locator,
      });
    }

    if (outcome.raw === null) {
      if (required) {
        issues.push({
          code: 'REQUIRED_FIELD_MISSING',
          field: outcome.field,
          message: `required field ${outcome.field} was not found`,
          locator: outcome.locator,
        });
      }
    } else if (required) {
      requiredPresent += 1;
    } else {
      optionalPresent += 1;
    }

    values.push({
      field: outcome.field,
      raw: outcome.raw,
      locator: outcome.locator,
      ambiguous,
      match_count: outcome.match_count,
    });
    rawPayload[outcome.field] = outcome.raw ?? RAW_PAYLOAD_ABSENT;
  }

  const rawByField = new Map(values.map((value) => [value.field, value.raw] as const));
  const separator = schema.record_key.separator ?? '|';
  const keyParts: string[] = [];
  let keyIncomplete = false;
  for (const keyField of schema.record_key.fields) {
    const raw = rawByField.get(keyField);
    if (raw === undefined || raw === null || raw.trim() === '') {
      keyIncomplete = true;
      keyParts.push('');
    } else {
      keyParts.push(raw.trim());
    }
  }

  let sourceRecordKey = keyParts.join(separator);
  if (keyIncomplete || sourceRecordKey === '') {
    issues.push({
      code: 'RECORD_KEY_INCOMPLETE',
      field: null,
      message: `record key fields [${schema.record_key.fields.join(', ')}] were not fully populated; fell back to ordinal`,
      locator: input.record_locator,
    });
    sourceRecordKey = `${schema.schema_id}#${input.ordinal}`;
  }

  const signals: ExtractionSignals = {
    fields_expected: outcomes.length,
    required_expected: requiredExpected,
    required_present: requiredPresent,
    optional_expected: optionalExpected,
    optional_present: optionalPresent,
    parse_failures: parseFailures,
    ambiguous_fields: ambiguousFields,
  };

  return {
    source_id: artifact.source_id,
    artifact_id: artifact.id,
    source_record_key: sourceRecordKey,
    entity_type: schema.entity_type,
    values,
    raw_payload: rawPayload,
    extraction_confidence: computeExtractionConfidence(signals, schema.confidence ?? {}),
    extractor_version: artifact.extractor_version,
    locator: input.record_locator,
    issues,
    signals,
    ordinal: input.ordinal,
  };
}

export const recordKeyFailed = (record: ExtractedRecord): boolean =>
  record.issues.some((issue) => issue.code === 'RECORD_KEY_INCOMPLETE');

/**
 * Applies `record_key.fallback`.
 *
 * `ordinal` (the default) keeps the record with an `artifact#n` key and a
 * `RECORD_KEY_INCOMPLETE` issue — usable, and visibly imperfect. `fail` drops it
 * instead, for sources where a record without its business key would create a
 * duplicate on the next crawl (the ordinal is stable only while the artifact is).
 *
 * Every provider routes its output through this so the option means the same
 * thing everywhere.
 */
export const applyRecordKeyPolicy = (
  schema: ExtractionSchema,
  records: readonly ExtractedRecord[],
): ExtractedRecord[] =>
  (schema.record_key.fallback ?? 'ordinal') === 'fail'
    ? records.filter((record) => !recordKeyFailed(record))
    : [...records];
