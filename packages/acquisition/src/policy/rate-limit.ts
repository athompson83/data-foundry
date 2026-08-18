import { RateLimitExceededError } from '../errors.js';
import { systemClock, type Clock } from '../clock.js';

/**
 * Per-source politeness (doc 05, "rate-limit per domain", "honor crawl delay").
 *
 * Two independent constraints, both enforced:
 *
 * - `crawlDelaySeconds` — minimum gap between consecutive requests to the same
 *   source, from the robots snapshot;
 * - `maxRequestsPerMinute` — the operator's own budget from the source's
 *   acquisition policy, enforced as a sliding 60s window.
 */
export interface RateLimitPolicy {
  readonly crawlDelaySeconds: number | null;
  readonly maxRequestsPerMinute: number | null;
}

export interface RateLimiter {
  /** Resolves once the caller may issue a request. Returns how long it waited, in ms. */
  acquire(key: string, policy: RateLimitPolicy): Promise<number>;
}

/** Explicit opt-out, for bulk local fixture replay where politeness is meaningless. */
export const unlimitedRateLimiter: RateLimiter = {
  acquire: () => Promise.resolve(0),
};

const WINDOW_MS = 60_000;

export interface PerSourceRateLimiterOptions {
  readonly clock?: Clock | undefined;
  /** Refuse rather than block forever when a source is hopelessly over budget. */
  readonly maxWaitMs?: number | undefined;
}

/**
 * Serialises acquisition per source key.
 *
 * Requests for the same key are chained so that two concurrent workers cannot
 * both observe "last request was long ago" and fire simultaneously — the classic
 * way a polite crawler turns into an accidental load test. Different keys never
 * block each other.
 */
export class PerSourceRateLimiter implements RateLimiter {
  readonly #clock: Clock;
  readonly #maxWaitMs: number;
  readonly #tail = new Map<string, Promise<unknown>>();
  readonly #history = new Map<string, number[]>();

  constructor(options: PerSourceRateLimiterOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#maxWaitMs = options.maxWaitMs ?? 5 * WINDOW_MS;
  }

  acquire(key: string, policy: RateLimitPolicy): Promise<number> {
    const previous = this.#tail.get(key) ?? Promise.resolve();
    const next = previous.then(
      () => this.#waitForSlot(key, policy),
      () => this.#waitForSlot(key, policy),
    );
    // Keep the chain alive even if this acquisition rejects.
    this.#tail.set(key, next.catch(() => 0));
    return next;
  }

  async #waitForSlot(key: string, policy: RateLimitPolicy): Promise<number> {
    const history = this.#history.get(key) ?? [];
    const now = this.#clock.now();

    const recent = history.filter((at) => now - at < WINDOW_MS);
    let waitMs = 0;

    const delayMs = (policy.crawlDelaySeconds ?? 0) * 1000;
    const last = recent.at(-1);
    if (delayMs > 0 && last !== undefined) {
      waitMs = Math.max(waitMs, delayMs - (now - last));
    }

    const budget = policy.maxRequestsPerMinute;
    if (budget !== null && budget > 0 && recent.length >= budget) {
      const oldestInWindow = recent[recent.length - budget];
      if (oldestInWindow !== undefined) {
        waitMs = Math.max(waitMs, WINDOW_MS - (now - oldestInWindow));
      }
    }

    waitMs = Math.max(0, Math.ceil(waitMs));
    if (waitMs > this.#maxWaitMs) {
      throw new RateLimitExceededError(key, waitMs, this.#maxWaitMs);
    }
    if (waitMs > 0) await this.#clock.sleep(waitMs);

    const issuedAt = this.#clock.now();
    recent.push(issuedAt);
    this.#history.set(
      key,
      recent.filter((at) => issuedAt - at < WINDOW_MS),
    );
    return waitMs;
  }
}
