/**
 * The route vocabulary has two copies, and this file is why that is safe.
 *
 * One lives in `routes.ts`, because the application is what knows which routes
 * exist. The other lives in `db/migrations/0012_usage_accounting_corrections.sql`,
 * because a foreign key can only reference rows that are actually there. Two
 * copies of a list is ordinarily a drift bug waiting to happen; it is not one
 * here only because these assertions fail CI the moment they disagree.
 *
 * The direction that would actually bite is the one nobody writes: a route added
 * without a key. Its usage rows are then rejected by the database at the moment
 * a paying customer's request is metered — in production, on the revenue path,
 * long after the change that caused it looked complete.
 *
 * This reads the migration as TEXT rather than querying a database, deliberately.
 * The question is whether the file the runner will apply agrees with the code
 * that will insert against it. A live database would only prove that whatever
 * migration ran once agreed — which is a different, weaker claim.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ROUTES, ROUTE_KEYS } from '../src/routes.js';

const MIGRATION = fileURLToPath(
  new URL('../../../db/migrations/0012_usage_accounting_corrections.sql', import.meta.url),
);

/**
 * The keys the migration seeds into `api_route_keys`.
 *
 * Parsed from the INSERT's value tuples rather than from the whole file, so a
 * key mentioned in a comment is not mistaken for a registered one.
 */
function seededKeys(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const insert = /INSERT INTO api_route_keys \(key, description\) VALUES([\s\S]*?);/.exec(sql);
  if (insert?.[1] === undefined) throw new Error('the route-key INSERT is no longer recognisable');
  return [...insert[1].matchAll(/\(\s*'([^']+)'\s*,/g)].map((match) => match[1] as string);
}

describe('the application vocabulary and the reference table agree', () => {
  it('registers every key the application can record', () => {
    // Fails when a route is added without seeding its key. The failure a
    // database would give instead arrives in production, on the revenue path.
    expect(seededKeys().sort()).toEqual([...ROUTE_KEYS].sort());
  });

  it('seeds no key the application will never write', () => {
    // Same assertion, stated as its converse on purpose: `toEqual` on sorted
    // arrays covers both, and a future edit that weakens one half to a subset
    // check should have to notice it is deleting the other.
    for (const key of seededKeys()) expect(ROUTE_KEYS).toContain(key);
  });

  it('registers a key for every route in the table', () => {
    for (const route of ROUTES) expect(ROUTE_KEYS).toContain(route.routeKey);
  });

  it('leaves no route without one', () => {
    // `routeKey` is required by the type, so this cannot fail while the types
    // are checked — and it can fail the moment somebody widens it to optional
    // or builds a route object through a cast.
    for (const route of ROUTES) expect(route.routeKey).toBeTruthy();
  });
});

describe('what a route key may be', () => {
  /**
   * The vocabulary itself is the last place a URL could get in. The migration
   * enforces this shape in SQL; asserting it here too means a key proposed in
   * TypeScript is rejected before anyone writes the migration line for it.
   */
  it('accepts no key a path or a query string could hide inside', () => {
    for (const key of ROUTE_KEYS) {
      expect(key, key).toMatch(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/);
      expect(key.length, key).toBeLessThanOrEqual(64);
    }
  });

  it('records the same key for both slug patterns, because an invoice cannot tell them apart', () => {
    const bySlug = ROUTES.filter((route) => route.pattern[1] === 'by-slug');
    expect(bySlug).toHaveLength(2);
    expect(new Set(bySlug.map((route) => route.routeKey))).toEqual(new Set(['entities.by_slug']));
  });
});
