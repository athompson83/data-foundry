/**
 * Coverage for the UA-002 migration password-file helper.
 *
 * The procedure this replaces edited the operator's own `~/.pgpass`, and six
 * review rounds found six distinct ways that went quietly wrong — a stale entry
 * winning on libpq's first-match rule, a stale wildcard winning for the same
 * reason, metacharacters corrupting the field structure, a cancelled prompt
 * installing an empty password, and a failed rewrite being installed anyway.
 * Every one of them came from mutating a shared file owned by someone else.
 *
 * The helper writes one file this project owns and never reads or rewrites
 * `~/.pgpass`, so the class is gone by construction. These tests pin that
 * property and the failure handling, with fictional credentials and no database
 * — the alternate-file path was separately confirmed against the real migration
 * runner, which is recorded in the verification record rather than re-run here.
 */
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HELPER = join(ROOT, 'tooling', 'scripts', 'ua002-migration-pgpassfile.sh');

const DECOY = '<host>:5432:<database>:<login-name>:THE-OPERATORS-OWN-PASSWORD';

interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly home: string;
}

interface RunOptions {
  /** Extra arguments appended after the defaults. */
  readonly args?: readonly string[];
  /** Exactly these arguments, replacing the defaults entirely. */
  readonly rawArgs?: readonly string[];
  /** Commands to replace with a failing stub, e.g. `['mv']`. */
  readonly breaks?: readonly string[];
  /** Seed `~/.pgpass` so we can prove it is never touched. */
  readonly seedPgpass?: boolean;
  /** Seed an existing target file, to exercise rotation. */
  readonly seedTarget?: string;
}

function run(password: string | null, options: RunOptions = {}): RunResult {
  const home = mkdtempSync(join(tmpdir(), 'ua002-helper-'));
  if (options.seedPgpass === true) {
    writeFileSync(join(home, '.pgpass'), `${DECOY}\n`, { mode: 0o600 });
  }
  if (options.seedTarget !== undefined) {
    mkdirSync(join(home, '.data-foundry'), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, '.data-foundry', 'ua002.pgpass'), `${options.seedTarget}\n`, {
      mode: 0o600,
    });
  }

  let path = process.env['PATH'] ?? '/usr/bin:/bin';
  if (options.breaks !== undefined && options.breaks.length > 0) {
    const stubs = join(home, 'stubs');
    mkdirSync(stubs);
    for (const command of options.breaks) {
      writeFileSync(join(stubs, command), `#!/bin/bash\necho "${command}: injected failure" >&2\nexit 7\n`);
      chmodSync(join(stubs, command), 0o755);
    }
    path = `${stubs}:${path}`;
  }

  const args = options.rawArgs ?? [
    '--host',
    '<host>',
    '--database',
    '<database>',
    '--login',
    '<login-name>',
    ...(options.args ?? []),
  ];

  try {
    const stdout = execFileSync('bash', [HELPER, ...args], {
      env: { HOME: home, PATH: path },
      input: password === null ? '' : `${password}\n`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { status: 0, stdout, stderr: '', home };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: failure.status ?? -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      home,
    };
  }
}

function targetPath(home: string): string {
  return join(home, '.data-foundry', 'ua002.pgpass');
}

/** libpq's rule: an unescaped `:` separates, `\` escapes the next character. */
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

function cleanup(result: RunResult): void {
  rmSync(result.home, { recursive: true, force: true });
}

describe('the helper writes a file this project owns', () => {
  it('writes all five fields and round-trips a password with pgpass metacharacters', () => {
    const result = run('pa:ss\\wo:rd');
    try {
      expect(result.status).toBe(0);
      const line = readFileSync(targetPath(result.home), 'utf8').replace(/\n$/u, '');
      const fields = parsePgpassLine(line);
      expect(fields).toEqual(['<host>', '5432', '<database>', '<login-name>', 'pa:ss\\wo:rd']);
    } finally {
      cleanup(result);
    }
  });

  it('restricts the file and its directory, and leaves no temporary file', () => {
    const result = run('ordinary-Passw0rd');
    try {
      expect((statSync(targetPath(result.home)).mode & 0o777).toString(8)).toBe('600');
      expect((statSync(join(result.home, '.data-foundry')).mode & 0o777).toString(8)).toBe('700');
      expect(readdirSync(join(result.home, '.data-foundry'))).toEqual(['ua002.pgpass']);
    } finally {
      cleanup(result);
    }
  });

  it('prints the exports without ever printing the password', () => {
    const result = run('ordinary-Passw0rd');
    try {
      expect(result.stdout).toContain('export PGPASSFILE=');
      expect(result.stdout).toContain('export DATA_FOUNDRY_MIGRATION_DATABASE_URL=');
      expect(result.stdout).not.toContain('ordinary-Passw0rd');
      expect(result.stderr).not.toContain('ordinary-Passw0rd');
      // The URL must carry no password; libpq reads it from the file.
      expect(result.stdout).toContain("'postgresql://<login-name>@<host>:5432/<database>'");
    } finally {
      cleanup(result);
    }
  });

  it('replaces its own file on a rotation without leaving a temporary behind', () => {
    const result = run('rotated-Passw0rd', { seedTarget: 'stale:5432:stale:stale:OLD' });
    try {
      const lines = readFileSync(targetPath(result.home), 'utf8').replace(/\n$/u, '').split('\n');
      expect(lines).toHaveLength(1);
      expect(parsePgpassLine(lines[0] ?? '')[4]).toBe('rotated-Passw0rd');
      expect(readdirSync(join(result.home, '.data-foundry'))).toEqual(['ua002.pgpass']);
    } finally {
      cleanup(result);
    }
  });
});

describe('the operator’s own ~/.pgpass is never involved', () => {
  it('does not read, rewrite or create it on success', () => {
    const result = run('ordinary-Passw0rd', { seedPgpass: true });
    try {
      expect(readFileSync(join(result.home, '.pgpass'), 'utf8')).toBe(`${DECOY}\n`);
    } finally {
      cleanup(result);
    }
  });

  it('does not create it when no password is given', () => {
    const result = run(null);
    try {
      expect(existsSync(join(result.home, '.pgpass'))).toBe(false);
    } finally {
      cleanup(result);
    }
  });
});

describe('nothing is written unless a password was actually read', () => {
  it('fails on a cancelled prompt and writes no file', () => {
    const result = run(null);
    try {
      expect(result.status).not.toBe(0);
      expect(existsSync(targetPath(result.home))).toBe(false);
    } finally {
      cleanup(result);
    }
  });

  it('fails on an empty password and leaves an existing file untouched', () => {
    const existing = 'kept:5432:kept:kept:KEEP-ME';
    const result = run('', { seedTarget: existing });
    try {
      expect(result.status).not.toBe(0);
      expect(readFileSync(targetPath(result.home), 'utf8')).toBe(`${existing}\n`);
    } finally {
      cleanup(result);
    }
  });

  it('refuses a password supplied as an argument', () => {
    const result = run(null, { args: ['--password', 'hunter2'] });
    try {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('refusing a password on the command line');
      expect(existsSync(targetPath(result.home))).toBe(false);
    } finally {
      cleanup(result);
    }
  });

  it('requires host, database and login, and a numeric port', () => {
    for (const rawArgs of [
      ['--database', 'd', '--login', 'l'],
      ['--host', 'h', '--login', 'l'],
      ['--host', 'h', '--database', 'd'],
    ]) {
      const result = run('ordinary-Passw0rd', { rawArgs });
      try {
        expect(
          result.status,
          `should have required a missing field: ${rawArgs.join(' ')}`,
        ).not.toBe(0);
      } finally {
        cleanup(result);
      }
    }
    const badPort = run('ordinary-Passw0rd', { args: ['--port', 'not-a-number'] });
    try {
      expect(badPort.status).not.toBe(0);
      expect(badPort.stderr).toContain('--port must be a number');
    } finally {
      cleanup(badPort);
    }
  });
});

describe('a failed file operation never reports success', () => {
  for (const command of ['mktemp', 'chmod', 'mv'] as const) {
    it(`fails closed when ${command} fails, leaving the existing file intact`, () => {
      const existing = 'kept:5432:kept:kept:KEEP-ME';
      const result = run('ordinary-Passw0rd', { breaks: [command], seedTarget: existing });
      try {
        expect(result.status, `${command} failure must not report success`).not.toBe(0);
        expect(result.stdout).not.toContain('export PGPASSFILE=');
        expect(readFileSync(targetPath(result.home), 'utf8')).toBe(`${existing}\n`);
        // The temporary file holds the password; it must not survive a failure.
        expect(
          readdirSync(join(result.home, '.data-foundry')),
          `${command} failure left a temporary file behind`,
        ).toEqual(['ua002.pgpass']);
      } finally {
        cleanup(result);
      }
    });
  }

  it('returns a nonzero status rather than terminating the calling shell', () => {
    // The helper is a separate process, so `exit` cannot reach the operator's
    // interactive shell. This asserts the status is observable to a caller.
    const result = run(null);
    try {
      expect(result.status).toBeGreaterThan(0);
    } finally {
      cleanup(result);
    }
  });
});
