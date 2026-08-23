import { describe, expect, it } from 'vitest';
import { ManualClock } from '../src/clock.js';
import { RateLimitExceededError } from '../src/errors.js';
import { PerSourceRateLimiter, unlimitedRateLimiter } from '../src/policy/rate-limit.js';

const NO_LIMIT = { crawlDelaySeconds: null, maxRequestsPerMinute: null };

describe('per-source rate limiting', () => {
  it('does not delay the first request', async () => {
    const clock = new ManualClock();
    const limiter = new PerSourceRateLimiter({ clock });
    expect(await limiter.acquire('a', { crawlDelaySeconds: 5, maxRequestsPerMinute: null })).toBe(0);
    expect(clock.sleeps).toEqual([]);
  });

  it('waits out the crawl delay between consecutive requests', async () => {
    const clock = new ManualClock();
    const limiter = new PerSourceRateLimiter({ clock });
    const policy = { crawlDelaySeconds: 2, maxRequestsPerMinute: null };

    await limiter.acquire('ratings-directory', policy);
    const waited = await limiter.acquire('ratings-directory', policy);

    expect(waited).toBe(2000);
    expect(clock.sleeps).toEqual([2000]);
  });

  it('credits time that has already elapsed', async () => {
    const clock = new ManualClock();
    const limiter = new PerSourceRateLimiter({ clock });
    const policy = { crawlDelaySeconds: 2, maxRequestsPerMinute: null };

    await limiter.acquire('a', policy);
    clock.advance(1500);
    expect(await limiter.acquire('a', policy)).toBe(500);
  });

  it('keeps sources independent of each other', async () => {
    const clock = new ManualClock();
    const limiter = new PerSourceRateLimiter({ clock });
    const policy = { crawlDelaySeconds: 10, maxRequestsPerMinute: null };

    await limiter.acquire('a', policy);
    expect(await limiter.acquire('b', policy)).toBe(0);
  });

  it('enforces a per-minute budget as a sliding window', async () => {
    const clock = new ManualClock();
    const limiter = new PerSourceRateLimiter({ clock });
    const policy = { crawlDelaySeconds: null, maxRequestsPerMinute: 3 };

    await limiter.acquire('a', policy);
    clock.advance(1_000);
    await limiter.acquire('a', policy);
    clock.advance(1_000);
    await limiter.acquire('a', policy);

    // Fourth request inside the window must wait until the first ages out.
    const waited = await limiter.acquire('a', policy);
    expect(waited).toBe(58_000);
  });

  it('serialises concurrent acquisitions for the same source', async () => {
    const clock = new ManualClock();
    const limiter = new PerSourceRateLimiter({ clock });
    const policy = { crawlDelaySeconds: 1, maxRequestsPerMinute: null };

    const waits = await Promise.all([
      limiter.acquire('a', policy),
      limiter.acquire('a', policy),
      limiter.acquire('a', policy),
    ]);

    // Without serialisation all three would observe an empty history and fire at once.
    expect(waits).toEqual([0, 1000, 1000]);
  });

  it('refuses rather than blocking forever when the wait exceeds the budget', async () => {
    const clock = new ManualClock();
    const limiter = new PerSourceRateLimiter({ clock, maxWaitMs: 500 });
    const policy = { crawlDelaySeconds: 60, maxRequestsPerMinute: null };

    await limiter.acquire('a', policy);
    await expect(limiter.acquire('a', policy)).rejects.toBeInstanceOf(RateLimitExceededError);
  });

  it('keeps the queue usable after a refusal', async () => {
    const clock = new ManualClock();
    const limiter = new PerSourceRateLimiter({ clock, maxWaitMs: 500 });
    const policy = { crawlDelaySeconds: 60, maxRequestsPerMinute: null };

    await limiter.acquire('a', policy);
    await expect(limiter.acquire('a', policy)).rejects.toBeInstanceOf(RateLimitExceededError);
    clock.advance(60_000);
    expect(await limiter.acquire('a', policy)).toBe(0);
  });

  it('offers an explicit opt-out for offline replay', async () => {
    expect(await unlimitedRateLimiter.acquire('a', NO_LIMIT)).toBe(0);
  });
});
