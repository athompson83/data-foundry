/**
 * Recall-reason classes from `reason_for_recall` prose. Rules are keyword
 * patterns with fixed class names; nothing is inferred by a model, so a class
 * can always be explained by the phrase that produced it.
 */

export const REASON_CLASSES = [
  'UNDECLARED_ALLERGEN',
  'MICROBIAL_CONTAMINATION',
  'FOREIGN_MATERIAL',
  'CHEMICAL_CONTAMINATION',
  'LABELING',
  'POTENCY',
  'STERILITY',
  'CGMP',
  'SPECIFICATION_FAILURE',
  'PACKAGING',
  'TEMPERATURE_CONTROL',
  'DEVICE_MALFUNCTION',
  'SOFTWARE',
  'UNAPPROVED_PRODUCT',
] as const;

export type ReasonClass = (typeof REASON_CLASSES)[number];

/** The nine major food allergens under FALCPA as amended by the FASTER Act. */
export const ALLERGENS = ['milk', 'egg', 'fish', 'crustacean_shellfish', 'tree_nuts', 'peanut', 'wheat', 'soy', 'sesame'] as const;
export type Allergen = (typeof ALLERGENS)[number];

export const PATHOGENS = [
  'listeria_monocytogenes', 'salmonella', 'e_coli', 'clostridium_botulinum', 'cronobacter',
  'hepatitis_a', 'norovirus', 'cyclospora', 'bacillus_cereus', 'staphylococcus', 'burkholderia',
  'pseudomonas', 'mold', 'yeast',
] as const;
export type Pathogen = (typeof PATHOGENS)[number];

export interface RecallReason {
  readonly classes: readonly ReasonClass[];
  readonly allergens: readonly Allergen[];
  readonly pathogens: readonly Pathogen[];
}

const CLASS_RULES: ReadonlyArray<readonly [ReasonClass, RegExp]> = [
  ['UNDECLARED_ALLERGEN', /\bundeclared\b|\ballergen|\bnot\s+declared\b|\bfailed\s+to\s+declare\b|\bnot\s+listed\s+on\s+the\s+label\b/i],
  ['MICROBIAL_CONTAMINATION', /\blisteria\b|\bsalmonella\b|\be\.?\s?coli\b|\bstec\b|\bbotulinum\b|\bbotulism\b|\bcronobacter\b|\bhepatitis\s+a\b|\bnorovirus\b|\bcyclospora\b|\bbacteri(?:a|al)\b|\bmicrobi|\bmold\b|\bmould\b|\byeast\b|\bfung(?:al|us|i)\b|\bpathogen/i],
  ['FOREIGN_MATERIAL', /\bforeign\s+(?:material|matter|object|body)|\bmetal\s+(?:fragment|piece|shaving)|\bglass\b|\bplastic\s+(?:fragment|piece)|\brubber\s+(?:fragment|piece)|\bwood(?:en)?\s+(?:fragment|piece)|\bextraneous\b|\bstone|\binsect/i],
  ['CHEMICAL_CONTAMINATION', /\bnitrosamine|\bndma\b|\bndea\b|\bbenzene\b|\b(?:elevated|high|excessive|unsafe)\s+(?:levels?\s+of\s+)?lead\b|\blead\s+(?:content|levels?|contamination|poisoning)\b|\barsenic\b|\bcadmium\b|\bmercury\b|\bpesticide|\bchemical\b|\bsulfite|\bmelamine|\bethylene\s+(?:oxide|glycol)|\bdiethylene\s+glycol|\bmethanol\b|\bheavy\s+metal/i],
  ['LABELING', /\blabel(?:ing|ed|s)?\b|\bmislabel|\bmisbrand|\bincorrect\s+(?:expir|lot|strength)|\bwrong\s+(?:label|strength|product)/i],
  ['POTENCY', /\bsub-?potent|\bsuper-?potent|\bpotency\b|\bassay\b|\bstrength\b/i],
  ['STERILITY', /\bsterility|\bsterile\b|\bnon-?sterile|\bendotoxin|\bpyrogen/i],
  ['CGMP', /\bcgmp\b|\bgood\s+manufacturing\s+practice|\bgmp\b/i],
  ['SPECIFICATION_FAILURE', /\bout\s+of\s+specification|\boos\b|\bfailed\s+(?:dissolution|impurit|specification|stability)|\bdissolution\b|\bimpurit|\bdegradat|\bstability\b|\bparticulate/i],
  ['PACKAGING', /\bpackag(?:e|ing)\s+(?:defect|failure|integrity)|\bseal\b|\bleak|\bcrack|\bdefective\s+container|\bchild[\s-]resistant/i],
  ['TEMPERATURE_CONTROL', /\btemperature\s+(?:abuse|excursion|control)|\bnot\s+(?:properly\s+)?refrigerated|\bthaw|\bunderprocess|\bunder-?processed|\bimproperly\s+(?:processed|pasteurized)/i],
  ['DEVICE_MALFUNCTION', /\bmalfunction|\bfailure\s+to\s+(?:deliver|operate|function|alarm)|\bmay\s+(?:fail|break|fracture|detach)|\bfracture|\bdetach|\bbreak(?:age)?\b|\bocclusion|\bshort\s+circuit|\boverheat/i],
  ['SOFTWARE', /\bsoftware\b|\bfirmware\b|\balgorithm\b|\bcybersecurity\b/i],
  ['UNAPPROVED_PRODUCT', /\bunapproved\b|\bwithout\s+(?:an?\s+)?(?:approved|cleared)|\bnot\s+(?:approved|cleared)|\bno\s+(?:approved|510\(k\))|\bhidden\s+(?:drug|ingredient)|\bundeclared\s+(?:drug|sildenafil|tadalafil|sibutramine)/i],
];

const ALLERGEN_RULES: ReadonlyArray<readonly [Allergen, RegExp]> = [
  ['milk', /\bmilk\b|\bdairy\b|\bwhey\b|\bcasein|\blactose\b|\bbutter\b|\bcheese\b|\bcream\b/i],
  ['egg', /\beggs?\b/i],
  ['fish', /\bfish\b|\banchov|\bcod\b|\bsalmon\b|\btuna\b|\btilapia\b|\bpollock\b/i],
  ['crustacean_shellfish', /\bshellfish\b|\bshrimp\b|\bcrab\b|\blobster\b|\bcrustacean|\bcrawfish\b|\bprawn/i],
  ['tree_nuts', /\btree\s+nuts?\b|\balmond|\bwalnut|\bpecan|\bcashew|\bpistachio|\bhazelnut|\bmacadamia|\bbrazil\s+nut|\bpine\s+nut|\bcoconut\b/i],
  ['peanut', /\bpeanut/i],
  ['wheat', /\bwheat\b|\bgluten\b/i],
  ['soy', /\bsoy|\bsoya\b/i],
  ['sesame', /\bsesame\b/i],
];

const PATHOGEN_RULES: ReadonlyArray<readonly [Pathogen, RegExp]> = [
  ['listeria_monocytogenes', /\blisteria\b/i],
  ['salmonella', /\bsalmonella\b/i],
  ['e_coli', /\be\.?\s?coli\b|\bstec\b|\bo157/i],
  ['clostridium_botulinum', /\bbotulinum\b|\bbotulism\b/i],
  ['cronobacter', /\bcronobacter\b/i],
  ['hepatitis_a', /\bhepatitis\s+a\b/i],
  ['norovirus', /\bnorovirus\b/i],
  ['cyclospora', /\bcyclospora\b/i],
  ['bacillus_cereus', /\bbacillus\s+cereus\b|\bb\.\s?cereus\b/i],
  ['staphylococcus', /\bstaphylococc|\bs\.\s?aureus\b/i],
  ['burkholderia', /\bburkholderia\b|\bb\.\s?cepacia\b/i],
  ['pseudomonas', /\bpseudomonas\b/i],
  ['mold', /\bmold\b|\bmould\b|\bfung(?:al|us|i)\b|\baspergillus\b/i],
  ['yeast', /\byeast\b/i],
];

export function parseReason(text: string | null | undefined): RecallReason {
  const raw = text ?? '';
  const classes = CLASS_RULES.filter(([, pattern]) => pattern.test(raw)).map(([name]) => name);
  const allergenic = classes.includes('UNDECLARED_ALLERGEN');
  // Allergens only count in an allergen-declaration context, so "milk chocolate
  // contaminated with Salmonella" does not produce a milk allergen.
  const allergens = allergenic ? ALLERGEN_RULES.filter(([, pattern]) => pattern.test(raw)).map(([name]) => name) : [];
  const pathogens = PATHOGEN_RULES.filter(([, pattern]) => pattern.test(raw)).map(([name]) => name);
  return { classes, allergens, pathogens };
}
