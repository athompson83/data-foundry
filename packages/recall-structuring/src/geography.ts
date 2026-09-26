/**
 * Distribution-pattern geography. The source field is free prose written by
 * recalling firms and FDA staff ("Worldwide - US Nationwide distribution in the
 * states of FL, GA ... and the countries of Guatemala and Panama."), so every
 * rule here is deterministic and conservative: an ambiguous token is only
 * accepted when surrounding list context makes it unambiguous.
 */

export const US_STATES: Readonly<Record<string, string>> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands', AS: 'American Samoa',
  MP: 'Northern Mariana Islands',
};

/** Two-letter codes that are also ordinary English words or abbreviations. */
const AMBIGUOUS_CODES = new Set([
  'IN', 'OR', 'ME', 'OK', 'DE', 'PA', 'CO', 'AL', 'MA', 'HI', 'ID', 'OH', 'LA',
  'MI', 'MO', 'MS', 'AS', 'GA', 'SC', 'VA', 'WA', 'MD', 'CT', 'NE', 'VI', 'MP',
]);

const STATE_NAME_TO_CODE = new Map(
  Object.entries(US_STATES).map(([code, name]) => [name.toLowerCase(), code] as const),
);

/**
 * Country names FDA text actually uses, mapped to ISO 3166-1 alpha-2. Georgia is
 * deliberately absent: in this corpus it is overwhelmingly the US state.
 */
const COUNTRIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bcanada\b/i, 'CA'], [/\bmexico\b/i, 'MX'], [/\bpuerto rico\b/i, 'PR'],
  [/\bunited kingdom\b|\bu\.?k\.?\b|\bengland\b|\bgreat britain\b|\bscotland\b/i, 'GB'],
  [/\bireland\b/i, 'IE'], [/\bfrance\b/i, 'FR'], [/\bgermany\b/i, 'DE'],
  [/\bitaly\b/i, 'IT'], [/\bspain\b/i, 'ES'], [/\bportugal\b/i, 'PT'],
  [/\bnetherlands\b|\bholland\b/i, 'NL'], [/\bbelgium\b/i, 'BE'],
  [/\bswitzerland\b/i, 'CH'], [/\baustria\b/i, 'AT'], [/\bsweden\b/i, 'SE'],
  [/\bnorway\b/i, 'NO'], [/\bdenmark\b/i, 'DK'], [/\bfinland\b/i, 'FI'],
  [/\bpoland\b/i, 'PL'], [/\bczech/i, 'CZ'], [/\bhungary\b/i, 'HU'],
  [/\bgreece\b/i, 'GR'], [/\bturkey\b|\btürkiye\b/i, 'TR'], [/\bisrael\b/i, 'IL'],
  [/\bsaudi arabia\b/i, 'SA'], [/\bunited arab emirates\b|\bu\.?a\.?e\.?\b/i, 'AE'],
  [/\bkuwait\b/i, 'KW'], [/\bqatar\b/i, 'QA'], [/\bbahrain\b/i, 'BH'],
  [/\boman\b/i, 'OM'], [/\bjordan\b/i, 'JO'], [/\blebanon\b/i, 'LB'],
  [/\begypt\b/i, 'EG'], [/\bsouth africa\b/i, 'ZA'], [/\bnigeria\b/i, 'NG'],
  [/\bkenya\b/i, 'KE'], [/\bindia\b/i, 'IN'], [/\bpakistan\b/i, 'PK'],
  [/\bchina\b/i, 'CN'], [/\bhong kong\b/i, 'HK'], [/\btaiwan\b/i, 'TW'],
  [/\bjapan\b/i, 'JP'], [/\bsouth korea\b|\bkorea\b/i, 'KR'],
  [/\bsingapore\b/i, 'SG'], [/\bmalaysia\b/i, 'MY'], [/\bthailand\b/i, 'TH'],
  [/\bvietnam\b|\bviet nam\b/i, 'VN'], [/\bphilippines\b/i, 'PH'],
  [/\bindonesia\b/i, 'ID'], [/\baustralia\b/i, 'AU'], [/\bnew zealand\b/i, 'NZ'],
  [/\bbrazil\b/i, 'BR'], [/\bargentina\b/i, 'AR'], [/\bchile\b/i, 'CL'],
  [/\bcolombia\b/i, 'CO'], [/\bperu\b/i, 'PE'], [/\becuador\b/i, 'EC'],
  [/\bvenezuela\b/i, 'VE'], [/\bpanama\b/i, 'PA'], [/\bcosta rica\b|\bcosts rica\b/i, 'CR'],
  [/\bguatemala\b/i, 'GT'], [/\bhonduras\b/i, 'HN'], [/\bel salvador\b/i, 'SV'],
  [/\bnicaragua\b/i, 'NI'], [/\bdominican republic\b/i, 'DO'],
  [/\bjamaica\b/i, 'JM'], [/\bbahamas\b/i, 'BS'], [/\btrinidad\b/i, 'TT'],
  [/\bbarbados\b/i, 'BB'], [/\baruba\b/i, 'AW'], [/\bcuracao\b|\bcuraçao\b/i, 'CW'],
  [/\bbermuda\b/i, 'BM'], [/\bcayman\b/i, 'KY'], [/\brussia\b/i, 'RU'],
  [/\bukraine\b/i, 'UA'], [/\bromania\b/i, 'RO'], [/\bslovakia\b/i, 'SK'],
  [/\bslovenia\b/i, 'SI'], [/\bcroatia\b/i, 'HR'], [/\bserbia\b/i, 'RS'],
  [/\bbulgaria\b/i, 'BG'], [/\blithuania\b/i, 'LT'], [/\blatvia\b/i, 'LV'],
  [/\bestonia\b/i, 'EE'], [/\biceland\b/i, 'IS'], [/\bluxembourg\b/i, 'LU'],
  [/\bcyprus\b/i, 'CY'], [/\bmalta\b/i, 'MT'], [/\bmorocco\b/i, 'MA'],
  [/\balgeria\b/i, 'DZ'], [/\btunisia\b/i, 'TN'], [/\bghana\b/i, 'GH'],
  [/\bbangladesh\b/i, 'BD'], [/\bsri lanka\b/i, 'LK'], [/\bnepal\b/i, 'NP'],
  [/\biraq\b/i, 'IQ'], [/\biran\b/i, 'IR'], [/\bafghanistan\b/i, 'AF'],
  [/\buruguay\b/i, 'UY'], [/\bparaguay\b/i, 'PY'], [/\bbolivia\b/i, 'BO'],
  [/\bhaiti\b/i, 'HT'], [/\bbelize\b/i, 'BZ'], [/\bguyana\b/i, 'GY'],
];

export interface DistributionGeography {
  readonly nationwide_us: boolean;
  readonly international: boolean;
  /** US states, DC and territories as USPS codes, sorted. */
  readonly us_states: readonly string[];
  /** ISO 3166-1 alpha-2 codes outside the US, sorted. */
  readonly countries: readonly string[];
  readonly us_military: boolean;
  readonly internet_sales: boolean;
}

const NATIONWIDE = /\bnation\s*-?\s*wide\b|\ball\s+50\s+states\b|\bthroughout\s+the\s+(?:u\.?\s?s\.?a?\b|united\s+states)|\bentire\s+(?:u\.?s\.?|united\s+states)/i;
const INTERNATIONAL = /\bworld\s*-?\s*wide\b|\binternational(?:ly)?\b|\bforeign\b|\bglobal(?:ly)?\b/i;
const MILITARY = /\bmilitary\b|\barmy\b|\bnavy\b|\bair force\b|\b(?:VA|veterans?)\s+(?:hospital|medical|affairs)|\bAPO\b|\bFPO\b|\bDoD\b/;
const INTERNET = /\binternet\b|\bonline\b|\bwebsite\b|\bamazon\b|\be-?commerce\b|\bmail[\s-]?order\b/i;

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort();
}

export function parseDistribution(text: string | null | undefined): DistributionGeography {
  const raw = (text ?? '').trim();
  const states = new Set<string>();

  // Full state names first; they are unambiguous except where a name is a
  // prefix of another ("Virginia" inside "West Virginia"), handled by removal.
  let residual = raw;
  const names = [...STATE_NAME_TO_CODE.keys()].sort((a, b) => b.length - a.length);
  for (const name of names) {
    const pattern = new RegExp(`\\b${name.replace(/[.]/g, '\\.').replace(/ /g, '\\s+')}\\b`, 'gi');
    if (pattern.test(residual)) {
      states.add(STATE_NAME_TO_CODE.get(name) as string);
      // A placeholder, not a space: removing a name must not make the codes on
      // either side of it look like an adjacent list ("IN TEXAS OR").
      residual = residual.replace(pattern, ' § ');
    }
  }

  // Two-letter codes. Tokenize on the original casing: codes are uppercase.
  const tokens = [...residual.matchAll(/\b([A-Z]{2})\b/g)];
  const isCode = (value: string | undefined): boolean => value !== undefined && value in US_STATES;
  // Two adjacent codes are "joined" when only list glue separates them, and
  // "punctuated" when that glue includes list punctuation or "and".
  const gap = (left: RegExpMatchArray, right: RegExpMatchArray): string => residual.slice((left.index ?? 0) + 2, right.index ?? 0);
  const joined = tokens.map((match, index) => {
    const next = tokens[index + 1];
    return next !== undefined && isCode(match[1]) && isCode(next[1]) && /^[\s,;/&.]*(?:and\s+)?[\s,;/&.]*$/i.test(gap(match, next));
  });
  const punctuated = tokens.map((match, index) => {
    const next = tokens[index + 1];
    return joined[index] === true && next !== undefined && /[,;/&.]|\band\b/i.test(gap(match, next));
  });
  // A field that is nothing but state codes and list glue ("OH PA") is a list.
  const pureList = tokens.length > 0 && tokens.every((match) => isCode(match[1])) && !/[A-Za-z]/.test(residual.replace(/\b[A-Z]{2}\b/g, '').replace(/\band\b/gi, ''));
  // Length of the run of joined codes each token belongs to.
  const runLength = new Array<number>(tokens.length).fill(1);
  for (let start = 0; start < tokens.length; ) {
    let end = start;
    while (joined[end] === true) end += 1;
    for (let index = start; index <= end; index += 1) runLength[index] = end - start + 1;
    start = end + 1;
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const code = (tokens[index] as RegExpMatchArray)[1] as string;
    if (!isCode(code)) continue;
    // Ambiguous codes ("IN", "OR", "ME") need list context: a run of three or
    // more codes ("AZ  CA  FL  IN  MA"), or a neighbour joined by list
    // punctuation ("FL, IN", "CA, FL. GA", "PA and OH"). Two codes separated
    // by bare spaces ("IN OR AROUND") are ordinary all-caps prose.
    const previous = tokens[index - 1]?.[1];
    const next = tokens[index + 1]?.[1];
    if (
      !AMBIGUOUS_CODES.has(code) ||
      pureList ||
      (runLength[index] ?? 1) >= 3 ||
      punctuated[index] === true ||
      punctuated[index - 1] === true ||
      // A space-joined neighbour that is itself unambiguous ("AR  IN").
      (joined[index - 1] === true && previous !== undefined && !AMBIGUOUS_CODES.has(previous)) ||
      (joined[index] === true && next !== undefined && !AMBIGUOUS_CODES.has(next))
    ) {
      states.add(code);
    }
  }

  const countries = new Set<string>();
  for (const [pattern, iso] of COUNTRIES) {
    if (iso === 'PR') continue;
    // "IN" (India) collides with the state code; country names only.
    if (pattern.test(raw)) countries.add(iso);
  }
  if (/\bpuerto\s+rico\b/i.test(raw)) states.add('PR');

  // "Not distributed nationwide", "no nationwide distribution" negate it.
  const notNationwide = /\b(?:not|no|never)\s+(?:(?:been|being)\s+)?(?:distributed\s+|sold\s+|shipped\s+)?nation\s*-?\s*wide\b/i.test(raw);
  const nationwide = NATIONWIDE.test(raw) && !notNationwide;
  // "International: None reported", "no foreign distribution".
  const noInternational = /\b(?:international|foreign|outside\s+(?:the\s+)?u\.?s\.?)\b[^.;]{0,20}\b(?:none|no|n\/a)\b|\bno\s+(?:international|foreign)\b|\bnot\s+(?:distributed\s+)?(?:internationally|outside)/i.test(raw);
  return {
    nationwide_us: nationwide,
    international: countries.size > 0 || (INTERNATIONAL.test(raw) && !noInternational),
    us_states: sortedUnique(states),
    countries: sortedUnique(countries),
    us_military: MILITARY.test(raw),
    internet_sales: INTERNET.test(raw),
  };
}
