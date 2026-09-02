/**
 * Pagination, with the semantics stated rather than implied.
 *
 * The rules, all four of them:
 *
 *   1. `limit` and `offset` are integers. `limit` is 1–100, `offset` is
 *      0–10000.
 *   2. **Out-of-range is an error, not a clamp.** A client that asks for
 *      `limit=1000` and silently receives 100 has no way to know it is missing
 *      rows; every subsequent page it computes is wrong. It gets a 400 instead.
 *      (The query layer clamps internally as a defence in depth. This surface
 *      never relies on that, because relying on it is what makes the clamp
 *      invisible.)
 *   3. **Past the end is empty, not missing.** `offset` beyond `total` is a
 *      valid question with the answer "nothing here": 200, `data: []`,
 *      `hasMore: false`. A 404 would mean the collection does not exist.
 *   4. `total` is the size of the whole result set, not of the page, and
 *      `hasMore` is derived from it — so a client can page without guessing
 *      whether a short page is the last one.
 *
 * The 10000 `offset` ceiling matches the query layer's own bound. Deep paging
 * past it is a bulk-export question, not a REST question (doc 18 scope control).
 */
import { ApiError } from './errors.js';
import { PAGE_BOUNDS } from './page-bounds.js';
export { PAGE_BOUNDS } from './page-bounds.js';

export interface PageRequest {
  readonly limit: number;
  readonly offset: number;
}

export interface PageMeta {
  readonly limit: number;
  readonly offset: number;
  /** Size of the full result set. */
  readonly total: number;
  readonly hasMore: boolean;
}

export interface Page<T> {
  readonly data: readonly T[];
  readonly page: PageMeta;
}

function parseBoundedInteger(
  raw: string | null,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (raw === null || raw === '') return fallback;
  // `Number` rather than `parseInt`: `parseInt('12abc')` is 12, which would
  // accept a typo as a page size.
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw ApiError.invalidParameter(name, 'expected an integer', raw);
  }
  if (value < min || value > max) {
    throw ApiError.invalidParameter(name, `expected an integer between ${min} and ${max}`, raw);
  }
  return value;
}

export function parsePageRequest(params: URLSearchParams): PageRequest {
  return {
    limit: parseBoundedInteger(
      params.get('limit'),
      'limit',
      PAGE_BOUNDS.defaultLimit,
      PAGE_BOUNDS.minLimit,
      PAGE_BOUNDS.maxLimit,
    ),
    offset: parseBoundedInteger(params.get('offset'), 'offset', 0, 0, PAGE_BOUNDS.maxOffset),
  };
}

/** Slice an already-materialised collection. `total` is exact. */
export function paginate<T>(items: readonly T[], request: PageRequest): Page<T> {
  const data = items.slice(request.offset, request.offset + request.limit);
  return {
    data,
    page: {
      limit: request.limit,
      offset: request.offset,
      total: items.length,
      hasMore: request.offset + data.length < items.length,
    },
  };
}

/** Page metadata for a collection the query layer paged for us. */
export function pageMeta(request: PageRequest, returned: number, total: number): PageMeta {
  return {
    limit: request.limit,
    offset: request.offset,
    total,
    hasMore: request.offset + returned < total,
  };
}
