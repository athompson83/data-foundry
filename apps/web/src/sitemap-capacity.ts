/**
 * One sitemap request may inspect at most this many raw canonical-entity
 * pages, regardless of how many verticals or sitemap segments it traverses.
 * With the query layer's 200-row raw page, the absolute request ceiling is
 * 50,000 candidate rows before rights and quality gates are applied.
 */
export const MAX_SITEMAP_SCAN_PAGES_PER_REQUEST = 250;

/** Public callers receive only a generic retryable unavailable response. */
export class SitemapCapacityError extends Error {
  constructor() {
    super('Sitemap request capacity was exhausted.');
    this.name = 'SitemapCapacityError';
  }
}

export function validatedSitemapScanPageBudget(value: unknown): number {
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 1 ||
    (value as number) > MAX_SITEMAP_SCAN_PAGES_PER_REQUEST
  ) {
    throw new RangeError(
      'sitemaps.max_scan_pages_per_request must be an integer from 1 through ' +
        `${MAX_SITEMAP_SCAN_PAGES_PER_REQUEST}; received ${String(value)}.`,
    );
  }
  return value as number;
}

/** Mutable only within one request; never retain this object at module scope. */
export class SitemapScanBudget {
  readonly limit: number;
  #remaining: number;

  constructor(limit: number) {
    this.limit = validatedSitemapScanPageBudget(limit);
    this.#remaining = this.limit;
  }

  consume(): void {
    if (this.#remaining === 0) throw new SitemapCapacityError();
    this.#remaining -= 1;
  }
}
