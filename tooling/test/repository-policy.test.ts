/**
 * The control that replaces remembering to grep.
 *
 * Twice now, a real prohibited publisher survived a cleanup because the sweep
 * that checked for it was a case-sensitive `grep AHRI\|Carrier` typed by hand.
 * It missed `legal/ahri-terms-2026-07-01.pdf` and a `sources` row seeded with
 * publisher `'AHRI'` on `ahridirectory.org`. Both were found by a reviewer, not
 * by the repository.
 *
 * A habit is not a control. This file is the control: it derives what to look
 * for from the prohibition list itself, so a domain added there is policed from
 * the moment it is added, and it fails the suite rather than a memory.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AMBIGUOUS_PUBLISHER_TOKENS,
  PROHIBITED_PUBLISHER_TOKENS,
  PROHIBITED_SOURCES,
} from '@data-foundry/source-registry';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Every tracked text file. Binary and lockfiles carry no rights claims. */
function trackedTextFiles(): string[] {
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path !== '')
    .filter((path) => !/\.(png|jpe?g|gif|pdf|ico|woff2?)$/i.test(path))
    .filter((path) => path !== 'pnpm-lock.yaml');
}

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/**
 * The only places a real prohibited domain may be written.
 *
 * Naming them is the point in each: the list itself, the tests that prove it
 * refuses them, and the documents that explain the policy and the source review
 * behind it. Everywhere else, a real prohibited domain is either a fabricated
 * rights claim or a fetch target, and both are defects.
 */
const DOMAIN_ALLOWLIST: readonly string[] = [
  'packages/source-registry/src/prohibited-sources.ts',
  'packages/source-registry/test/prohibited-sources.test.ts',
  'packages/acquisition/test/rights-gate.test.ts',
  'docs/sources/prohibited-sources.md',
  'tooling/test/repository-policy.test.ts',
];

describe('a prohibited domain may appear only where naming it is the point', () => {
  const domains = PROHIBITED_SOURCES.map((entry) => entry.domain);

  it('has domains to check', () => {
    // Without this the scan below passes vacuously on an empty list.
    expect(domains.length).toBeGreaterThan(0);
  });

  it.each(domains)('confines %s to the allowlist', (domain) => {
    const pattern = new RegExp(domain.replaceAll('.', '\\.'), 'i');
    const offenders = trackedTextFiles()
      .filter((path) => !DOMAIN_ALLOWLIST.includes(path))
      .filter((path) => pattern.test(read(path)));
    expect(
      offenders,
      `${domain} appears outside the prohibition list and its tests. Either it is a ` +
        `fabricated rights claim, or it is a fetch target. Use a reserved domain.`,
    ).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    // An allowlist entry that no longer names a prohibited domain is a
    // permission nobody revoked.
    const pattern = new RegExp(domains.map((d) => d.replaceAll('.', '\\.')).join('|'), 'i');
    for (const path of DOMAIN_ALLOWLIST) {
      expect(pattern.test(read(path)), `${path} names no prohibited domain; drop it`).toBe(true);
    }
  });

  it('is case-insensitive, which is how the last two escapes happened', () => {
    const pattern = new RegExp('ahridirectory\\.org', 'i');
    for (const spelling of ['AHRIDirectory.org', 'AHRIDIRECTORY.ORG', 'ahridirectory.org']) {
      expect(pattern.test(spelling), spelling).toBe(true);
    }
  });
});

/**
 * The nominative distinction, encoded.
 *
 * "Carrier" as an entity name is a product identifier and must stay — removing
 * it would damage identifier normalization and assert nothing about rights.
 * "Carrier" as a `publisher:` in a file that also declares permissions is a
 * claim about what that company permits. So the name check is scoped to files
 * that declare a rights posture, and the entity fixtures are left alone.
 */
describe('a prohibited publisher may not be named in a rights declaration', () => {
  const RIGHTS_MARKERS = /rights_policy|rights_classification|license_text_ref|publisher:/;

  const rightsFiles = (): string[] =>
    trackedTextFiles()
      .filter((path) => /\.(ts|yaml|yml|json)$/.test(path))
      .filter((path) => !DOMAIN_ALLOWLIST.includes(path))
      .filter((path) => RIGHTS_MARKERS.test(read(path)));

  it('finds rights-declaring files at all', () => {
    expect(rightsFiles().length).toBeGreaterThan(0);
  });

  it.each(PROHIBITED_PUBLISHER_TOKENS)('does not name %s in one', (token) => {
    const pattern = new RegExp(`\\b${token.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const offenders = rightsFiles().filter((path) => pattern.test(read(path)));
    expect(
      offenders,
      `"${token}" is named in a file that declares rights. A fictional publisher on a ` +
        `reserved domain must not rest on a real organisation's name or terms.`,
    ).toEqual([]);
  });

  it('leaves nominative entity names alone', () => {
    // The counterpart assertion: these are product identifiers, they are still
    // present, and this check must never start deleting them.
    const support = read('packages/canonical-store/test/support.ts');
    expect(support).toMatch(/carrier-infinity-24anb7/);
    expect(read('packages/normalization/src/identifier.ts')).toMatch(/AHRI/);
  });
});

/**
 * Where the line genuinely cannot be drawn mechanically, say so here rather
 * than pretend the scan covers it.
 */
describe('an ambiguous token is documented as out of reach, not half-policed', () => {
  it('does not pretend to police a name that is also an identifier', () => {
    for (const token of AMBIGUOUS_PUBLISHER_TOKENS) {
      expect(
        PROHIBITED_PUBLISHER_TOKENS,
        `"${token}" cannot be both policed and retained; it must not be in the scanned set`,
      ).not.toContain(token);
    }
  });

  it('keeps the identifiers that ambiguity protects', () => {
    // The reason the token is unscannable, asserted as behaviour: these are
    // load-bearing and a future cleanup must not quietly delete them.
    expect(readFileSync(join(ROOT, 'verticals/hvac/normalizers/03-domain-normalization.yaml'), 'utf8'))
      .toMatch(/prefixes:\s*\["AHRI"/);
    expect(readFileSync(join(ROOT, 'verticals/hvac/normalizers/source-mappings.yaml'), 'utf8'))
      .toMatch(/AHRI Certified Reference Number/);
  });

  it('still catches a fabricated claim about that publisher, via its domain', () => {
    // The domain check is what actually guards the ambiguous name: a rights
    // claim about AHRI has to name a host to be a claim about anything.
    const domains = PROHIBITED_SOURCES.map((entry) => entry.domain);
    expect(domains).toContain('ahridirectory.org');
    expect(domains).toContain('ahrinet.org');
  });
});
