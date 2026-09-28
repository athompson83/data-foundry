/**
 * Cross-agency references. A CPSC notice that cites a Health Canada recall
 * URL names that exact notice: a declared link. Health Canada's "Joint recall
 * with … CPSC" note only says a counterpart exists, so it is candidate
 * evidence and never links by itself (AGENTS.md rules 3 and 7).
 */

import type { CounterpartAgency, CrossReference } from './types.js';

/** Canonical form of a Health Canada recall URL, or null when the URL is not one. */
export function canonicalHcUrl(url: string): string | null {
  const match = /^(?:https?:\/\/)?(?:www\.)?recalls-rappels\.canada\.ca\/(en\/alert-recall|fr\/avis-rappel)\/([^?#\s]+?)\/?(?:[?#].*)?$/i.exec(url.trim());
  if (!match) return null;
  return `https://recalls-rappels.canada.ca/${(match[1] as string).toLowerCase()}/${(match[2] as string).toLowerCase()}`;
}

export function crossReference(url: string): CrossReference | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const hc = canonicalHcUrl(trimmed);
  if (hc) return { agency: 'HC', url: hc };
  const clean = trimmed.replace(/^http:\/\//i, 'https://').replace(/\/+$/, '');
  let agency: CounterpartAgency = 'OTHER';
  if (/healthycanadians\.gc\.ca|hc-sc\.gc\.ca/i.test(clean)) agency = 'HC-LEGACY';
  else if (/recalls-rappels\.canada\.ca/i.test(clean)) return null; // the site root or a search page names no notice
  else if (/tc\.gc\.ca|tc\.canada\.ca/i.test(clean)) agency = 'TC';
  else if (/profeco|gob\.mx/i.test(clean)) agency = 'PROFECO';
  else if (/productsafety\.gov\.au|accc\.gov\.au/i.test(clean)) agency = 'ACCC';
  else if (/cpsc\.gov/i.test(clean)) agency = 'CPSC';
  return { agency, url: clean };
}

const JOINT_AGENCIES: ReadonlyArray<readonly [CounterpartAgency, RegExp]> = [
  ['CPSC', /Consumer Product Safety Commission|\bCPSC\b/],
  ['PROFECO', /PROFECO|Procuradur[ií]a Federal del Consumidor/i],
  ['ACCC', /Australian Competition and Consumer Commission|\bACCC\b/],
];

/** Agencies named in a "Joint recall with …" sentence. */
export function jointAgencies(text: string): CounterpartAgency[] {
  // The sentence can contain abbreviations ("U.S."), so it runs to Health Canada's next boilerplate sentence instead of the first period.
  const start = /joint recall with/i.exec(text);
  if (!start) return [];
  const sentence = text.slice(start.index, start.index + 400).split(/Please note|Health Canada would|This recall is also|For more information/i)[0] ?? '';
  return JOINT_AGENCIES.filter(([, rule]) => rule.test(sentence)).map(([name]) => name);
}
