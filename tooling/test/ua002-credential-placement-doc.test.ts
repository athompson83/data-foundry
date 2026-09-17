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
import { createHash } from 'node:crypto';
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

  it('documents the residual-secret warning using the string the helper emits', () => {
    // The document promised the temporary file is removed "on failure and on
    // interruption alike", which was false when removal itself failed. Bind the
    // documented warning to the literal in the script so the guarantee and the
    // behaviour cannot drift apart again: this asserts the doc against the
    // CODE, not against prose.
    const helper = readFileSync(join(ROOT, HELPER_PATH), 'utf8');
    const marker = 'WARNING: the temporary password file MAY STILL EXIST';
    expect(helper, 'the helper must warn when it cannot remove the staged secret').toContain(marker);
    expect(HANDOVER, 'the handover must document that warning verbatim').toContain(marker);
    expect(HANDOVER).toMatch(/holds the migration password in\s+clear text/u);
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
    // Verified twice against the published digest: once before the helper is
    // ever run, and again after the checkout, when the tree no longer has it.
    expect(
      SEQUENCE.indexOf('shasum -a 256 -c'),
      'the copy must be verified before it is run',
    ).toBeLessThan(checkoutAt);
    expect(
      SEQUENCE.lastIndexOf('shasum -a 256 -c'),
      'and re-verified after the checkout',
    ).toBeGreaterThan(checkoutAt);
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

  it('publishes the helper\u2019s real digest, so provenance is checkable', () => {
    // A digest the operator generates from their own tree proves only that the
    // copy did not change afterwards. This one is reviewed and published, and
    // this assertion stops it drifting from the file it describes.
    const actual = createHash('sha256')
      .update(readFileSync(join(ROOT, HELPER_PATH)))
      .digest('hex');
    expect(
      HANDOVER,
      `the handover must publish the helper digest ${actual}`,
    ).toContain(actual);
    // And the sequence must compare against it rather than a self-made one.
    expect(SEQUENCE).toContain(actual);
    expect(SEQUENCE).toContain('shasum -a 256 -c');
    expect(SEQUENCE, 'must not hash whatever is on disk and trust that').not.toMatch(
      /shasum -a 256 "\$UA002_DIR[^\n]*\| tee/u,
    );
  });

  it('chains each guard to what it guards, so a failure stops the procedure', () => {
    // The block is pasted into the operator's shell, so it cannot use `set -e`
    // without being hostile. That makes every check advisory unless it is
    // chained: a bare `shasum -c` that prints FAILED still lets the next line
    // run the unverified helper and hand it the password.
    expect(
      SEQUENCE,
      'the digest check must gate the helper invocation',
    ).toMatch(/shasum -a 256 -c "\$UA002_DIR\/helper\.sha256" \\\n\s+&& "\$UA002_DIR\/ua002-migration-pgpassfile\.sh"/u);
    // Every digest check, not a fixed number of them: hard-coding the count is
    // the same assert-the-case mistake, one layer up.
    const checks = [...HANDOVER.matchAll(/shasum -a 256 -c "\$UA002_DIR\/helper\.sha256"/gu)];
    const chained = [
      ...HANDOVER.matchAll(/shasum -a 256 -c "\$UA002_DIR\/helper\.sha256" \\\n\s+&&/gu),
    ];
    expect(checks.length, 'the procedure must verify the digest').toBeGreaterThan(0);
    expect(
      chained.length,
      `every digest check must be chained; found ${checks.length} checks and ${chained.length} chained`,
    ).toBe(checks.length);
    // And every operator invocation must be gated, not just the ones that
    // happened to be noticed. Chaining one call site and leaving another
    // unchained further down the same block is how this defect recurred.
    const invocations = [...HANDOVER.matchAll(/pnpm ua002:operator/gu)];
    expect(invocations.length, 'the procedure must still invoke the operator').toBeGreaterThan(0);
    const gated = [...HANDOVER.matchAll(/--check \\\n\s+&& pnpm ua002:operator/gu)];
    expect(
      gated.length,
      `every "pnpm ua002:operator" must be chained to --check; found ${invocations.length} invocations and ${gated.length} gated`,
    ).toBe(invocations.length);
  });

  it('gates every helper invocation with a digest check at the point of use', () => {
    // A `set -e`-free pasted block cannot gate "the remainder of the
    // procedure": an earlier failure only skips what is chained to it. Steps
    // with manual actions sit between the checks, so the only thing that binds
    // is re-verifying immediately before each use -- which also covers a copy
    // modified after an earlier check.
    const invocations = [
      ...HANDOVER.matchAll(/"\$UA002_DIR\/ua002-migration-pgpassfile\.sh"/gu),
    ].filter((match) => {
      // The line that writes the digest file names the helper as an argument
      // rather than running it.
      const line = HANDOVER.slice(HANDOVER.lastIndexOf('\n', match.index) + 1);
      return !line.startsWith('  "$UA002_DIR/ua002-migration-pgpassfile.sh" > ');
    });
    const gated = [
      ...HANDOVER.matchAll(
        /shasum -a 256 -c "\$UA002_DIR\/helper\.sha256" \\\n\s+&& "\$UA002_DIR\/ua002-migration-pgpassfile\.sh"/gu,
      ),
    ];
    expect(invocations.length, 'the procedure must invoke the helper').toBeGreaterThan(0);
    expect(
      gated.length,
      `every helper invocation must be digest-gated at the point of use; found ${invocations.length} invocations and ${gated.length} gated`,
    ).toBe(invocations.length);
  });

  it('numbers the procedure steps once each, in order', () => {
    // Inserting the credential steps left two "# 1." and two "# 2." in one
    // block, which makes "only once step 4 is clean" ambiguous.
    const numbers = [...SEQUENCE.matchAll(/^# (\d+)\./gmu)].map((m) => Number(m[1]));
    expect(numbers.length).toBeGreaterThan(3);
    expect(numbers, 'steps must be consecutive and unique').toEqual(
      numbers.map((_, index) => index + 1),
    );
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

  it('clears stale exports before it starts, PGPASSWORD included', () => {
    // PGPASSWORD is not a competing source but an overriding one: `pg` reads it
    // into the connection password and consults the password file only when
    // that is still null. Measured against a live TLS PostgreSQL 16 with
    // scram-sha-256 -- a CORRECT password file plus a stale PGPASSWORD fails to
    // authenticate. Every `unset` in the document must therefore name it, not
    // just the first one anyone happened to fix.
    const unsets = [...HANDOVER.matchAll(/^\s*unset PGPASSFILE[^\n]*/gmu)].map((m) => m[0]);
    expect(unsets.length, 'the document must clear stale settings').toBeGreaterThan(0);
    for (const line of unsets) {
      expect(line, `this unset does not clear PGPASSWORD: ${line.trim()}`).toContain('PGPASSWORD');
      expect(line).toContain('DATA_FOUNDRY_MIGRATION_DATABASE_URL');
    }
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
