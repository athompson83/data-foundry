/**
 * Time and sleeping are injected, never taken from the ambient environment.
 *
 * Crawl delay, rate limiting, conditional-request freshness and policy-snapshot
 * capture all read the clock. If any of them read `Date.now()` directly, the
 * politeness behaviour becomes untestable and the tests become slow.
 */
export interface Clock {
  /** Epoch milliseconds. */
  now(): number;
  /** ISO-8601 with offset — the only timestamp format that crosses a package boundary. */
  nowIso(): string;
  sleep(ms: number): Promise<void>;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, Math.max(0, ms)).unref?.();
    }),
};

/**
 * Deterministic clock for tests and for the offline fixture pipeline.
 *
 * `sleep` does not wait: it records the requested duration and jumps time
 * forward, so a crawl-delay assertion is an equality check on `sleeps` rather
 * than a wall-clock race.
 */
export class ManualClock implements Clock {
  #now: number;
  readonly sleeps: number[] = [];

  constructor(start: string | number = '2026-01-01T00:00:00.000Z') {
    this.#now = typeof start === 'number' ? start : Date.parse(start);
  }

  now(): number {
    return this.#now;
  }

  nowIso(): string {
    return new Date(this.#now).toISOString();
  }

  sleep(ms: number): Promise<void> {
    const waited = Math.max(0, ms);
    this.sleeps.push(waited);
    this.#now += waited;
    return Promise.resolve();
  }

  advance(ms: number): void {
    this.#now += ms;
  }

  set(at: string | number): void {
    this.#now = typeof at === 'number' ? at : Date.parse(at);
  }
}
