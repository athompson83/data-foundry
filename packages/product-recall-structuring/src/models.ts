/**
 * Model numbers named in recall text. Only tokens that follow an explicit
 * "model" anchor are taken ("model number 640-52XX", "Model #167",
 * "models FL-600, FL-650 and SL-650"), so lot codes, dates and quantities
 * elsewhere in the notice are not mistaken for models. Each list stops at a
 * word that starts another kind of code or a new clause (serial, lot, sold,
 * printed, …) or after several words with no model-like token.
 */

import { modelKey, uniqueSorted } from './text.js';

const ANCHOR = /\bmodels?\b(?:\s+(?:numbers?\b|nos?\b\.?|#))?\s*[:#]?\s*/gi;
const TOKEN = /[A-Za-z0-9][A-Za-z0-9\-./#]*[A-Za-z0-9]|[A-Za-z0-9]/g;
const STOP = new Set([
  'serial', 'serials', 'lot', 'lots', 'date', 'dates', 'code', 'codes', 'upc', 'upcs', 'sku', 'skus', 'item', 'batch',
  'sold', 'printed', 'located', 'found', 'manufactured', 'made', 'between', 'from', 'through', 'year', 'years',
  'imported', 'distributed', 'retail', 'retailed', 'stamped', 'molded', 'embossed', 'listed', 'produced', 'which', 'that',
]);
const MEASURE = /^\d+(?:\.\d+)?-?(?:cups?|inch(?:es)?|in|ft|foot|feet|oz|lbs?|mm|cm|m|v|volts?|w|watts?|amps?|a|packs?|pieces?|pcs?|gallons?|gal|quarts?|qt|l|ml|speed|pound|btu|hp|mah|wh|kw|piece)$/i;
const MAX_GAP = 4;
const UNIT_WORD = /^(?:watts?|volts?|amps?|amperes?|inch(?:es)?|feet|foot|ft|pounds?|lbs?|ounces?|oz|gallons?|quarts?|liters?|litres?|mm|cm|btus?|hp|mah|units?|pieces?|pairs?|sets?|percent|degrees?)$/i;

function isModelToken(token: string): boolean {
  if (!/\d/.test(token)) return false;
  if (MEASURE.test(token)) return false;
  if (/^\d{1,2}$/.test(token)) return false;
  if (/^(?:19|20)\d\d$/.test(token)) return false;
  if (/^\d{1,3}(?:,\d{3})+$/.test(token)) return false;
  if (/^\d{1,4}[/-]\d{1,2}[/-]\d{2,4}$/.test(token)) return false;
  return modelKey(token).length >= 3;
}

export interface ModelNumbers {
  /** Model numbers as printed, in first-seen order without duplicates by key. */
  readonly printed: string[];
  /** Normalised keys (A-Z0-9 only), sorted: the exact-lookup form. */
  readonly keys: string[];
}

export function extractModelNumbers(...texts: ReadonlyArray<string | null | undefined>): ModelNumbers {
  const printed: string[] = [];
  const seen = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    for (const anchor of text.matchAll(ANCHOR)) {
      const after = text.slice((anchor.index ?? 0) + anchor[0].length, (anchor.index ?? 0) + anchor[0].length + 600);
      // "model year 2021" and "Model Years 2019-2020" name a vintage, not a model.
      if (/^years?\b/i.test(after)) continue;
      const sentence = after.split(/\.\s+(?=[A-Z"“(])|[;\n]/)[0] ?? '';
      let gap = 0;
      for (const match of sentence.matchAll(TOKEN)) {
        const token = match[0].replace(/[.#/-]+$/, '');
        if (STOP.has(token.toLowerCase())) break;
        // "rated at 1875 watts": a number followed by a unit is a measurement, not a model.
        const nextWord = /^\s+([A-Za-z]+)/.exec(sentence.slice((match.index ?? 0) + match[0].length))?.[1] ?? '';
        if (/^\d+(?:\.\d+)?$/.test(token) && UNIT_WORD.test(nextWord)) {
          if (++gap > MAX_GAP) break;
          continue;
        }
        if (isModelToken(token)) {
          gap = 0;
          const key = modelKey(token);
          if (!seen.has(key)) {
            seen.add(key);
            printed.push(token);
          }
        } else if (++gap > MAX_GAP) break;
      }
    }
  }
  return { printed, keys: uniqueSorted(seen) };
}

/**
 * Model numbers from fields that are models by structure (CPSC `Products[].Model`):
 * the field itself is the anchor, so its model-like tokens are taken without a
 * "model" label in the value. Merged with the prose extraction, keyed alike.
 */
export function extractModelNumbersWithFields(texts: ReadonlyArray<string | null | undefined>, fields: ReadonlyArray<string | null | undefined>): ModelNumbers {
  return extractModelNumbers(...texts, ...fields.map((value) => (value && value.trim() ? `model ${value}` : null)));
}
