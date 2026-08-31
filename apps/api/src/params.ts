/**
 * Request parsing. Every value that reaches a query-layer call passes through
 * here first.
 *
 * The validators are the canonical schema's own — `EntityIdSchema`,
 * `SlugSchema`, `IdentifierSchema`, `IsoDateTimeSchema`. Hand-rolling a UUID
 * regex in a request handler is precisely the drift AGENTS.md rule 5 forbids:
 * the definition of "an entity id" would then exist twice, and the API's copy
 * would be the one nobody updates. Validation is the schema package's job and
 * this file only calls it.
 *
 * Everything here throws `ApiError`. Nothing here decides anything about data.
 */
import {
  EntityIdSchema,
  IdentifierSchema,
  IsoDateTimeSchema,
  SlugSchema,
  type EntityId,
  type Identifier,
  type IsoDateTime,
  type Slug,
} from '@data-foundry/canonical-schema';
import {
  MAX_FACET_FILTERS,
  MAX_FACET_FILTER_VALUES,
  type FacetFilter,
} from '@data-foundry/query-model';
import { ApiError } from './errors.js';

/**
 * Percent-decode one path segment.
 *
 * `decodeURIComponent` throws a `URIError` on a malformed escape (`/v1/entities/%ZZ`).
 * Letting that propagate turned a client typo into a 500 — the surface reported
 * its own failure for the caller's mistake — so the decode is part of parsing,
 * with the same 400 as any other malformed input.
 */
function decodeSegment(raw: string, parameter: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw ApiError.invalidParameter(
      parameter,
      'expected valid percent-encoding',
      raw.slice(0, 80),
    );
  }
}

export function parseEntityId(raw: string, parameter = 'id'): EntityId {
  const parsed = EntityIdSchema.safeParse(decodeSegment(raw, parameter));
  if (!parsed.success) {
    throw ApiError.invalidParameter(parameter, 'expected a UUID entity id', raw.slice(0, 80));
  }
  return parsed.data;
}

export function parseSlug(raw: string, parameter = 'slug'): Slug {
  const parsed = SlugSchema.safeParse(decodeSegment(raw, parameter));
  if (!parsed.success) {
    throw ApiError.invalidParameter(
      parameter,
      'expected a lowercase hyphen-separated slug',
      raw.slice(0, 80),
    );
  }
  return parsed.data;
}

export function parseIdentifier(raw: string, parameter: string): Identifier {
  const parsed = IdentifierSchema.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.invalidParameter(
      parameter,
      'expected a lowercase snake_case identifier',
      raw.slice(0, 80),
    );
  }
  return parsed.data;
}

export function optionalIdentifier(
  params: URLSearchParams,
  parameter: string,
): Identifier | undefined {
  const raw = params.get(parameter);
  if (raw === null || raw === '') return undefined;
  return parseIdentifier(raw, parameter);
}

export function requiredIdentifier(
  params: URLSearchParams,
  parameter: string,
  purpose: string,
): Identifier {
  const raw = params.get(parameter);
  if (raw === null || raw === '') throw ApiError.missingParameter(parameter, purpose);
  return parseIdentifier(raw, parameter);
}

/** `at` — the instant the canonical view is asked about. Optional everywhere. */
export function optionalInstant(params: URLSearchParams, parameter = 'at'): IsoDateTime | undefined {
  const raw = params.get(parameter);
  if (raw === null || raw === '') return undefined;
  const parsed = IsoDateTimeSchema.safeParse(raw);
  if (!parsed.success) {
    throw ApiError.invalidParameter(
      parameter,
      'expected an ISO-8601 timestamp with an offset',
      raw.slice(0, 80),
    );
  }
  return parsed.data;
}

export function parseBoolean(params: URLSearchParams, parameter: string, fallback = false): boolean {
  const raw = params.get(parameter);
  if (raw === null || raw === '') return fallback;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw ApiError.invalidParameter(parameter, 'expected "true" or "false"', raw.slice(0, 20));
}

export function parseEnum<T extends string>(
  params: URLSearchParams,
  parameter: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = params.get(parameter);
  if (raw === null || raw === '') return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw ApiError.invalidParameter(
    parameter,
    `expected one of ${allowed.join(', ')}`,
    raw.slice(0, 40),
  );
}

export function parseBoundedInt(
  params: URLSearchParams,
  parameter: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(parameter);
  if (raw === null || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw ApiError.invalidParameter(
      parameter,
      `expected an integer between ${min} and ${max}`,
      raw.slice(0, 20),
    );
  }
  return value;
}

/** A comma-separated list, trimmed, empties dropped. */
export function parseList(params: URLSearchParams, parameter: string): string[] {
  const raw = params.get(parameter);
  if (raw === null) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

/**
 * Facet filters, in a syntax flat enough to survive a query string:
 *
 * ```text
 *   filter.refrigerant=R-454B,R-410A     → { op: 'in' }
 *   filter.tonnage.min=3                 → { op: 'range', min: 3, max: null }
 *   filter.tonnage.max=5                 → combined into one range filter
 *   filter.seer2_rating.exists=true      → { op: 'exists' }
 *   filter.seer2_rating.exists           → the same, as a bare flag
 * ```
 *
 * Which properties are filterable, and whether a range makes sense for one, is
 * decided by the vertical's field metadata inside the query layer — not here.
 * An undeclared or non-filterable field raises `UnknownFieldError` there, which
 * this surface renders as 422. That is deliberate: a filter this layer silently
 * dropped would be worse than an error, and a filter this layer *approved* on
 * its own would be a second, divergent definition of "filterable".
 *
 * The same sentence governs the VALUES, which is what the two rejections below
 * are for. A filter the caller wrote and this layer did not apply is invisible
 * to them: the response is a 200 carrying a result set that answers a different
 * question, and every count, page and total derived from it is wrong. It is the
 * failure the pagination bounds already refuse to make — "Rejected with 400
 * INVALID_PARAMETER. Values are never silently clamped" — so an unrecognised
 * value is refused here for the same reason, rather than guessed at or dropped.
 */
export function parseFilters(params: URLSearchParams): FacetFilter[] {
  const ranges = new Map<Identifier, { min: number | null; max: number | null }>();
  const filters: FacetFilter[] = [];
  const seen = new Set<string>();
  let logicalFilterCount = 0;

  const countLogicalFilter = (): void => {
    logicalFilterCount += 1;
    if (logicalFilterCount > MAX_FACET_FILTERS) {
      throw ApiError.invalidParameter(
        'filter',
        `expected at most ${MAX_FACET_FILTERS} logical filters`,
        String(logicalFilterCount),
      );
    }
  };

  for (const [key, value] of params.entries()) {
    if (!key.startsWith('filter.')) continue;
    if (seen.has(key)) {
      throw ApiError.invalidParameter(key, 'expected each filter parameter at most once');
    }
    seen.add(key);
    const rest = key.slice('filter.'.length);
    const dot = rest.lastIndexOf('.');
    const suffix = dot === -1 ? '' : rest.slice(dot + 1);

    if (suffix === 'min' || suffix === 'max') {
      const property = parseIdentifier(rest.slice(0, dot), key);
      // Blank is decided BEFORE the conversion, because the conversion cannot
      // tell it from a bound: `Number('')` and `Number(' ')` are both 0, not
      // NaN, so `filter.tonnage.min=` passed the finiteness check and became
      // `tonnage >= 0` — a constraint the caller never wrote, which silently
      // removed every entity holding no tonnage fact at all. A bound left empty
      // is a bound the caller did not supply; this layer does not get to pick a
      // number for it, and it cannot ignore it either, because the caller who
      // meant to type one would never find out.
      const bound = value.trim() === '' ? Number.NaN : Number(value);
      if (!Number.isFinite(bound)) {
        throw ApiError.invalidParameter(key, 'expected a number', value.slice(0, 40));
      }
      const existing = ranges.get(property);
      if (existing === undefined) countLogicalFilter();
      ranges.set(property, {
        ...(existing ?? { min: null, max: null }),
        [suffix]: bound,
      });
      continue;
    }

    if (suffix === 'exists') {
      const property = parseIdentifier(rest.slice(0, dot), key);
      // `true`, `1`, and the bare `filter.x.exists` with no value at all, which
      // is how a flag reaches a query string. Everything else is refused rather
      // than skipped: an unrecognised spelling used to fall through this branch
      // with no filter pushed and no error raised, so `exists=yes` answered 200
      // with the entire unfiltered collection.
      //
      // `false` and `0` are refused too, and deliberately not inverted here.
      // `exists` is the only presence operator the query layer models; there is
      // no absent form to emit, and composing one on this side would be this
      // surface deciding what a filter means (AGENTS.md rule 5). Saying so is
      // the honest answer to a question the contract cannot express.
      if (value !== 'true' && value !== '1' && value !== '') {
        throw ApiError.invalidParameter(
          key,
          'expected "true", "1" or no value; presence has no negated form',
          value.slice(0, 40),
        );
      }
      countLogicalFilter();
      filters.push({ property, op: 'exists' });
      continue;
    }

    const property = parseIdentifier(rest, key);
    const values = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item !== '');
    if (values.length === 0) {
      throw ApiError.invalidParameter(key, 'expected at least one value', value.slice(0, 40));
    }
    if (values.length > MAX_FACET_FILTER_VALUES) {
      throw ApiError.invalidParameter(
        key,
        `expected at most ${MAX_FACET_FILTER_VALUES} comma-separated values`,
        String(values.length),
      );
    }
    countLogicalFilter();
    filters.push({ property, op: 'in', values });
  }

  for (const [property, bounds] of ranges) {
    filters.push({ property, op: 'range', min: bounds.min, max: bounds.max });
  }
  return filters;
}
