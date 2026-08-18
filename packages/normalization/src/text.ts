/**
 * Layer 1 of doc 06: primitive cleanup.
 *
 * Every function here is pure, total and deterministic — same string in, same
 * string out, forever. No locale-sensitive operations (`toLocaleUpperCase`,
 * `localeCompare`) appear anywhere in this package: they make output depend on
 * the machine that ran the pipeline, which would make golden records a fiction.
 */

/** Unicode NFKC: collapses compatibility forms so `ＲＯＯＦＴＯＰ` and `ROOFTOP` agree. */
export const normalizeUnicode = (value: string): string => value.normalize('NFKC');

export const trim = (value: string): string => value.trim();

export const collapseWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

/**
 * Typographic punctuation → ASCII.
 *
 * This matters far more than it looks: a model number copied out of a PDF often
 * carries a non-breaking hyphen (U+2011) or an en dash, and `24ACC6‑36A003`
 * would otherwise never match `24ACC6-36A003`.
 */
const PUNCTUATION_MAP: ReadonlyMap<string, string> = new Map([
  ['‐', '-'],
  ['‑', '-'],
  ['‒', '-'],
  ['–', '-'],
  ['—', '-'],
  ['―', '-'],
  ['−', '-'],
  ['‘', "'"],
  ['’', "'"],
  ['‚', "'"],
  ['‛', "'"],
  ['“', '"'],
  ['”', '"'],
  ['„', '"'],
  // Unicode spaces, written as escapes because a literal one is
  // indistinguishable from a plain space when reading this file.
  ['\u00A0', ' '], // no-break space
  ['\u2002', ' '], // en space
  ['\u2003', ' '], // em space
  ['\u2007', ' '], // figure space
  ['\u2009', ' '], // thin space
  ['\u202F', ' '], // narrow no-break space
  ['…', '...'],
  ['⁄', '/'],
]);

export const normalizePunctuation = (value: string): string =>
  Array.from(value)
    .map((character) => PUNCTUATION_MAP.get(character) ?? character)
    .join('');

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00A0'], // decoded faithfully; folded to a plain space by normalizePunctuation
  ['deg', '°'],
  ['frac12', '½'],
  ['frac14', '¼'],
  ['frac34', '¾'],
  ['times', '×'],
  ['mdash', '-'],
  ['ndash', '-'],
  ['hellip', '...'],
  ['reg', '®'],
  ['trade', '™'],
  ['copy', '©'],
]);

/**
 * Decodes the entity set that actually appears in scraped specification tables.
 * A deliberately closed list: an unknown entity is left verbatim rather than
 * guessed at, so it surfaces as odd data instead of a wrong value.
 */
export const decodeHtmlEntities = (value: string): string =>
  value.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES.get(body) ?? match;
  });

export const CASE_MODES = ['lower', 'upper', 'title'] as const;
export type CaseMode = (typeof CASE_MODES)[number];

/** ASCII-deterministic casing. `title` capitalises each whitespace-delimited word. */
export function applyCase(value: string, mode: CaseMode): string {
  switch (mode) {
    case 'lower':
      return value.toLowerCase();
    case 'upper':
      return value.toUpperCase();
    case 'title':
      return value
        .split(/(\s+)/)
        .map((part) =>
          /\s/.test(part) || part.length === 0
            ? part
            : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase(),
        )
        .join('');
  }
}

export const stripCharacters = (value: string, characters: string): string => {
  const removable = new Set(Array.from(characters));
  return Array.from(value)
    .filter((character) => !removable.has(character))
    .join('');
};

/** Regex replace with the `g` flag forced off unless explicitly requested. */
export function replacePattern(
  value: string,
  pattern: string,
  replacement: string,
  flags = '',
): string {
  return value.replace(new RegExp(pattern, flags), replacement);
}

/**
 * The canonical "this means nothing" vocabulary. Sources spell absence a dozen
 * ways; all of them mean the field is empty, none of them mean the literal
 * string `"N/A"` is a value.
 */
const NULL_TOKENS: ReadonlySet<string> = new Set([
  '',
  '-',
  '--',
  '---',
  'n/a',
  'n.a.',
  'na',
  'none',
  'null',
  'nil',
  'unknown',
  'unspecified',
  'tbd',
  'not applicable',
  'not available',
]);

export const isNullToken = (value: string): boolean =>
  NULL_TOKENS.has(collapseWhitespace(value).toLowerCase());
