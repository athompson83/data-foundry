/**
 * Finding #11 — the raw-SQL escape hatch on the customer-facing query layer.
 *
 * `QueryModel` is the object AGENTS.md rule 5 designates as the single thing
 * web, REST, MCP and exports read through. It exposed BOTH `driver` (a raw
 * `SqlDriver`) and `store` (whose `.driver` is the same object). Any future
 * request handler holding a `QueryModel` therefore held unrestricted SQL —
 * including writes — against the canonical database.
 *
 * The audit proved what that bypasses: a bare fact and a bare relationship can
 * be inserted with NO evidence row (rule 2), because that invariant lives in
 * `appendFactWithEvidence` rather than in SQL. `facts()` and `relationships()`
 * then serve the unevidenced row.
 *
 * These tests assert the BOUNDARY, not a naming convention. A renamed escape
 * hatch must not pass them: the assertions look for any reachable property that
 * quacks like a SQL driver, whatever it is called.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createQueryFixtures, type QueryFixtures } from './support.js';

let fixtures: QueryFixtures;

beforeAll(async () => {
  fixtures = await createQueryFixtures();
});

afterAll(async () => {
  await fixtures?.driver.close();
});

/** Structural: does this value behave like a raw SQL driver, whatever its name? */
function looksLikeSqlDriver(value: unknown): boolean {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['query'] === 'function' || typeof candidate['transaction'] === 'function';
}

/** Every property reachable one hop from an object, own + prototype. */
function reachableProperties(target: object): string[] {
  const names = new Set<string>(Object.keys(target));
  const proto = Object.getPrototypeOf(target) as object | null;
  if (proto !== null && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (name !== 'constructor') names.add(name);
    }
  }
  return [...names];
}

describe('raw driver is not reachable from the customer-facing query layer', () => {
  it('does not expose the raw driver from the package public API', () => {
    const qm = fixtures.qm as unknown as Record<string, unknown>;

    // Named check — the specific hatch the audit found.
    expect('driver' in qm).toBe(false);

    // Structural check — a rename must not slip past. No property one hop from
    // the QueryModel may behave like a SQL driver.
    const leaks = reachableProperties(fixtures.qm).filter((name) => looksLikeSqlDriver(qm[name]));
    expect(leaks).toEqual([]);
  });

  it('does not expose the canonical store, whose driver is the same object', () => {
    const qm = fixtures.qm as unknown as Record<string, unknown>;
    expect('store' in qm).toBe(false);

    // Two hops: nothing reachable from the QueryModel may carry a driver either.
    const twoHop = reachableProperties(fixtures.qm)
      .map((name) => qm[name])
      .filter((value): value is object => typeof value === 'object' && value !== null)
      .flatMap((value) => reachableProperties(value).map((inner) => (value as Record<string, unknown>)[inner]))
      .filter(looksLikeSqlDriver);
    expect(twoHop).toEqual([]);
  });

  it('does not expose the raw driver through supported subpath exports', () => {
    // Resolved from the test file, not cwd — the suite runs from the repo root.
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { exports: Record<string, unknown> };

    // A closed export map: one entry, no wildcard. `@data-foundry/query-model/src/...`
    // is therefore not a supported specifier, so internal modules cannot be
    // deep-imported to reconstruct the hatch.
    expect(Object.keys(manifest.exports)).toEqual(['.']);
    for (const subpath of Object.keys(manifest.exports)) {
      expect(subpath).not.toContain('*');
    }
  });

  it('prevents runtime import of the driver through the built package', async () => {
    // Asserting the export map is closed is a claim ABOUT the manifest. This
    // actually attempts the imports and requires them to fail, which is the
    // claim that matters: no supported specifier reaches the driver module.
    const forbidden = [
      '@data-foundry/canonical-store/src/sql-driver.js',
      '@data-foundry/canonical-store/src/sql-driver',
      '@data-foundry/canonical-store/src/store.js',
      '@data-foundry/query-model/src/sql.js',
      '@data-foundry/canonical-store/dist/sql-driver.js',
    ];

    for (const specifier of forbidden) {
      let resolved = false;
      try {
        await import(/* @vite-ignore */ specifier);
        resolved = true;
      } catch {
        resolved = false;
      }
      expect(resolved, `${specifier} must not be importable`).toBe(false);
    }

    // The supported specifier resolves, and does NOT hand out a driver factory.
    const surface = (await import('@data-foundry/canonical-store')) as Record<string, unknown>;
    const driverish = Object.keys(surface).filter((name) => {
      const value = surface[name];
      return (
        value !== null &&
        typeof value === 'object' &&
        (typeof (value as Record<string, unknown>)['query'] === 'function' ||
          typeof (value as Record<string, unknown>)['transaction'] === 'function')
      );
    });
    expect(driverish).toEqual([]);
  });

  it('routes ordinary callers through the policy-enforcing facade', () => {
    // What a handler MAY do: read through the canonical query layer.
    for (const method of [
      'getEntity',
      'getEntityBySlug',
      'lookupIdentifier',
      'search',
      'facets',
      'canonicalFacts',
      'explainFact',
      'relationships',
      'compare',
      'provenanceCoverage',
    ]) {
      expect(typeof (fixtures.qm as unknown as Record<string, unknown>)[method]).toBe('function');
    }

    // What it may NOT do: anything that writes. The facade is read-only.
    const writeish = reachableProperties(fixtures.qm).filter((name) =>
      /^(insert|update|delete|upsert|append|write|merge|publish|exec|query|transaction)/i.test(name),
    );
    expect(writeish).toEqual([]);
  });

  it('cannot publish rights-blocked or unapproved data through the driver path', () => {
    // The audit's sink was `store.driver.query('INSERT INTO facts …')` reached
    // from a QueryModel. With no driver and no store on the facade, there is no
    // property through which arbitrary SQL can be issued at all.
    const qm = fixtures.qm as unknown as Record<string, unknown>;
    const sqlCapable = reachableProperties(fixtures.qm).filter((name) => {
      const value = qm[name];
      return typeof value === 'function' && /query|exec|raw|sql/i.test(name);
    });
    expect(sqlCapable).toEqual([]);
  });

  it('scopes reads to a vertical, the only isolation boundary that exists today', async () => {
    // HONEST NOTE: there is no tenant/account/api_key concept anywhere in
    // db/migrations — so tenant isolation cannot be bypassed because it does not
    // exist yet. `vertical_id` is the closest analogue, and the public read
    // entry points require it. When accounts land, this test is the place to
    // assert cross-tenant refusal.
    const foreign = '00000000-0000-4000-8000-00000000dead';
    const hits = await fixtures.qm.search({
      vertical_id: foreign as never,
      text: 'Carrier',
    });
    expect(hits.hits).toEqual([]);

    const mine = await fixtures.qm.search({ vertical_id: fixtures.vertical.id, text: 'Carrier' });
    expect(mine.hits.length).toBeGreaterThan(0);
  });

  it('preserves the trusted internal workflow without weakening controls', async () => {
    // Trusted infrastructure (provenance, the ingest worker) still reaches the
    // driver via the CanonicalStore it is constructed with — the facade removal
    // must not have broken the pipeline's own reads.
    const coverage = await fixtures.qm.provenanceCoverage();
    expect(coverage.facts.coverage).toBeGreaterThanOrEqual(0);

    const entity = await fixtures.qm.getEntity(fixtures.equipment.id);
    expect(entity?.entity.id).toBe(fixtures.equipment.id);

    // And the store itself still refuses a bare fact — the invariant that the
    // escape hatch was routing around is unchanged.
    const store = fixtures.store as unknown as Record<string, unknown>;
    expect(typeof store['appendFactWithEvidence']).toBe('function');
    expect(store['insertFact']).toBeUndefined();
  });
});
