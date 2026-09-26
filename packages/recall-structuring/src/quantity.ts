/**
 * `product_quantity` prose: "53 boxes", "403,200 tablets", "33850 units/kits",
 * "a) 1,200 cases; b) 300 cases", "N/A". Every amount is kept as an item; a
 * single total is claimed only when the text states exactly one amount.
 */

export interface QuantityItem {
  readonly value: number;
  readonly unit: string | null;
}

export interface ProductQuantity {
  readonly items: readonly QuantityItem[];
  /** The amount when the text states exactly one; otherwise null. */
  readonly total: number | null;
  readonly unit: string | null;
}

const UNIT_ALIASES: Readonly<Record<string, string>> = {
  lb: 'pounds', lbs: 'pounds', pound: 'pounds', pounds: 'pounds',
  kg: 'kilograms', kgs: 'kilograms', kilogram: 'kilograms', kilograms: 'kilograms',
  oz: 'ounces', ounce: 'ounces', ounces: 'ounces',
  unit: 'units', units: 'units', each: 'units', ea: 'units', pieces: 'units', piece: 'units', pcs: 'units',
  case: 'cases', cases: 'cases', cs: 'cases',
  box: 'boxes', boxes: 'boxes', carton: 'cartons', cartons: 'cartons',
  bottle: 'bottles', bottles: 'bottles', btls: 'bottles', vial: 'vials', vials: 'vials',
  bag: 'bags', bags: 'bags', jar: 'jars', jars: 'jars', can: 'cans', cans: 'cans',
  package: 'packages', packages: 'packages', packs: 'packages', pack: 'packages', pkgs: 'packages',
  tablet: 'tablets', tablets: 'tablets', capsule: 'capsules', capsules: 'capsules',
  kit: 'kits', kits: 'kits', device: 'devices', devices: 'devices',
  tray: 'trays', trays: 'trays', syringe: 'syringes', syringes: 'syringes',
  tube: 'tubes', tubes: 'tubes', pouch: 'pouches', pouches: 'pouches',
  container: 'containers', containers: 'containers', tub: 'tubs', tubs: 'tubs',
  gallon: 'gallons', gallons: 'gallons', gal: 'gallons', liter: 'liters', liters: 'liters',
  pallet: 'pallets', pallets: 'pallets', dozen: 'dozen', lot: 'lots', lots: 'lots',
  bar: 'bars', bars: 'bars', ampule: 'ampules', ampules: 'ampules', ampoules: 'ampules',
  bundle: 'bundles', bundles: 'bundles', sets: 'sets', set: 'sets', systems: 'systems', system: 'systems',
};

function normaliseUnit(word: string | undefined): string | null {
  if (!word) return null;
  const head = word.toLowerCase().split(/[/-]/)[0] ?? '';
  return UNIT_ALIASES[head.replace(/\.$/, '')] ?? head.replace(/\.$/, '') ?? null;
}

export function parseQuantity(text: string | null | undefined): ProductQuantity {
  const raw = (text ?? '').trim();
  const items: QuantityItem[] = [];
  // Numbers with thousands separators or decimals, optionally followed by a unit word.
  const pattern = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?:\s*(?:total\s+)?([A-Za-z][A-Za-z./-]{0,24}))?/g;
  for (const match of raw.matchAll(pattern)) {
    const value = Number((match[1] as string).replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const unitWord = match[2];
    // Skip sizes and weights that describe the package, e.g. "12 oz" inside
    // "1,200 cases of 12 oz jars", when a leading count already exists.
    const unit = normaliseUnit(unitWord);
    if (items.length > 0 && (unit === 'ounces' || unit === 'grams' || unit === 'ml' || unit === 'count' || unit === 'ct' || unit === 'lots')) continue;
    if (unitWord && /^(?:x|of|per|mg|mcg|ml|g|gm|fl|in|cm|mm)$/i.test(unitWord) && items.length > 0) continue;
    items.push({ value, unit });
    if (items.length >= 50) break;
  }
  // Multiple amounts may be a breakdown ("a) 100 cases b) 200 cases") or a
  // restatement ("3,618 units total; 2,000 in the U.S."). Prose cannot tell
  // them apart reliably, so a total is claimed only for a single amount.
  const only = items.length === 1 ? items[0] : undefined;
  return { items, total: only?.value ?? null, unit: only?.unit ?? null };
}
