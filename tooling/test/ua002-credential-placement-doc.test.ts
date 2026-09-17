/**
 * Regression coverage for the UA-002 credential-placement guidance.
 *
 * Five review findings on this section were operator-path defects that no text
 * assertion could have caught, because the guidance is prose and a shell
 * snippet rather than code. In order:
 *
 * 1. The connection login hard-coded a bare `df_migration`, which the
 *    repository's own execution-environment record says will not authenticate
 *    through the Supavisor pooler the same section recommends as the fallback.
 * 2. The password was written without escaping the `:` and `\` that are
 *    `.pgpass` metacharacters.
 * 3. The write appended, and libpq uses the first matching line, so a stale
 *    entry from an earlier password won.
 * 4. Any of the first four fields may be `*`, so dropping only the exact
 *    duplicate still left a stale wildcard ahead of the new entry.
 * 5. A cancelled prompt replaced a working credential with an empty password
 *    and exited 0.
 *
 * Asserting the prose would let the snippet drift from what it claims, so these
 * tests **execute the documented block verbatim** against a throwaway HOME and
 * parse the result back with libpq's own rule. Nothing here touches a real
 * credential: every password is a fictional string chosen for the property
 * under test.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HANDOVER = readFileSync(
  join(ROOT, 'docs', 'owner-actions', 'ua-002-hosted-migration-handover.md'),
  'utf8',
);

const SECTION =
  HANDOVER.split('## Determining whether your machine can run this')[1]?.split('\n## ')[0] ?? '';

function fencedBlocks(markdown: string): string[] {
  return [...markdown.matchAll(/```\n(.*?)```/gsu)].map((match) => match[1] ?? '');
}

/** The one documented block that writes `.pgpass`. */
const PGPASS_BLOCK = fencedBlocks(SECTION).find((block) => block.includes('~/.pgpass')) ?? '';

/**
 * libpq's `.pgpass` reader: an unescaped `:` separates fields and `\` escapes
 * the character after it. Implemented here rather than imported so the test
 * asserts against the documented format, not against our own writer.
 */
function parsePgpassLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '\\' && index + 1 < line.length) {
      current += line[index + 1];
      index += 1;
      continue;
    }
    if (character === ':') {
      fields.push(current);
      current = '';
      continue;
    }
    current += character;
  }
  fields.push(current);
  return fields;
}

interface BlockResult {
  /** The line the block wrote for this host/port/database/login. */
  readonly line: string;
  /** Every line in the resulting file, in order. */
  readonly lines: readonly string[];
  readonly mode: string;
  /** Anything left beside `.pgpass` — an interrupted write would show up here. */
  readonly strayFiles: readonly string[];
}

/**
 * Runs the documented block verbatim with a throwaway HOME and a piped password.
 * `existing` seeds `.pgpass` first, so the replace-vs-append behaviour is
 * observable rather than assumed.
 */
function runDocumentedBlock(
  password: string | null,
  existing: readonly string[] = [],
): BlockResult {
  const home = mkdtempSync(join(tmpdir(), 'ua002-pgpass-'));
  try {
    const path = join(home, '.pgpass');
    if (existing.length > 0) {
      writeFileSync(path, `${existing.join('\n')}\n`, { mode: 0o600 });
    }
    // `null` closes stdin immediately, which is what a cancelled prompt looks like.
    execFileSync('bash', ['-c', PGPASS_BLOCK], {
      env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
      input: password === null ? '' : `${password}\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = readFileSync(path, 'utf8').replace(/\n$/u, '').split('\n');
    const ours = lines.filter((entry) => entry.startsWith('<host>:5432:<database>:<login-name>:'));
    return {
      line: ours[0] ?? '',
      lines,
      mode: (statSync(path).mode & 0o777).toString(8),
      strayFiles: readdirSync(home).filter((name) => name !== '.pgpass'),
    };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe('the documented .pgpass block encodes the password rather than mangling it', () => {
  it('is present and is a single executable block', () => {
    expect(PGPASS_BLOCK, 'the .pgpass block must remain in the two-commands section').not.toBe('');
  });

  it('round-trips a password containing both pgpass metacharacters', () => {
    // `:` is the field separator and `\` is the escape character in .pgpass.
    const password = 'pa:ss\\wo:rd';
    const { line } = runDocumentedBlock(password);
    const fields = parsePgpassLine(line);
    expect(fields, `wrong field count in: ${line}`).toHaveLength(5);
    expect(fields[4]).toBe(password);
  });

  it('round-trips a password that is only metacharacters', () => {
    const password = ':\\:\\';
    const fields = parsePgpassLine(runDocumentedBlock(password).line);
    expect(fields).toHaveLength(5);
    expect(fields[4]).toBe(password);
  });

  it('leaves an ordinary password byte-identical', () => {
    const password = 'ordinary-Passw0rd';
    const { line } = runDocumentedBlock(password);
    expect(parsePgpassLine(line)[4]).toBe(password);
    expect(line).not.toContain('\\');
  });

  it('writes the file only the owner can read and leaves no partial file behind', () => {
    const result = runDocumentedBlock('ordinary-Passw0rd');
    expect(result.mode).toBe('600');
    expect(result.strayFiles, 'an interrupted write must not leave a temp file').toEqual([]);
  });

  it('replaces a stale entry for the same four fields rather than appending past it', () => {
    // libpq uses the FIRST matching line and stops looking, so an entry left
    // over from an earlier password would win over one appended below it.
    // Verified against PostgreSQL 16 with scram-sha-256: stale-first fails to
    // authenticate, correct-alone and correct-first succeed.
    const result = runDocumentedBlock('rotated-Passw0rd', [
      '<host>:5432:<database>:<login-name>:STALE-old-password',
    ]);
    const matching = result.lines.filter((entry) =>
      entry.startsWith('<host>:5432:<database>:<login-name>:'),
    );
    expect(matching, `expected exactly one matching entry, got: ${result.lines.join(' | ')}`)
      .toHaveLength(1);
    expect(parsePgpassLine(matching[0] ?? '')[4]).toBe('rotated-Passw0rd');
    expect(result.lines.join('\n')).not.toContain('STALE-old-password');
  });

  it('keeps entries for other hosts, ports, databases and logins', () => {
    const untouched = [
      'other.host:5432:otherdb:otheruser:keep-me',
      '<host>:5432:<database>:different-login:keep-me-too',
      '<host>:6543:<database>:<login-name>:different-port-keep',
    ];
    const result = runDocumentedBlock('ordinary-Passw0rd', untouched);
    for (const entry of untouched) {
      expect(result.lines, `clobbered an unrelated credential: ${entry}`).toContain(entry);
    }
  });

  it('writes the new entry first, so no earlier line can win', () => {
    // libpq stops at the first match, and any of the first four fields may be
    // `*`. Verified against PostgreSQL 16 with scram-sha-256: a stale
    // `*:*:*:login:OLD` placed first beats an exact entry below it.
    const result = runDocumentedBlock('rotated-Passw0rd', [
      '*:*:*:<login-name>:STALE-wildcard-password',
    ]);
    expect(result.lines[0], `new entry must be first, got: ${result.lines.join(' | ')}`).toBe(
      '<host>:5432:<database>:<login-name>:rotated-Passw0rd',
    );
  });

  it('keeps a wildcard entry rather than clobbering credentials it does not own', () => {
    // A `*` entry may be serving the operator's other hosts. Ordering already
    // neutralises it here, so removing it would be an overcorrection.
    const wildcard = '*:*:*:<login-name>:STALE-wildcard-password';
    const result = runDocumentedBlock('rotated-Passw0rd', [wildcard]);
    expect(result.lines).toContain(wildcard);
  });

  it('leaves .pgpass untouched when the prompt is cancelled', () => {
    // Measured on the unguarded form: stdin at EOF left `df_pw` empty and the
    // block replaced a working credential with an empty password, exiting 0.
    const working = ['<host>:5432:<database>:<login-name>:THE-OPERATORS-REAL-PASSWORD'];
    expect(runDocumentedBlock(null, working).lines).toEqual(working);
  });

  it('leaves .pgpass untouched when an empty password is entered', () => {
    const working = ['<host>:5432:<database>:<login-name>:THE-OPERATORS-REAL-PASSWORD'];
    expect(runDocumentedBlock('', working).lines).toEqual(working);
  });

  it('requires the read to succeed and be non-empty before writing anything', () => {
    expect(PGPASS_BLOCK).toMatch(/if IFS= read -rs[^\n]*&& \[ -n "\$df_pw" \]; then/u);
    expect(PGPASS_BLOCK).toContain('left unchanged');
  });

  it('never makes the password a command-line argument or a history entry', () => {
    expect(PGPASS_BLOCK).toContain('read -rs');
    expect(PGPASS_BLOCK).toContain('unset df_pw');
    // A literal password placeholder would mean it is typed on the command line.
    expect(PGPASS_BLOCK).not.toContain("'<password>'");
    expect(PGPASS_BLOCK).not.toMatch(/PGPASSWORD=/u);
  });
});

describe('the documented connection login is operator-supplied, not a bare role name', () => {
  it('takes the login for the .pgpass user field and the URL from one variable', () => {
    expect(PGPASS_BLOCK).toContain("login='<login-name>'");
    expect(PGPASS_BLOCK).toContain('postgresql://$login@$host:$port/$database');
    // Executing it is what proves the two actually agree.
    const { line } = runDocumentedBlock('ordinary-Passw0rd');
    expect(parsePgpassLine(line)[3]).toBe('<login-name>');
  });

  it('does not hard-code a bare df_migration as the thing that authenticates', () => {
    expect(PGPASS_BLOCK).not.toContain('df_migration@');
    expect(PGPASS_BLOCK).not.toContain("'df_migration'");
  });

  it('states that the Supavisor route needs a project-qualified login read from the dialog', () => {
    expect(SECTION).toMatch(/project-qualified/u);
    expect(SECTION).toMatch(/connect dialog/u);
    // The bare form stays correct for the direct origin, so both must be named.
    expect(SECTION).toMatch(/bare `df_migration`/u);
  });

  it('keeps the pooler login separate from the database-side identity assertion', () => {
    expect(SECTION).toMatch(/`session_user` and\s+`current_user` are both `df_migration`/u);
  });

  it('carries no password in the connection URL', () => {
    const url = /postgresql:\/\/[^\s']+/u.exec(PGPASS_BLOCK)?.[0] ?? '';
    expect(url).not.toBe('');
    expect(url.slice('postgresql://'.length).split('@')[0]).not.toContain(':');
  });
});
