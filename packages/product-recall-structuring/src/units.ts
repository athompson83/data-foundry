/**
 * Units affected, from CPSC's NumberOfUnits text: "About 324", "About 1.2
 * million", "About 5,000 (In addition, about 700 were sold in Canada)",
 * "About 30,000 in the U.S. and 2,100 in Canada". Each number is assigned to
 * the country named after it and before the next number; the first
 * unassigned number is the US figure.
 */

export interface UnitCounts {
  readonly us: number | null;
  readonly canada: number | null;
  readonly mexico: number | null;
  /** The source text, cleaned. */
  readonly text: string | null;
}

const NUMBER = /(\d[\d,]*(?:\.\d+)?)(\s*(?:million|thousand))?/gi;

export function parseUnits(text: string | null | undefined): UnitCounts {
  const source = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!source) return { us: null, canada: null, mexico: null, text: null };
  const matches = [...source.matchAll(NUMBER)];
  let us: number | null = null;
  let canada: number | null = null;
  let mexico: number | null = null;
  matches.forEach((match, index) => {
    const raw = (match[1] ?? '').replace(/,/g, '');
    let value = Number(raw);
    if (!Number.isFinite(value)) return;
    const scale = (match[2] ?? '').trim().toLowerCase();
    if (scale === 'million') value *= 1_000_000;
    if (scale === 'thousand') value *= 1_000;
    value = Math.round(value);
    const end = (match.index ?? 0) + match[0].length;
    const next = matches[index + 1]?.index ?? source.length;
    const context = source.slice(end, next);
    if (/\bCanada\b/i.test(context)) canada ??= value;
    else if (/\bMexico\b/i.test(context)) mexico ??= value;
    else us ??= value;
  });
  return { us, canada, mexico, text: source };
}
