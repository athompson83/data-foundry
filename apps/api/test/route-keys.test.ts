/**
 * The route vocabulary has two copies, and this file is why that is safe.
 *
 * One lives in `routes.ts`, because the application is what knows which routes
 * exist. The other is the cumulative set seeded by immutable forward
 * migrations, because a foreign key can only reference rows that are actually
 * there. Two
 * copies of a list is ordinarily a drift bug waiting to happen; it is not one
 * here only because these assertions fail CI the moment they disagree.
 *
 * The direction that would actually bite is the one nobody writes: a route added
 * without a key. Its usage rows are then rejected by the database at the moment
 * a paying customer's request is metered — in production, on the revenue path,
 * long after the change that caused it looked complete.
 *
 * This reads every migration as TEXT rather than querying a database,
 * deliberately. Future keys belong in a new migration; this test must never
 * encourage editing applied migration 0012.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_ROUTE_KEY,
  ROUTES,
  ROUTE_KEYS,
  SERVICE_ROUTE_KEY,
  UNMATCHED_ROUTE_KEY,
} from '../src/routes.js';

const MIGRATIONS = fileURLToPath(new URL('../../../db/migrations/', import.meta.url));

/**
 * The keys the migration seeds into `api_route_keys`.
 *
 * Parsed from the INSERT's value tuples rather than from the whole file, so a
 * key mentioned in a comment is not mistaken for a registered one.
 */
function seededKeys(): string[] {
  const keys: string[] = [];
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(`${MIGRATIONS}/${file}`, 'utf8');
    for (const insert of sql.matchAll(/INSERT INTO api_route_keys \(key, description\) VALUES([\s\S]*?);/g)) {
      if (insert[1] === undefined) throw new Error(`route-key INSERT in ${file} is not recognisable`);
      keys.push(...[...insert[1].matchAll(/\(\s*'([^']+)'\s*,/g)].map((match) => match[1] as string));
    }
  }
  if (keys.length === 0) throw new Error('no migration seeds api_route_keys');
  return [...new Set(keys)];
}

describe('the application vocabulary and the reference table agree', () => {
  it('registers every key the application can record', () => {
    // Fails when a route is added without seeding its key. The failure a
    // database would give instead arrives in production, on the revenue path.
    expect(seededKeys().filter((key) => !key.startsWith('mcp.')).sort()).toEqual(
      [...ROUTE_KEYS].sort(),
    );
  });

  it('seeds no key the application will never write', () => {
    // Same assertion, stated as its converse on purpose: `toEqual` on sorted
    // arrays covers both, and a future edit that weakens one half to a subset
    // check should have to notice it is deleting the other.
    for (const key of seededKeys().filter((candidate) => !candidate.startsWith('mcp.'))) {
      expect(ROUTE_KEYS).toContain(key);
    }
  });

  it('registers a key for every route in the table', () => {
    for (const route of ROUTES) expect(ROUTE_KEYS).toContain(route.routeKey);
  });

  /**
   * The converse of the assertion above, and the one that was missing.
   *
   * Everything so far proves the two LISTS agree. None of it proves a key can
   * actually be produced: a key added to both `ROUTE_KEYS` and the migration
   * with no route assigning it passes every one of them, and is dead
   * vocabulary — a value the database will accept and nothing will ever write.
   *
   * The three exemptions are the point of the test. `service`, `contract` and
   * `unmatched` describe requests that reach no `ROUTES` entry by design.
   * Naming them here forces a fourth routeless key to be justified in this file
   * rather than added quietly.
   */
  it('leaves no key without a route, except the three that describe no route', () => {
    const assigned = new Set<string>(ROUTES.map((route) => route.routeKey));
    const exempt = new Set<string>([SERVICE_ROUTE_KEY, CONTRACT_ROUTE_KEY, UNMATCHED_ROUTE_KEY]);
    const orphans = ROUTE_KEYS.filter((key) => !assigned.has(key) && !exempt.has(key));
    expect(orphans).toEqual([]);
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
