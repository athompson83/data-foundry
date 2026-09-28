/**
 * One classification for notices from every agency: hazard classes, remedy
 * classes and trade facets. Each class is a deterministic keyword rule over
 * named source fields, so a class can always be explained by the text that
 * produced it.
 */

export const HAZARD_CLASSES = [
  'fire',
  'burn',
  'electric-shock',
  'carbon-monoxide',
  'explosion',
  'laceration',
  'fall',
  'tip-over',
  'entrapment',
  'strangulation',
  'suffocation',
  'choking',
  'ingestion',
  'drowning',
  'chemical',
  'lead',
  'microbial',
  'crash',
  'impact-injury',
  'injury',
  'non-compliance',
] as const;
export type HazardClass = (typeof HAZARD_CLASSES)[number];

const HAZARD_RULES: ReadonlyArray<readonly [HazardClass, RegExp]> = [
  ['fire', /\bfires?\b|flammab|ignit|flame|combust/i],
  ['burn', /\bburns?\b|scald|overheat/i],
  ['electric-shock', /shock|electrocut|electrical hazard/i],
  ['carbon-monoxide', /carbon monoxide|\bCO poisoning/i],
  ['explosion', /explo|burst|ruptur/i],
  ['laceration', /lacerat|\bcuts?\b|sharp (?:edge|point)|puncture/i],
  ['fall', /\bfalls?\b|falling/i],
  ['tip-over', /tip[- ]?over|tipping/i],
  ['entrapment', /entrap|pinch|crush/i],
  ['strangulation', /strangul|entangle/i],
  ['suffocation', /suffocat|asphyxia/i],
  ['choking', /chok/i],
  ['ingestion', /ingest|swallow|button batter|magnet/i],
  ['drowning', /drown/i],
  ['chemical', /chemical|poison|toxic|methanol|benzene|formaldehyde|phthalate|cadmium|mercury|asbestos|child[- ]resistant|\bPPPA\b/i],
  ['lead', /\blead\b(?! to\b| time\b)/i],
  ['microbial', /microb|bacteri|mold|fung|legionella|pseudomonas|burkholderia/i],
  ['crash', /\bcrash|loss of control|lose control/i],
  ['impact-injury', /head injur|\bimpact|struck by|blunt/i],
  ['injury', /physical hazard|injury hazard|risk of (?:serious )?injur/i],
  ['non-compliance', /violat|fails? to (?:meet|comply)|mandatory (?:safety )?standard|labell?ing|non-?complian/i],
];

export function classifyHazards(...texts: ReadonlyArray<string | null | undefined>): HazardClass[] {
  const text = texts.filter(Boolean).join(' \n ');
  return HAZARD_RULES.filter(([, rule]) => rule.test(text)).map(([name]) => name);
}

export const REMEDY_CLASSES = ['refund', 'repair', 'replace', 'new-instructions', 'dispose', 'label', 'inspect', 'firmware-update', 'stop-use', 'no-remedy'] as const;
export type RemedyClass = (typeof REMEDY_CLASSES)[number];

const REMEDY_RULES: ReadonlyArray<readonly [RemedyClass, RegExp]> = [
  ['refund', /refund|reimburse|money back/i],
  ['repair', /repair|retrofit|fix kit|modification kit|free (?:kit|part)/i],
  ['replace', /replac/i],
  ['new-instructions', /new (?:\w+ )?instructions|revised instructions|updated instructions|warning (?:label|sticker)/i],
  ['dispose', /dispos|destroy|discard|throw (?:it|them) away/i],
  ['label', /^label$|new label/i],
  ['inspect', /inspect/i],
  ['firmware-update', /firmware|software update|update the (?:product|app)/i],
  ['stop-use', /stop using|immediately stop|discontinue use/i],
  ['no-remedy', /no remedy/i],
];

export function classifyRemedies(...texts: ReadonlyArray<string | null | undefined>): RemedyClass[] {
  const found = new Set<RemedyClass>();
  for (const text of texts) {
    if (!text) continue;
    for (const [name, rule] of REMEDY_RULES) if (rule.test(text)) found.add(name);
  }
  return REMEDY_CLASSES.filter((name) => found.has(name));
}

export const TRADE_FACETS = ['appliance', 'hvac', 'plumbing-water-heating', 'electrical', 'building-products'] as const;
export type TradeFacet = (typeof TRADE_FACETS)[number];

// The keyword sets are the round-3 research rules (evidence/2026-09-27-composites/recalls/cpsc_home.py), ported verbatim.
const APPLIANCE_TYPES = new Set([
  'Gas Ranges (With Ovens)', 'Stand Alone Freezers', 'Gas Clothes Dryers', 'Dryers', 'Ovens/Stoves/Ranges/Microwaves', 'Refrigerators', 'Dishwashers',
  'Washing Machines', 'Clothes Dryers', 'Dehumidifiers', 'Ranges and Ovens', 'Microwave Ovens', 'Freezers', 'Ice Makers', 'Clothes Washers',
  'Clothes Dryers or Washers', 'Cooktops', 'Trash Compactors', 'Garbage Disposers', 'Refrigerators or Freezers', 'Range Hoods', 'Dryers (Clothes)', 'Stoves', 'Wall Ovens',
]);
const APPLIANCE = /\b(refrigerators?|fridges?|freezers?|dishwashers?|(?:clothes |electric |gas )?dryers?|washing machines?|(?:clothes |front[- ]load(?:ing)? |top[- ]load(?:ing)? )washers?|washers? and dryers?|ranges?|cooktops?|wall ovens?|built-in ovens?|over[- ]the[- ]range|microwave(?: oven)?s?|dehumidifiers?|room air conditioners?|window air conditioners?|portable air conditioners?|ice makers?|trash compactors?|garbage disposers?|range hoods?|wine (?:coolers?|refrigerators?)|beverage (?:coolers?|refrigerators?)|gas stoves?|electric stoves?|through[- ]the[- ]wall air conditioners?|PTACs?)\b/i;
const NOT_APPLIANCE = /\b(hair dryers?|hand dryers?|pressure washers?|dryer vent brush|toys?|children|kids|salad spinner|lint|toasters?|crisper|pans?|portable gas stoves?|camp\w*|grills?|oven mitts?|potholders?|dryer sheets?|driving range|range ?finders?|free[- ]range|mountain range|gel packs?|lunch\w*|popcorn|coolers? bags?)\b/i;
const HVAC = /\b(furnaces?|heat pumps?|air handlers?|central air|condensing units?|mini[- ]splits?|ductless|thermostats?|boilers?|baseboard heaters?|wall heaters?|space heaters?|heaters?|ventilat\w+|bath(?:room)? fans?|exhaust fans?|humidifiers?|air purifiers?|air cleaners?|evaporative coolers?|HVAC|packaged terminal)\b/i;
const NOT_HVAC = /hair|hand warmer|bottle|heated (?:vest|jacket|glove|blanket)|seat heater|warmer/i;
const PLUMBING = /\b(water heaters?|tankless|faucets?|toilets?|shower ?heads?|bidet|garbage disposals?|sump pumps?|well pumps?|water softeners?|water filters?|water filtration|reverse osmosis|plumbing|backflow|expansion tanks?|boilers?|pex|supply lines?|water dispensers?|shut-?off valves?|pressure relief|gas valves?|hot water dispensers?)\b/i;
const ELECTRICAL = /circuit breaker|\bbreakers?\b|GFCI|AFCI|ground[- ]fault|arc[- ]fault|receptacle|outlet|extension cord|power strip|surge protect|load cent|electrical panel|panelboard|wiring device|light switch|dimmer|\bEV charg|electric vehicle charg|EVSE|ceiling fan|light fixture|luminaire|LED (?:light|lamp|bulb|fixture)|smoke alarm|carbon monoxide alarm|CO alarm|generator|inverter|power station|transfer switch|junction box|electrical cord|power cord/i;
const ELECTRICAL_HAZARD = /shock|electrocut|fire|burn|overheat|arc/i;
const BUILDING = /\b(windows?|doors?|garage door|door openers?|skylights?|stair|railings?|decking|drywall|insulation|roofing|shingles?|flooring|ladders?|fire extinguishers?|smoke alarms?|carbon monoxide (?:alarms?|detectors?)|fireplaces?|chimney|wood stoves?|pellet stoves?|gas logs?)\b/i;
const NOT_BUILDING = /\bdoll|toy|window (?:blind|covering|shade)s?|window air|window-mounted|cabinet door/i;

/**
 * Trade facets for a notice. `title` is the notice title plus product names,
 * `types` the agency product types, `hazardText` the hazard statement and
 * description (the electrical facet needs an electrical hazard as well as an
 * electrical product).
 */
export function tradeFacets(title: string, types: readonly string[], hazardText: string): TradeFacet[] {
  const facets: TradeFacet[] = [];
  const titleForAppliance = title.replace(/Viking Range|Range Corp/g, '');
  if ((types.some((type) => APPLIANCE_TYPES.has(type)) || APPLIANCE.test(titleForAppliance)) && !NOT_APPLIANCE.test(titleForAppliance)) facets.push('appliance');
  if (HVAC.test(title) && !NOT_APPLIANCE.test(title) && !NOT_HVAC.test(title)) facets.push('hvac');
  if (PLUMBING.test(title)) facets.push('plumbing-water-heating');
  if (ELECTRICAL.test(title) && ELECTRICAL_HAZARD.test(hazardText)) facets.push('electrical');
  if (BUILDING.test(title) && !NOT_APPLIANCE.test(title) && !NOT_BUILDING.test(title)) facets.push('building-products');
  return facets;
}
