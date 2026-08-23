/**
 * Some sources are not a rights question we get to answer.
 *
 * The rights review is the general mechanism: a human reads the terms and
 * records what they permit. It works because the answer is genuinely open. For
 * a handful of publishers it is not open — AHRI's certification directory
 * forbids automated copying and dataset construction outright, and a
 * manufacturer's manuals, images and parts data carry no reuse grant at all.
 * Those answers do not change because a YAML file says GREEN.
 *
 * So they are refused in platform code rather than in configuration. A denylist
 * living in `verticals/<slug>/sources/*.yaml` would be defeated by editing the
 * file it lives in — which is precisely the move it exists to stop.
 *
 * This list names KNOWN prohibited publishers. It is a backstop, not a rights
 * engine: a source it does not name is not thereby permitted, it is merely
 * unreviewed.
 */
import { describe, expect, it } from 'vitest';
import {
  PROHIBITED_SOURCES,
  decideHost,
  hostnameOf,
  prohibitedSourceFor,
} from '../src/prohibited-sources.js';

describe('the prohibited-source list', () => {
  it('names AHRI as prohibited, with a reason and a way out', () => {
    const finding = prohibitedSourceFor('ahridirectory.org');
    expect(finding).not.toBeNull();
    expect(finding!.reason).toMatch(/automated|bulk|redistribut/i);
    // A prohibition with no stated route to lifting it is indistinguishable
    // from an unexplained veto, and will eventually be deleted by someone who
    // cannot tell which it was.
    expect(finding!.liftedBy.length).toBeGreaterThan(20);
  });

  /**
   * NEEP is the entry that shows why the list is not only about manufacturers.
   *
   * Its terms grant "personal, non-commercial use only" — a commercial data
   * product is the named excluded case rather than something inferred from
   * silence. And the list is operated in partnership with AHRI, so acquiring it
   * would route around the entry above rather than avoid it: the subdomain the
   * product list actually lives on has to be refused, not just the apex.
   */
  it('names NEEP, and refuses the subdomain the product list actually lives on', () => {
    const finding = prohibitedSourceFor('ashp.neep.org');
    expect(finding).not.toBeNull();
    expect(finding!.reason).toMatch(/non-commercial/i);
    // The AHRI relationship is the second, independent reason, and losing it
    // from the record would make this entry look like a lone terms-of-use call.
    expect(finding!.reason).toMatch(/AHRI/);
    expect(finding!.liftedBy.length).toBeGreaterThan(20);
  });

  it('covers each manufacturer named in the initial exclusion', () => {
    for (const domain of [
      'carrier.com',
      'trane.com',
      'lennox.com',
      'york.com',
      'daikin.com',
    ]) {
      expect(prohibitedSourceFor(domain), domain).not.toBeNull();
    }
  });

  it('matches subdomains, because a host under a prohibited domain is the same publisher', () => {
    expect(prohibitedSourceFor('www.ahridirectory.org')).not.toBeNull();
    expect(prohibitedSourceFor('data.ahridirectory.org')).not.toBeNull();
    expect(prohibitedSourceFor('parts.carrier.com')).not.toBeNull();
  });

  it('normalizes the spelling before matching', () => {
    // Same DNS name: case-insensitive, and the trailing dot is the root label.
    expect(prohibitedSourceFor('AHRIDIRECTORY.ORG')).not.toBeNull();
    expect(prohibitedSourceFor('ahridirectory.org.')).not.toBeNull();
    expect(prohibitedSourceFor('  Www.Carrier.Com  ')).not.toBeNull();
  });

  it('matches whole labels only', () => {
    // The failure mode of a naive `endsWith`: an unrelated publisher whose
    // domain merely ends with the same characters.
    expect(prohibitedSourceFor('notahridirectory.org')).toBeNull();
    expect(prohibitedSourceFor('aircarrier.com')).toBeNull();
    expect(prohibitedSourceFor('newyork.com')).toBeNull();
  });

  it('permits an ordinary domain and an empty one', () => {
    expect(prohibitedSourceFor('data.energystar.gov')).toBeNull();
    expect(prohibitedSourceFor('')).toBeNull();
  });

  it('states a reason and a lifting condition for every entry', () => {
    expect(PROHIBITED_SOURCES.length).toBeGreaterThan(0);
    for (const entry of PROHIBITED_SOURCES) {
      expect(entry.domain, JSON.stringify(entry)).toMatch(/^[a-z0-9.-]+$/);
      expect(entry.publisher.length, entry.domain).toBeGreaterThan(0);
      expect(entry.reason.length, entry.domain).toBeGreaterThan(20);
      expect(entry.liftedBy.length, entry.domain).toBeGreaterThan(20);
    }
  });
});

/**
 * The control has to answer the same question the same way however the host is
 * spelled.
 *
 * The first implementation normalized only case and a trailing dot, and its one
 * caller happened to pass a bare hostname — so it worked, and looked like it
 * worked in general. It did not: every URL form fell straight through and was
 * reported ALLOWED. `prohibitedSourceFor('https://carrier.com/')` returned
 * null. A control that fails open on the most obvious input a future caller
 * would hand it is not a control, and nothing in the tests said so, because the
 * tests only ever asked it what its one caller asks.
 */
describe('the host a value denotes is extracted before any policy decision', () => {
  const PROHIBITED_SPELLINGS: readonly string[] = [
    'carrier.com',
    'CARRIER.COM',
    '  carrier.com  ',
    'carrier.com.',
    'www.carrier.com',
    'parts.eu.carrier.com',
    'carrier.com:8443',
    'https://carrier.com',
    'https://carrier.com/',
    'http://carrier.com:8080/manuals/index.json',
    'https://www.carrier.com/manuals?model=24ANB7#specs',
    'https://CARRIER.COM/X?a=1#f',
    'https://carrier.com./manuals',
    '//carrier.com/manuals',
    'https://user:secret@carrier.com/manuals',
    'https://ahridirectory.org/certified/units.json',
    'ftp://ahridirectory.org/exports/units.csv',
  ];

  it.each(PROHIBITED_SPELLINGS)('refuses %s', (spelling) => {
    expect(prohibitedSourceFor(spelling), spelling).not.toBeNull();
    expect(decideHost(spelling).kind, spelling).toBe('PROHIBITED');
  });

  const ALLOWED_SPELLINGS: readonly string[] = [
    'data.energystar.gov',
    'https://data.energystar.gov/resource/83eb-xbyy.json?$limit=3',
    'ratings-directory.example.org',
    'https://catalog.acme-climate.example.com/catalog.json',
    // Whole labels only, in every form.
    'aircarrier.com',
    'https://aircarrier.com/parts',
    'notahridirectory.org',
    'https://newyork.com',
    // A lookalike that puts the prohibited name in the WRONG position: this is
    // a different registrable domain and a different party.
    'https://carrier.com.lookalike.example/manuals',
  ];

  it.each(ALLOWED_SPELLINGS)('permits %s', (spelling) => {
    expect(prohibitedSourceFor(spelling), spelling).toBeNull();
    expect(decideHost(spelling).kind, spelling).toBe('ALLOWED');
  });

  it('extracts the same host from every spelling of one publisher', () => {
    for (const spelling of [
      'carrier.com',
      'CARRIER.COM.',
      'https://carrier.com/x?y#z',
      'http://user:pw@carrier.com:8443/x',
      '//carrier.com',
    ]) {
      expect(hostnameOf(spelling), spelling).toBe('carrier.com');
    }
  });

  it('preserves the subdomain, because policy is decided per host', () => {
    expect(hostnameOf('https://parts.eu.carrier.com/x')).toBe('parts.eu.carrier.com');
  });
});

/**
 * Where a host decision is REQUIRED, "I could not tell" must not read as "fine".
 */
describe('an undecidable host fails closed', () => {
  const UNDECIDABLE: readonly string[] = [
    '',
    '   ',
    'not a hostname',
    'http://',
    '://carrier.com',
    'mailto:someone@carrier.com',
    'urn:isbn:0451450523',
    'https://',
    '..',
  ];

  it.each(UNDECIDABLE)('cannot decide %s', (value) => {
    expect(hostnameOf(value), value).toBeNull();
    expect(decideHost(value).kind, value).toBe('UNDECIDABLE');
  });

  it('says why it could not decide', () => {
    const decision = decideHost('not a hostname');
    expect(decision.kind).toBe('UNDECIDABLE');
    if (decision.kind === 'UNDECIDABLE') {
      expect(decision.reason.length).toBeGreaterThan(10);
    }
  });

  it('does not report an undecidable value as prohibited either', () => {
    // `prohibitedSourceFor` answers "which prohibition covers this", and the
    // honest answer for an unparseable value is "none of them". The fail-closed
    // decision belongs to `decideHost`, which the gates use — so a caller
    // cannot get a reassuring null without having asked the wrong question.
    expect(prohibitedSourceFor('not a hostname')).toBeNull();
    expect(decideHost('not a hostname').kind).toBe('UNDECIDABLE');
  });
});

