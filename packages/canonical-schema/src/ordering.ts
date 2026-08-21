/**
 * Deterministic ordering primitives.
 *
 * Wherever the platform has to pick one of several otherwise-indistinguishable
 * things — the published value among tied claims, the display spelling among
 * equally authoritative ones, the entity a conflicted record attaches to — the
 * choice has to be a function of the data and nothing else. Two things
 * routinely sneak in and make it a function of something else instead:
 *
 *   - **`localeCompare`.** It answers with the host's collator. `'abc-9001'`
 *     sorts before `'ABC-9001'` under `en_US` and after it under `da_DK`, on
 *     plain ASCII, so the same inputs publish different names on different
 *     machines — and on the same machine after an ICU upgrade. The
 *     `@data-foundry/normalization` package already bans locale-sensitive
 *     operations outright; this is the same rule for the ordering side.
 *
 *   - **Random ids.** `gen_random_uuid()` is stable within one database and
 *     meaningless across a rebuild, a replay or a restore into a new
 *     environment. Sorting by it looks reproducible and is not: re-ingesting
 *     the same artifacts publishes a different answer.
 *
 * `compareCodeUnits` is the replacement for the first. It is UTF-16 code-unit
 * order — exactly what `<` on strings already does — expressed as a named
 * comparator so that reading a sort makes the intent obvious and a reviewer can
 * see that no collator is involved. It is a total order, identical on every
 * runtime and every locale.
 */

/**
 * Compare two strings by UTF-16 code unit. Locale-independent and total.
 *
 * Codepoints above U+FFFF order after U+E000–U+FFFF rather than before them,
 * which differs from codepoint order but is still identical everywhere — which
 * is the property being bought here. Nothing in the canonical model orders on
 * astral-plane text.
 */
export function compareCodeUnits(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Compare two lists of strings element by element, then by length.
 *
 * Used for composite ordering keys, so a caller can express "by value, then by
 * unit, then by evidence" without hand-rolling a chain of comparisons that is
 * easy to get subtly non-total.
 */
export function compareKeys(left: readonly string[], right: readonly string[]): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const order = compareCodeUnits(left[index] as string, right[index] as string);
    if (order !== 0) return order;
  }
  return left.length - right.length;
}
