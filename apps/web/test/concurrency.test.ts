/**
 * `mapWithConcurrency` is the seam sitemap.ts and gates.ts share for their
 * per-entity fan-out — these tests prove the cap is actually respected, that
 * it is not just a relabeled serial loop (limit: 1 IS a serial loop, and is
 * asserted here to behave exactly like one — that's the case that regresses
 * to the old N+1 pattern this replaces), that results stay in input order
 * regardless of completion order, and that a rejection is not swallowed.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONCURRENCY, mapWithConcurrency } from '../src/concurrency.js';

async function trackedWorker(active: { count: number; max: number }, delayMs: number) {
  active.count += 1;
  active.max = Math.max(active.max, active.count);
  await new Promise((resolve) => setTimeout(resolve, delayMs));
  active.count -= 1;
}

describe('mapWithConcurrency', () => {
  it('never runs more than `limit` calls at once', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const active = { count: 0, max: 0 };
    const result = await mapWithConcurrency(items, 4, async (n) => {
      await trackedWorker(active, 5);
      return n * 2;
    });
    expect(active.max).toBeLessThanOrEqual(4);
    // Proves this is genuinely concurrent, not an accidentally-serial cap.
    expect(active.max).toBeGreaterThan(1);
    expect(result).toEqual(items.map((n) => n * 2));
  });

  it('with limit 1, behaves exactly like the old serial for-loop', async () => {
    const active = { count: 0, max: 0 };
    await mapWithConcurrency([1, 2, 3], 1, async (n) => {
      await trackedWorker(active, 1);
      return n;
    });
    expect(active.max).toBe(1);
  });

  it('preserves input order regardless of which call finishes first', async () => {
    // Item 0 sleeps longest, item 4 finishes first — output order must still
    // match input order, not completion order.
    const delays = [30, 20, 10, 5, 1];
    const result = await mapWithConcurrency(delays, DEFAULT_CONCURRENCY, async (delay, index) => {
      await new Promise((resolve) => setTimeout(resolve, delay));
      return index;
    });
    expect(result).toEqual([0, 1, 2, 3, 4]);
  });

  it('propagates a rejection rather than swallowing it', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('returns an empty array for empty input without spawning any workers', async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 4, async () => {
      calls += 1;
      return 1;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it('caps the worker count at the item count when limit exceeds it', async () => {
    const active = { count: 0, max: 0 };
    await mapWithConcurrency([1, 2], 8, async (n) => {
      await trackedWorker(active, 5);
      return n;
    });
    expect(active.max).toBeLessThanOrEqual(2);
  });
});
