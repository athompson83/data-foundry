/**
 * The UA-002 handover must point the operator at the tested helper, and must
 * not grow a second, untested credential procedure alongside it.
 *
 * Six review findings landed on the inline shell block this replaced, every one
 * of them a way for a documented procedure to fail while looking correct, and
 * CI was green for all six — the checks that gate this repository do not reach a
 * procedure written in prose. The behaviour now lives in
 * `tooling/scripts/ua002-migration-pgpassfile.sh`, covered by
 * `ua002-migration-pgpassfile.test.ts`. What is left to assert here is that the
 * document keeps sending people there, and keeps the two facts that are about
 * this project rather than about the file format: which name authenticates, and
 * which identity the runner insists on.
 */
import { accessSync, constants, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HELPER_PATH = join('tooling', 'scripts', 'ua002-migration-pgpassfile.sh');
const HANDOVER = readFileSync(
  join(ROOT, 'docs', 'owner-actions', 'ua-002-hosted-migration-handover.md'),
  'utf8',
);
const SECTION =
  HANDOVER.split('## Determining whether your machine can run this')[1]?.split('\n## ')[0] ?? '';

describe('the handover points at the tested helper', () => {
  it('names a helper that exists and is executable', () => {
    expect(SECTION).toContain(HELPER_PATH);
    expect(() => accessSync(join(ROOT, HELPER_PATH), constants.X_OK)).not.toThrow();
  });

  it('tells the operator to use PGPASSFILE and a URL carrying no password', () => {
    expect(SECTION).toContain('export PGPASSFILE=');
    expect(SECTION).toContain(
      "export DATA_FOUNDRY_MIGRATION_DATABASE_URL='postgresql://<login-name>@<host>:5432/<database>'",
    );
  });

  it('never instructs anyone to edit the operator’s own ~/.pgpass', () => {
    // The whole class of findings came from mutating a shared file. A snippet
    // that writes to ~/.pgpass must not reappear in this document.
    expect(SECTION).not.toMatch(/>>?\s*~\/\.pgpass/u);
    expect(SECTION).not.toMatch(/mv\s+"?\$?\{?tmp\}?"?\s+~\/\.pgpass/u);
    expect(SECTION).not.toMatch(/touch\s+~\/\.pgpass/u);
  });

  it('states that the helper leaves an existing ~/.pgpass alone', () => {
    expect(SECTION).toMatch(/never reads, rewrites or removes your\s+`~\/\.pgpass`/u);
  });
});

describe('the execution sequence can actually be followed', () => {
  const SEQUENCE = HANDOVER.split('```bash')[1]?.split('```')[0] ?? '';

  it('places the credential before checking out a release that lacks the helper', () => {
    // The helper is newer than the pinned release, so a checkout-first order
    // fails with "No such file or directory" exactly when the credential is
    // needed. Verified with `git cat-file -e 2063ea8:<helper>`.
    expect(SEQUENCE).not.toBe('');
    const helperAt = SEQUENCE.indexOf(HELPER_PATH);
    const checkoutAt = SEQUENCE.indexOf('git checkout');
    expect(helperAt, 'the sequence must invoke the helper').toBeGreaterThan(-1);
    expect(checkoutAt, 'the sequence must still pin the release').toBeGreaterThan(-1);
    expect(helperAt, 'credential placement must come before the checkout').toBeLessThan(checkoutAt);
  });

  it('preserves the helper out of the checkout, with a digest, before switching revisions', () => {
    // The helper is absent at the pinned release, and the release must not move:
    // changing it would invalidate every release-dependent packet and checksum.
    const copyAt = SEQUENCE.indexOf(`cp ${HELPER_PATH}`);
    const digestAt = SEQUENCE.indexOf('helper.sha256');
    const checkoutAt = SEQUENCE.indexOf('git checkout');
    expect(copyAt, 'the helper must be copied out of the checkout').toBeGreaterThan(-1);
    expect(digestAt, 'its digest must be recorded').toBeGreaterThan(-1);
    expect(copyAt, 'the copy must precede the checkout').toBeLessThan(checkoutAt);
    // And re-verified plus checked after the checkout, when the tree no longer has it.
    expect(SEQUENCE.indexOf('shasum -a 256 -c')).toBeGreaterThan(checkoutAt);
    expect(SEQUENCE.indexOf('--check')).toBeGreaterThan(checkoutAt);
  });

  it('does not tell the operator to start where the helper is absent', () => {
    // The section opened with "Run from a clean checkout of <release>", which
    // put a fresh operator at a revision without the helper — so even the `cp`
    // that preserves it would fail.
    const section = HANDOVER.split('## Execution sequence')[1]?.split('\n## ')[0] ?? '';
    expect(section).not.toMatch(/^Run from a clean checkout of merged/mu);
    expect(section).toMatch(/\*\*The migration steps\*\* run from a clean checkout/u);
    expect(section).toMatch(/credential step runs before that, and not from there/u);
  });

  it('keeps the migration release pinned to the same SHA', () => {
    expect(SEQUENCE).toContain('git checkout 2063ea8d72247a9b2643e1c690e37ab55ab14252');
    expect(SEQUENCE).toContain('export DATA_FOUNDRY_RELEASE_SHA=2063ea8d72247a9b2643e1c690e37ab55ab14252');
  });

  it('follows no moving branch reference for the helper', () => {
    // `git fetch origin main` stays, because the checkout that follows pins a
    // SHA. What must not appear is the helper being taken from a branch.
    expect(SEQUENCE).not.toMatch(/checkout\s+(origin\/)?main[^\S\n]*$/mu);
  });

  it('clears stale exports before it starts', () => {
    expect(SEQUENCE).toContain('unset PGPASSFILE DATA_FOUNDRY_MIGRATION_DATABASE_URL');
  });

  it('never re-exports a placeholder connection string over the helper\u2019s', () => {
    // These overwrote the password-free URL with a secret-bearing placeholder,
    // silently bypassing PGPASSFILE.
    expect(HANDOVER).not.toContain("export DATA_FOUNDRY_MIGRATION_DATABASE_URL='...'");
  });
});

describe('the project-specific facts survive the rewrite', () => {
  it('still distinguishes the pooler login from the bare role', () => {
    expect(SECTION).toMatch(/project-qualified/u);
    expect(SECTION).toMatch(/connect dialog/u);
    expect(SECTION).toMatch(/bare `df_migration`/u);
  });

  it('still names the runner’s identity assertion as the actual check', () => {
    expect(SECTION).toMatch(/`session_user` and\s+`current_user` are both `df_migration`/u);
  });

  it('does not hand the operator a bare df_migration to authenticate with', () => {
    const helperInvocation = SECTION.split(HELPER_PATH)[1]?.split('```')[0] ?? '';
    expect(helperInvocation).not.toBe('');
    expect(helperInvocation).not.toContain('df_migration');
    expect(helperInvocation).toContain("--login '<login-name>'");
  });
});
