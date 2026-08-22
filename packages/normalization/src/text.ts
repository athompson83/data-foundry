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

/**
 * Invisible characters no script needs, removed everywhere — including from the
 * value that gets stored.
 *
 * These are artefacts of how text travelled, not of what it says. A
 * PDF-to-HTML converter leaves a soft hyphen wherever it broke a line. A CMS
 * that once justified text leaves zero-width spaces. A file that came through
 * Windows carries a byte-order mark on its first field. None of them render,
 * so nobody reviewing the source sees anything wrong, and every one of them
 * makes two strings a reader would call identical compare unequal.
 *
 * `\s` in JavaScript already covers the byte-order mark, which is why some of
 * this worked by accident; the rest of the list it does not touch.
 */
const INVISIBLE_DEBRIS: ReadonlySet<string> = new Set([
  '\u00AD', // soft hyphen
  '\u200B', // zero-width space
  '\uFEFF', // zero-width no-break space / byte-order mark
]);

/**
 * Invisible characters a person may have put there on purpose, removed only
 * when matching.
 *
 * The zero-width joiner and non-joiner change what a word says in Indic and
 * Arabic text; the directional marks and isolates are what make
 * mixed-direction text render in the right order; the word joiner says do not
 * break the line here. In a Latin-script model number they are all scraping
 * debris. In a product name, a person's name, or any value from a vertical
 * this platform has not onboarded yet, removing them is silent corruption.
 *
 * The first version of this file put them in one list with the debris and
 * removed all of it from stored values, on the reasoning that nothing in an
 * HVAC specification table is Devanagari. Documenting that cost is not the
 * same as it being safe: a closed list limits accidental growth, it does not
 * make global stored-value data loss acceptable. Review was right to press it.
 *
 * The word joiner arrived here second, and by the same argument. It was in the
 * debris set because it changes layout rather than meaning — which was the
 * wrong test. The bar for rewriting a STORED value is not "does this change
 * what the word says", it is "might somebody have meant it", and accepting
 * that for the joiners while refusing it here would not have been defensible.
 *
 * So they are stripped in `comparisonKey` and nowhere else. Matching becomes
 * insensitive to them; storage keeps what the source sent. Those are different
 * questions and they now get different answers.
 */
const AUTHORED_CONTROLS: ReadonlySet<string> = new Set([
  '\u200C', // zero-width non-joiner
  '\u200D', // zero-width joiner
  '\u200E', // left-to-right mark
  '\u200F', // right-to-left mark
  '\u2066', // left-to-right isolate
  '\u2067', // right-to-left isolate
  '\u2068', // first strong isolate
  '\u2069', // pop directional isolate
  '\u2060', // word joiner — layout rather than script, but still authored
]);

const without = (value: string, removable: ReadonlySet<string>): string =>
  Array.from(value)
    .filter((character) => !removable.has(character))
    .join('');

/** Safe for a stored value: transport artefacts only. */
export const stripInvisibleDebris = (value: string): string => without(value, INVISIBLE_DEBRIS);

/**
 * Debris AND anything a person may have authored. Correct for a matching key,
 * wrong for anything that will be written back — see `AUTHORED_CONTROLS`.
 */
export const stripFormatCharacters = (value: string): string =>
  without(without(value, INVISIBLE_DEBRIS), AUTHORED_CONTROLS);

export const normalizePunctuation = (value: string): string =>
  Array.from(value)
    .map((character) => PUNCTUATION_MAP.get(character) ?? character)
    .join('');

/**
 * The fold every comparison in this package applies before matching anything.
 *
 * It existed already, written out by hand in the boolean vocabulary, the unit
 * index and `vocabularyKey` — and a fourth time in `isNullToken` with one step
 * missing, which is exactly the failure mode duplicated code has. The missing
 * step meant a full-width or en-dashed spelling of absence was not recognised
 * as absence, and `isNullToken` is not one comparison among many: it is the
 * gate that decides whether a source field means anything at all. A `"N/A"` it
 * fails to see does not become a missing value, it becomes the published
 * string `"N/A"`, asserted as a fact about a real product.
 *
 * Naming it once removes the possibility of a fifth caller getting it wrong,
 * and of the next widening reaching three of the four places.
 *
 * This fold is never applied to a stored value — it exists to decide whether
 * two strings mean the same thing, and it lowercases, which would be a lie
 * about what a source said. That is a separate question from what layer-1
 * primitive cleanup does, which DOES alter the stored value and is
 * deliberately narrower for it: cleanup removes only `INVISIBLE_DEBRIS`, this
 * fold also removes `AUTHORED_CONTROLS`. Only `display` on a normalized
 * identifier is the untouched original.
 *
 * It decodes entities, and it has to. `normalizeProperty` and
 * `normalizeIdentifierRule` both ask `isNullToken(source.raw)` — the raw source
 * string, before layer-1 cleanup has decoded anything — so a fold that did not
 * decode recognised absence only in whichever spelling a scraper happened to
 * have already resolved.
 *
 * For the three callers that receive an ALREADY-cleaned value this is normally
 * a no-op, because cleanup has already decoded. Not always, and the exception
 * is worth naming rather than claiming idempotence it does not have: a
 * double-encoded `&amp;shy;` survives cleanup's single decode as `&shy;`, and
 * this fold then decodes it a second time. The stored value is unaffected —
 * cleanup decodes once — so the consequence is confined to a matching key
 * over-normalizing an input that would have to be encoded twice to occur.
 */
export const comparisonKey = (value: string): string =>
  collapseWhitespace(
    normalizePunctuation(stripFormatCharacters(decodeHtmlEntities(normalizeUnicode(value)))),
  ).toLowerCase();

const NAMED_ENTITIES: ReadonlyMap<string, string> = new Map([
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['nbsp', '\u00A0'], // decoded faithfully; folded to a plain space by normalizePunctuation
  // The invisible ones. `&shy;` is how a PDF-to-HTML converter writes the soft
  // hyphen it left at a line break, and it was missing here entirely — so
  // `N/A&shy;` survived layer-1 cleanup as the literal text `N/A&shy;` and was
  // published, entity and all, as a value on a spec sheet. Decoded faithfully
  // to the character; what happens to the character afterwards is
  // `stripInvisibleDebris`'s decision, not the decoder's.
  ['shy', '\u00AD'],
  ['zwnj', '\u200C'],
  ['zwj', '\u200D'],
  ['lrm', '\u200E'],
  ['rlm', '\u200F'],
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

export const isNullToken = (value: string): boolean => NULL_TOKENS.has(comparisonKey(value));
