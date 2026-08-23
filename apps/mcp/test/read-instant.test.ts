/**
 * One request reads one instant.
 *
 * Every fact in this platform is versioned and every selection is evaluated AS
 * OF a moment (doc 04). A tool call that reads the clock twice is therefore
 * answering two different questions and presenting the answers as one: the
 * sheet can be selected at 12:00:00.001 and reported as `asOf` 12:00:00.002,
 * so the response says a value was current at an instant at which it was never
 * consulted. Re-running the same call with the reported `asOf` — which is
 * exactly what a careful agent does to reproduce an answer — can then return
 * something else, and nothing in the payload explains why.
 *
 * The fixtures elsewhere pin `at` in the server policy, which hides all of
 * this: with an instant configured the clock is never read at all. So these
 * tests configure NO instant, which is the deployment default, and replace the
 * clock with one that advances by a second on every read. Two reads then differ
 * visibly, where a frozen clock would make the defect invisible.
 *
 * Both the app and the query layer take the instant from `new Date()`, so
 * counting constructions counts every clock read on the path.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpFixtures, errorOf, resultOf, type McpFixtures } from './support.js';
import {
  createMcpServer,
  type CompareEntitiesResult,
  type ExplainFactResult,
  type GetEntityResult,
  type ListFactsResult,
  type McpServer,
} from '../src/index.js';

let fixtures: McpFixtures;
/** A server with no configured read instant: the deployment default. */
let live: McpServer;

const RealDate = Date;
const BASE = RealDate.parse('2026-07-01T00:00:00.000Z');

let reads = 0;

/** Every read is a second later than the last, so a second read is observable. */
const nextInstant = (): number => {
  reads += 1;
  return BASE + reads * 1000;
};

/** The instant the nth clock read of a call returns, as the wire renders it. */
const tick = (nth: number): string => new RealDate(BASE + nth * 1000).toISOString();

/** Run one call with the advancing clock installed, and report how often it ticked. */
async function timed<T>(call: () => Promise<T>): Promise<{ result: T; reads: number }> {
  const advancing = new Proxy(RealDate, {
    construct: (target, args: unknown[]) =>
      args.length === 0
        ? new RealDate(nextInstant())
        : (Reflect.construct(target, args) as Date),
  });
  reads = 0;
  globalThis.Date = advancing as DateConstructor;
  try {
    const result = await call();
    return { result, reads };
  } finally {
    globalThis.Date = RealDate;
  }
}

beforeAll(async () => {
  fixtures = await createMcpFixtures();
  live = createMcpServer({
    queryModel: fixtures.qm,
    vertical: { id: fixtures.vertical.id, slug: 'hvac' },
  });
});

afterAll(async () => {
  await fixtures?.driver.close();
});

describe('a call with no instant supplied by the caller', () => {
  it('reads the clock once and reports the instant it actually selected at', async () => {
    const { result, reads: clockReads } = await timed(async () =>
      resultOf<ListFactsResult>(
        await live.callTool('list_facts', { entity_id: fixtures.equipment.id }),
      ),
    );

    // One read, so there is only one instant this answer could be as of...
    expect(clockReads).toBe(1);
    // ...and it is the one the selection below was evaluated at, not a later
    // one taken after the query layer had already chosen an instant of its own.
    expect(result.asOf).toBe(tick(1));
    expect(result.facts.length).toBeGreaterThan(0);
  });

  it('holds for get_entity, which reads a sheet through a second helper', async () => {
    const { result, reads: clockReads } = await timed(async () =>
      resultOf<GetEntityResult>(await live.callTool('get_entity', { identifier: '24ANB7' })),
    );
    expect(clockReads).toBe(1);
    expect(result.asOf).toBe(tick(1));
  });

  it('explains a value as of the instant it says it did', async () => {
    // `asOf` here is the query layer's own `at`, echoed back. It matches only
    // because this app resolved the instant before the call and handed it down
    // rather than letting each layer take its own.
    const { result, reads: clockReads } = await timed(async () =>
      resultOf<ExplainFactResult>(
        await live.callTool('explain_fact', {
          entity_id: fixtures.equipment.id,
          property: 'seer2_rating',
        }),
      ),
    );
    expect(clockReads).toBe(1);
    expect(result.asOf).toBe(tick(1));
  });

  it('compares entities as of one instant, not one instant per entity', async () => {
    // `compare` reads a canonical fact sheet per entity, and each of those
    // selections takes its own instant when the policy carries none. A table
    // whose columns are as of different moments is not a comparison of the
    // catalogue at any moment, and nothing in the response says so — it has no
    // `asOf` field to disagree with.
    const { reads: clockReads } = await timed(async () =>
      resultOf<CompareEntitiesResult>(
        await live.callTool('compare_entities', {
          entity_ids: [fixtures.equipment.id, fixtures.heatPump.id, fixtures.motor.id],
        }),
      ),
    );
    expect(clockReads).toBe(1);
  });

  it('states one instant in a refusal, not one per sentence', async () => {
    // The coverage-gap refusal names the instant twice: once in the prose a
    // human reads and once in the details a program reads. Two clock reads make
    // the two disagree, and the caller cannot tell which one the catalogue was
    // actually consulted at.
    const { result: error, reads: clockReads } = await timed(async () =>
      errorOf(
        await live.callTool('explain_fact', {
          entity_id: fixtures.equipment.id,
          property: 'warranty_years',
        }),
      ),
    );

    expect(error.code).toBe('PROPERTY_NOT_RECORDED');
    expect(clockReads).toBe(1);
    expect(error.details['as_of']).toBe(tick(1));
    expect(error.message).toContain(tick(1));
  });
});

describe('a call that names its own instant', () => {
  it('does not read the clock at all, and reports what was asked for', async () => {
    const asOf = '2026-03-01T00:00:00.000Z';
    const { result, reads: clockReads } = await timed(async () =>
      resultOf<ListFactsResult>(
        await live.callTool('list_facts', { entity_id: fixtures.equipment.id, as_of: asOf }),
      ),
    );
    expect(clockReads).toBe(0);
    expect(result.asOf).toBe(asOf);
  });
});
