import type { LocatorType } from '@data-foundry/canonical-schema';

/**
 * Where inside an artifact a value was observed.
 *
 * This is the whole reason extraction exists as its own stage. AGENTS.md rule 2
 * ("no published fact without evidence") is only enforceable if every value we
 * pull off an artifact remembers *where* it came from, precisely enough that the
 * provenance layer can re-resolve it against the stored bytes later. An
 * extractor that returns a value without a locator has thrown the evidence away
 * and is a rule-2 bug, not a style problem.
 *
 * The pair mirrors `fact_evidence.locator_type` / `fact_evidence.locator_value`
 * in `@data-foundry/canonical-schema` exactly, so a locator can be attached to
 * evidence without translation.
 */
export interface EvidenceLocator {
  readonly type: LocatorType;
  readonly value: string;
}

/**
 * Structured locator values use a `key=value;key=value` grammar rather than free
 * text so `page`, `row`, `column` and friends survive a round trip. `%`, `;` and
 * `=` are percent-encoded inside parts.
 */
const encodeLocatorPart = (raw: string): string =>
  raw.replace(/[%;=]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);

const decodeLocatorPart = (raw: string): string =>
  raw.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));

export const formatLocatorValue = (
  parts: ReadonlyArray<readonly [string, string | number]>,
): string => parts.map(([key, value]) => `${key}=${encodeLocatorPart(String(value))}`).join(';');

export const parseLocatorValue = (value: string): Record<string, string> => {
  const parsed: Record<string, string> = {};
  if (value.length === 0) return parsed;
  for (const chunk of value.split(';')) {
    const separator = chunk.indexOf('=');
    if (separator < 0) continue;
    parsed[chunk.slice(0, separator)] = decodeLocatorPart(chunk.slice(separator + 1));
  }
  return parsed;
};

export const wholeDocumentLocator = (): EvidenceLocator => ({ type: 'WHOLE_DOCUMENT', value: '' });

export const jsonPointerLocator = (pointer: string): EvidenceLocator => ({
  type: 'JSON_POINTER',
  value: pointer,
});

export const cssSelectorLocator = (selector: string): EvidenceLocator => ({
  type: 'CSS_SELECTOR',
  value: selector,
});

/** `row` is the 1-based physical line in the file; `column` is the header name. */
export const tableCellLocator = (row: number, column: string, columnIndex: number): EvidenceLocator => ({
  type: 'TABLE_CELL',
  value: formatLocatorValue([
    ['row', row],
    ['column', column],
    ['index', columnIndex],
  ]),
});

export const lineRangeLocator = (start: number, end: number): EvidenceLocator => ({
  type: 'LINE_RANGE',
  value: formatLocatorValue([
    ['start', start],
    ['end', end],
  ]),
});

export interface PageLocatorOptions {
  /** 1-based line index within the page's extracted text layer. */
  readonly line?: number;
  /** `[x0, y0, x1, y1]` in PDF user space, when the provider can supply it. */
  readonly bbox?: readonly [number, number, number, number];
}

export const pageLocator = (page: number, options: PageLocatorOptions = {}): EvidenceLocator => {
  const parts: Array<readonly [string, string | number]> = [['page', page]];
  if (options.line !== undefined) parts.push(['line', options.line]);
  if (options.bbox !== undefined) parts.push(['bbox', options.bbox.join(',')]);
  return { type: 'PAGE', value: formatLocatorValue(parts) };
};

export const regexMatchLocator = (
  pattern: string,
  matchIndex: number,
  scope?: EvidenceLocator,
): EvidenceLocator => ({
  type: 'REGEX_MATCH',
  value: formatLocatorValue([
    ['pattern', pattern],
    ['match', matchIndex],
    ...(scope ? ([['scope', `${scope.type}:${scope.value}`]] as const) : []),
  ]),
});

/** A locator is only useful if it actually points somewhere. */
export const isResolvableLocator = (locator: EvidenceLocator): boolean =>
  locator.type === 'WHOLE_DOCUMENT' ? true : locator.value.length > 0;

// ---------------------------------------------------------------------------
// RFC 6901 JSON pointers
// ---------------------------------------------------------------------------

export const escapeJsonPointerToken = (token: string): string =>
  token.replace(/~/g, '~0').replace(/\//g, '~1');

export const unescapeJsonPointerToken = (token: string): string =>
  token.replace(/~1/g, '/').replace(/~0/g, '~');

export const joinJsonPointer = (base: string, ...tokens: ReadonlyArray<string | number>): string => {
  const suffix = tokens.map((token) => `/${escapeJsonPointerToken(String(token))}`).join('');
  return base === '' ? suffix : `${base}${suffix}`;
};

export const parseJsonPointer = (pointer: string): string[] => {
  if (pointer === '') return [];
  if (!pointer.startsWith('/')) {
    throw new Error(`JSON pointer must be empty or start with "/": ${JSON.stringify(pointer)}`);
  }
  return pointer.slice(1).split('/').map(unescapeJsonPointerToken);
};

export interface JsonPointerResolution {
  readonly found: boolean;
  readonly value: unknown;
}

export const resolveJsonPointer = (document: unknown, pointer: string): JsonPointerResolution => {
  let current: unknown = document;
  for (const token of parseJsonPointer(pointer)) {
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { found: false, value: undefined };
      }
      current = current[index];
      continue;
    }
    if (current !== null && typeof current === 'object' && token in (current as object)) {
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return { found: false, value: undefined };
  }
  return { found: true, value: current };
};
