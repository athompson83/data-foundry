/**
 * Text helpers shared by the CPSC and Health Canada parsers: HTML entity and
 * whitespace clean-up, model-number normalisation and separator-aware barcode
 * tokenisation.
 */

import { gs1CheckDigitValid } from '@data-foundry/recall-structuring';

const ENTITIES: Readonly<Record<string, string>> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', trade: '™', reg: '®' };

/** Decode common HTML entities, drop tags and collapse whitespace. */
export function cleanText(value: string | null | undefined): string {
  if (!value) return '';
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Deterministic model key: accents folded, upper case, only A-Z and 0-9 kept. */
export function modelKey(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Barcode-like digit runs in a field that may list several codes. The field is
 * split on separators first, then a code printed in groups ("5 012345 678900")
 * is rejoined; deleting every space first would fuse adjacent codes.
 */
export function digitCodes(value: string | null | undefined): string[] {
  const out: string[] = [];
  for (const token of (value ?? '').split(/[,;/|\n]+|\s{2,}|\s(?=\d{8,14}(?!\d))/)) {
    const joined = token.replace(/(?<=\d)[ -](?=\d)/g, '');
    for (const match of joined.matchAll(/(?<!\d)\d{8,14}(?!\d)/g)) out.push(match[0]);
  }
  return out;
}

/** A UPC-A, EAN-13 or GTIN-14 with a valid GS1 check digit, as a 14-digit GTIN; otherwise null. */
export function gtin14(code: string): string | null {
  if (!/^\d{12,14}$/.test(code) || !gs1CheckDigitValid(code)) return null;
  return code.padStart(14, '0');
}

export function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}
