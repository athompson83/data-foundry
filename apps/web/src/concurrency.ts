/**
 * Bounded-concurrency fan-out for the per-entity I/O loops in `sitemap.ts`
 * and `gates.ts`'s vertical-wide dataset signal. A fully serial `for` loop
 * over paginated sitemap entities or `MAX_VERTICAL_SCAN` (200)
 * entities, each needing several sequential round trips through
 * surface-bound fact selection and evidence explanations, risks a sitemap request
 * taking far longer than a crawler or Worker request budget tolerates.
 * Unbounded `Promise.all` trades that for a different failure: thousands of
 * concurrent queries against a pool sized for `pg`'s default of 10 max
 * connections (see `packages/canonical-store/src/sql-driver.ts`, which opens
 * `new pg.Pool({ connectionString })` with no explicit `max`) would queue or
 * exhaust the pool instead of the event loop, with the same end result plus
 * pool starvation for every other concurrent request this Worker is serving.
 *
 * `DEFAULT_CONCURRENCY` is kept below that pool default so one sitemap
 * request never claims the whole pool for itself — Hyperdrive's edge
 * connection pooling (ADR-0006) still has to share connections across
 * however many other requests this Worker is concurrently handling.
 */
export const DEFAULT_CONCURRENCY = 8;

/**
 * Maps `items` through `fn` with at most `limit` calls in flight at once.
 * Results preserve input order regardless of completion order. A rejection
 * from any call propagates (no result is swallowed), matching what
 * `Promise.all` would do for the fully-parallel case.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError(`mapWithConcurrency: limit must be a positive integer, got ${limit}`);
  }
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
