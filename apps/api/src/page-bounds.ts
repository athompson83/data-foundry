/** Shared pagination limits with no dependency on error construction or wire schemas. */
export const PAGE_BOUNDS = {
  defaultLimit: 25,
  minLimit: 1,
  maxLimit: 100,
  maxOffset: 10_000,
} as const;
