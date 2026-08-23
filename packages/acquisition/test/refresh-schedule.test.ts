/**
 * The scheduler's job is mostly refusal, so most of this file is about what it
 * declines to schedule.
 *
 * The assertion that matters most is the rights one: a timer that fetched an
 * UNREVIEWED source would violate rule 1 unattended, repeatedly, and with
 * nobody watching. Every other bug here wastes bandwidth.
 */
import { describe, expect, it } from 'vitest';
import type { RefreshCadence, RefreshPolicy } from '@data-foundry/canonical-schema';
import {
  CLOCK_DRIVEN_CADENCES,
  dueSources,
  isClockDriven,
  planRefresh,
  type RefreshCandidate,
} from '../src/policy/refresh-schedule.js';
import { compliantEntry } from './helpers.js';

const NOW = '2026-08-14T00:00:00.000Z';

/** Hours before NOW, as an ISO string. */
const hoursAgo = (hours: number): string =>
  new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();

const POLICY: RefreshPolicy = { cadence: 'WEEKLY', max_staleness_hours: 168, priority: 50 };

function candidate(
  key: string,
  cadence: RefreshCadence,
  lastAcquiredAt: string | null,
  overrides: Parameters<typeof compliantEntry>[0] = {},
): RefreshCandidate {
  return {
    entry: compliantEntry({ key: key as never, refresh_cadence: cadence, ...overrides }),
    lastAcquiredAt,
  };
}

const plan = (candidates: readonly RefreshCandidate[], policy: RefreshPolicy = POLICY) =>
  planRefresh({ candidates, policy, now: NOW });

const keys = (candidates: readonly RefreshCandidate[], policy: RefreshPolicy = POLICY) =>
  dueSources({ candidates, policy, now: NOW }).map((decision) => decision.sourceKey);

describe('a cadence that is not a clock is never scheduled', () => {
  it.each(['MANUAL', 'EVENT_DRIVEN'] as const)('never schedules %s, however old', (cadence) => {
    // Ten years stale. Still not due: these cadences do not mean "rarely",
    // they mean a clock is not what decides.
    const [decision] = plan([candidate('s', cadence, hoursAgo(24 * 365 * 10))]);
    expect(decision?.due).toBe(false);
    expect(decision?.reason).toBe('NOT_CLOCK_DRIVEN');
  });

  it('does not schedule them even when they have never been acquired', () => {
    expect(keys([candidate('s', 'MANUAL', null)])).toEqual([]);
  });

  it('agrees with its own predicate', () => {
    expect(isClockDriven('MANUAL')).toBe(false);
    expect(isClockDriven('EVENT_DRIVEN')).toBe(false);
    for (const cadence of CLOCK_DRIVEN_CADENCES) expect(isClockDriven(cadence), cadence).toBe(true);
  });
});

describe('a source the acquisition gate refuses is never due', () => {
  /**
   * The one that matters. A scheduler with its own copy of the status rules
   * would drift from the gate and eventually fetch something rule 1 forbids —
   * on a timer, unattended, over and over.
   */
  it.each(['RED', 'UNREVIEWED'] as const)('never schedules a %s source', (rights) => {
    const [decision] = plan([
      candidate('blocked', 'DAILY', hoursAgo(1000), { rights_classification: rights }),
    ]);
    expect(decision?.due).toBe(false);
    expect(decision?.reason).toBe('NOT_ACQUIRABLE');
  });

  it('never schedules a source that is not in an acquirable status', () => {
    const [decision] = plan([
      candidate('draft', 'DAILY', hoursAgo(1000), { status: 'UNDER_REVIEW' as never }),
    ]);
    expect(decision?.due).toBe(false);
    expect(decision?.reason).toBe('NOT_ACQUIRABLE');
  });

  it('honours the operator kill switch', () => {
    const [decision] = plan([
      candidate('killed', 'DAILY', hoursAgo(1000), { kill_switch_engaged: true } as never),
    ]);
    expect(decision?.due).toBe(false);
    expect(decision?.reason).toBe('NOT_ACQUIRABLE');
  });

  it('still schedules AMBER, which is permitted to acquire', () => {
    // AMBER warns rather than blocks; a scheduler that treated a warning as a
    // refusal would silently stop refreshing a source nobody withdrew.
    expect(keys([candidate('amber', 'DAILY', hoursAgo(1000), { rights_classification: 'AMBER' })]))
      .toEqual(['amber']);
  });
});

describe('when a clock-driven source comes due', () => {
  it('is not due before its interval has elapsed', () => {
    const [decision] = plan([candidate('daily', 'DAILY', hoursAgo(23))]);
    expect(decision?.due).toBe(false);
    expect(decision?.reason).toBe('NOT_YET_DUE');
  });

  it('is due once it has', () => {
    const [decision] = plan([candidate('daily', 'DAILY', hoursAgo(25))]);
    expect(decision?.due).toBe(true);
    expect(decision?.overdueHours).toBeCloseTo(1);
  });

  it('is due exactly at the boundary, not one tick after', () => {
    expect(plan([candidate('daily', 'DAILY', hoursAgo(24))])[0]?.due).toBe(true);
  });

  it('reads each cadence as a different interval', () => {
    // 48 hours old: past DAILY, not past WEEKLY.
    const decisions = plan(
      [candidate('d', 'DAILY', hoursAgo(48)), candidate('w', 'WEEKLY', hoursAgo(48))],
      { ...POLICY, max_staleness_hours: 10_000 },
    );
    expect(decisions.find((entry) => entry.sourceKey === 'd')?.due).toBe(true);
    expect(decisions.find((entry) => entry.sourceKey === 'w')?.due).toBe(false);
  });
});

describe('a source that has never been acquired', () => {
  it('is due', () => {
    const [decision] = plan([candidate('fresh', 'WEEKLY', null)]);
    expect(decision?.due).toBe(true);
    expect(decision?.reason).toBe('NEVER_ACQUIRED');
  });

  /**
   * Ordering by "most overdue" would put a never-acquired source at infinity
   * and starve every source with a real, finite backlog behind it.
   */
  it('does not report an infinite backlog', () => {
    const [decision] = plan([candidate('fresh', 'WEEKLY', null)]);
    expect(Number.isFinite(decision?.overdueHours)).toBe(true);
    expect(decision?.overdueHours).toBe(0);
  });

  it('outranks a source that is merely overdue', () => {
    expect(
      keys([candidate('overdue', 'DAILY', hoursAgo(1000)), candidate('never', 'DAILY', null)]),
    ).toEqual(['never', 'overdue']);
  });

  it('treats an unparseable timestamp as never acquired, not as fresh', () => {
    // Silently skipping a source whose timestamp is corrupt would stop
    // refreshing it forever, and nothing would say so.
    const [decision] = plan([candidate('corrupt', 'DAILY', 'not-a-date')]);
    expect(decision?.due).toBe(true);
    expect(decision?.reason).toBe('UNTRUSTED_TIMESTAMP');
  });
});

describe('staleness is a louder signal than the cadence', () => {
  it('marks a source past max_staleness_hours as stale, not merely due', () => {
    const [decision] = plan([candidate('old', 'DAILY', hoursAgo(200))]);
    expect(decision?.stale).toBe(true);
    expect(decision?.reason).toBe('STALE');
  });

  it('separates the two: due on cadence is not automatically stale', () => {
    // DAILY under a policy that tolerates 720 hours. Due after a day, stale
    // after a month. Conflating them loses "refresh this" versus "stop
    // trusting this".
    const [decision] = plan([candidate('d', 'DAILY', hoursAgo(48))], {
      ...POLICY,
      max_staleness_hours: 720,
    });
    expect(decision?.due).toBe(true);
    expect(decision?.stale).toBe(false);
    expect(decision?.reason).toBe('DUE');
  });

  it('can make a source due before its own cadence would', () => {
    // WEEKLY source, policy tolerates only 24 hours. Staleness wins.
    const [decision] = plan([candidate('w', 'WEEKLY', hoursAgo(48))], {
      ...POLICY,
      max_staleness_hours: 24,
    });
    expect(decision?.due).toBe(true);
    expect(decision?.stale).toBe(true);
  });

  it('runs stale sources before merely-due ones', () => {
    expect(
      keys(
        [candidate('due', 'DAILY', hoursAgo(30)), candidate('stale', 'DAILY', hoursAgo(300))],
        { ...POLICY, max_staleness_hours: 168 },
      ),
    ).toEqual(['stale', 'due']);
  });
});

describe('a clock that disagrees with the data', () => {
  /**
   * The first version of this block asserted that a future timestamp merely
   * clamped to a non-negative age, and it PASSED against an implementation with
   * the clamp removed — a negative age is already never due, so the clamp
   * changed no outcome. Mutation testing caught that, and chasing why exposed
   * the actual defect: a timestamp implausibly in the future parses fine, so
   * every comparison says "not yet due" forever and nothing reports that the
   * source stopped refreshing. It is the twin of the unparseable case, and it
   * was unhandled.
   */
  it('refreshes a source whose recorded time is implausibly in the future', () => {
    const future = new Date(Date.parse(NOW) + 5 * 3_600_000).toISOString();
    const [decision] = plan([candidate('corrupt', 'DAILY', future)]);
    expect(decision?.due).toBe(true);
    expect(decision?.reason).toBe('UNTRUSTED_TIMESTAMP');
  });

  it('tolerates ordinary clock skew as "just acquired" rather than as corruption', () => {
    // Minutes ahead is two machines disagreeing, not bad data. Treating it as
    // corrupt would re-fetch a source that was genuinely just acquired.
    const skewed = new Date(Date.parse(NOW) + 5 * 60_000).toISOString();
    const [decision] = plan([candidate('skewed', 'DAILY', skewed)]);
    expect(decision?.due).toBe(false);
    expect(decision?.reason).toBe('NOT_YET_DUE');
    expect(decision?.overdueHours).toBeGreaterThanOrEqual(0);
  });
});

describe('the order is the same every time', () => {
  it('breaks ties by key rather than leaving them to sort stability', () => {
    // Identical in every ranked dimension. An order that varied between
    // identical runs would make an incident impossible to reproduce.
    const candidates = [
      candidate('zebra', 'DAILY', hoursAgo(30)),
      candidate('alpha', 'DAILY', hoursAgo(30)),
      candidate('mike', 'DAILY', hoursAgo(30)),
    ];
    expect(keys(candidates)).toEqual(['alpha', 'mike', 'zebra']);
    // And again, from a different input order.
    expect(keys([...candidates].reverse())).toEqual(['alpha', 'mike', 'zebra']);
  });

  it('puts the more overdue source first', () => {
    expect(
      keys([candidate('less', 'DAILY', hoursAgo(30)), candidate('more', 'DAILY', hoursAgo(100))], {
        ...POLICY,
        max_staleness_hours: 10_000,
      }),
    ).toEqual(['more', 'less']);
  });

  it('lists the not-due after the due, rather than dropping them from the plan', () => {
    // `planRefresh` reports on every candidate; `dueSources` is the filter.
    // An operator needs to see that a source was considered and skipped.
    const decisions = plan([candidate('skip', 'MANUAL', null), candidate('run', 'DAILY', null)]);
    expect(decisions.map((entry) => entry.sourceKey)).toEqual(['run', 'skip']);
    expect(decisions).toHaveLength(2);
  });
});
