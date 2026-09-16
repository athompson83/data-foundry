/**
 * Regression coverage for the UA-002 credential-placement guidance.
 *
 * Two review findings on this section were operator-path defects that no test
 * could have caught, because the guidance is prose and a shell snippet rather
 * than code: the connection login hard-coded a bare `df_migration`, which the
 * repository's own execution-environment record says will not authenticate
 * through the Supavisor pooler the same section recommends as the IPv4
 * fallback; and the password was written into `.pgpass` without escaping the
 * `:` and `\` that are metacharacters there.
 *
 * Asserting the prose alone would let the snippet drift from what it claims, so
 * the escaping tests **execute the documented block verbatim** against a
 * throwaway HOME and parse the result back with libpq's own rule. Nothing here
 * touches a real credential: the passwords are fictional strings chosen to
 * contain the metacharacters.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
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

/** Runs the documented block verbatim with a throwaway HOME and a piped password. */
function runDocumentedBlock(password: string): { line: string; mode: string } {
  const home = mkdtempSync(join(tmpdir(), 'ua002-pgpass-'));
  try {
    execFileSync('bash', ['-c', PGPASS_BLOCK], {
      env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
      input: `${password}\n`,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const path = join(home, '.pgpass');
    return {
      line: readFileSync(path, 'utf8').replace(/\n$/u, ''),
      mode: (statSync(path).mode & 0o777).toString(8),
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

  it('writes the file only the owner can read', () => {
    expect(runDocumentedBlock('ordinary-Passw0rd').mode).toBe('600');
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
  it('uses the same placeholder in the .pgpass user field and in the URL', () => {
    expect(PGPASS_BLOCK).toContain("'<login-name>'");
    expect(PGPASS_BLOCK).toContain('postgresql://<login-name>@<host>:5432/<database>');
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
