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
