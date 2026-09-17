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
 * `~/.pgpass`, so that class is gone by construction. Later rounds found defects
 * the redesign did not prevent — an interrupt installing a world-readable file,
 * a directory destination reported as success, exports that broke on a quoted
 * path — and those are pinned here too.
 *
 * Fictional credentials only, and no database: the alternate-file path and the
 * complete documented sequence were confirmed separately against the real
 * migration driver over verified TLS, recorded in the verification record.
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
  /** Run under this umask, to prove the mode never depends on the ambient one. */
  readonly umask?: string;
  /** Deliver SIGINT to the script from inside this stubbed command. */
  readonly interruptDuring?: string;
  /** Create the target path as a directory before running. */
  readonly targetIsDirectory?: boolean;
  /** Use a HOME containing a single quote. */
  readonly awkwardHome?: boolean;
  /** Put the target behind a symlink pointing at a directory. */
  readonly targetIsSymlinkToDirectory?: boolean;
  /** Extra environment for the child. */
  readonly env?: Readonly<Record<string, string>>;
}

function run(password: string | null, options: RunOptions = {}): RunResult {
  const home = mkdtempSync(
    join(tmpdir(), options.awkwardHome === true ? "o'connor-" : 'ua002-helper-'),
  );
  if (options.targetIsDirectory === true) {
    mkdirSync(join(home, '.data-foundry', 'ua002.pgpass'), { recursive: true });
  }
  if (options.targetIsSymlinkToDirectory === true) {
    mkdirSync(join(home, '.data-foundry'), { recursive: true });
    mkdirSync(join(home, 'elsewhere'), { recursive: true });
    symlinkSync(join(home, 'elsewhere'), join(home, '.data-foundry', 'ua002.pgpass'));
  }
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
  const stubbed = [...(options.breaks ?? [])];
  if (stubbed.length > 0 || options.interruptDuring !== undefined) {
    const stubs = join(home, 'stubs');
    mkdirSync(stubs);
    for (const command of stubbed) {
      writeFileSync(join(stubs, command), `#!/bin/bash\necho "${command}: injected failure" >&2\nexit 7\n`);
      chmodSync(join(stubs, command), 0o755);
    }
    if (options.interruptDuring !== undefined) {
      // Succeeds, but signals the script first — so the handler runs at a point
      // where the script would otherwise carry on.
      writeFileSync(
        join(stubs, options.interruptDuring),
        '#!/bin/bash\nkill -INT "$PPID" 2>/dev/null\nexit 0\n',
      );
      chmodSync(join(stubs, options.interruptDuring), 0o755);
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

  const command =
    options.umask === undefined
      ? [HELPER, ...args]
      : ['-c', `umask ${options.umask}; exec "$0" "$@"`, HELPER, ...args];

  try {
    const stdout = execFileSync('bash', command, {
      env: { HOME: home, PATH: path, ...(options.env ?? {}) },
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
      // The exports are shell-escaped, so assert what they evaluate to rather
      // than how they are spelled. The URL must carry no password; libpq reads
      // it from the file.
      const evaluated = execFileSync(
        'bash',
        ['-c', `${result.stdout}\nprintf '%s\\n%s' "$PGPASSFILE" "$DATA_FOUNDRY_MIGRATION_DATABASE_URL"`],
        { encoding: 'utf8' },
      ).split('\n');
      expect(evaluated[0]).toBe(targetPath(result.home));
      expect(evaluated[1]).toBe('postgresql://<login-name>@<host>:5432/<database>');
      expect(evaluated[1]).not.toContain('ordinary-Passw0rd');
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

describe('the emitted exports are safe to run verbatim', () => {
  /** Runs the emitted assignments in a fresh shell and reads the values back. */
  function evaluate(
    stdout: string,
    home: string,
    cwd?: string,
  ): { pgpassfile: string; url: string } {
    const out = execFileSync(
      'bash',
      ['-c', `${stdout}\nprintf '%s\\n%s' "$PGPASSFILE" "$DATA_FOUNDRY_MIGRATION_DATABASE_URL"`],
      {
        encoding: 'utf8',
        env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home },
        ...(cwd === undefined ? {} : { cwd }),
      },
    ).split('\n');
    return { pgpassfile: out[0] ?? '', url: out[1] ?? '' };
  }

  it('preserves a path containing spaces exactly', () => {
    const outer = mkdtempSync(join(tmpdir(), 'ua002-space-'));
    const home = join(outer, 'a directory with spaces');
    mkdirSync(home);
    try {
      const stdout = execFileSync(
        'bash',
        [HELPER, '--host', 'h', '--database', 'd', '--login', 'l'],
        { env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, input: 'pw\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      expect(evaluate(stdout, home).pgpassfile).toBe(join(home, '.data-foundry', 'ua002.pgpass'));
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });

  it('preserves a path containing a single quote exactly', () => {
    const result = run('ordinary-Passw0rd', { awkwardHome: true });
    try {
      expect(result.home).toContain("'");
      expect(evaluate(result.stdout, result.home).pgpassfile).toBe(targetPath(result.home));
    } finally {
      cleanup(result);
    }
  });

  it('does not execute a command hidden in the path', () => {
    const outer = mkdtempSync(join(tmpdir(), 'ua002-inject-'));
    // The directory name cannot contain a slash, so the injected command writes
    // a relative marker and the evaluating shell runs with `outer` as its cwd.
    const marker = join(outer, 'EXECUTED');
    const home = join(outer, 'x$(touch EXECUTED)y');
    mkdirSync(home);
    try {
      const stdout = execFileSync(
        'bash',
        [HELPER, '--host', 'h', '--database', 'd', '--login', 'l'],
        { env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin' }, input: 'pw\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
      );
      const evaluated = evaluate(stdout, home, outer);
      expect(existsSync(marker), 'the emitted export executed a command from the path').toBe(false);
      expect(evaluated.pgpassfile).toBe(join(home, '.data-foundry', 'ua002.pgpass'));
    } finally {
      rmSync(outer, { recursive: true, force: true });
    }
  });
});

describe('--check stops a procedure running on stale or unsafe settings', () => {
  const okUrl = 'postgresql://<login-name>@<host>:5432/<database>';

  function check(env: Readonly<Record<string, string>>, home: string): { status: number; stderr: string } {
    try {
      execFileSync('bash', [HELPER, '--check'], {
        env: { HOME: home, PATH: process.env['PATH'] ?? '/usr/bin:/bin', ...env },
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { status: 0, stderr: '' };
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      return { status: failure.status ?? -1, stderr: failure.stderr ?? '' };
    }
  }

  it('passes once the credential step has run', () => {
    const result = run('ordinary-Passw0rd');
    try {
      const outcome = check(
        { PGPASSFILE: targetPath(result.home), DATA_FOUNDRY_MIGRATION_DATABASE_URL: okUrl },
        result.home,
      );
      expect(outcome.status).toBe(0);
    } finally {
      cleanup(result);
    }
  });

  it('refuses when either variable is unset', () => {
    const result = run('ordinary-Passw0rd');
    try {
      expect(check({ DATA_FOUNDRY_MIGRATION_DATABASE_URL: okUrl }, result.home).status).not.toBe(0);
      expect(check({ PGPASSFILE: targetPath(result.home) }, result.home).status).not.toBe(0);
    } finally {
      cleanup(result);
    }
  });

  it('refuses a URL that carries a password', () => {
    const result = run('ordinary-Passw0rd');
    try {
      const outcome = check(
        {
          PGPASSFILE: targetPath(result.home),
          DATA_FOUNDRY_MIGRATION_DATABASE_URL: 'postgresql://user:SECRET@host:5432/db',
        },
        result.home,
      );
      expect(outcome.status).not.toBe(0);
      expect(outcome.stderr).toContain('carries a password');
    } finally {
      cleanup(result);
    }
  });

  it('refuses a password file others can read, or one that is not a file', () => {
    const result = run('ordinary-Passw0rd');
    try {
      chmodSync(targetPath(result.home), 0o644);
      const loose = check(
        { PGPASSFILE: targetPath(result.home), DATA_FOUNDRY_MIGRATION_DATABASE_URL: okUrl },
        result.home,
      );
      expect(loose.status).not.toBe(0);
      expect(loose.stderr).toContain('readable by others');

      const directory = check(
        { PGPASSFILE: join(result.home, '.data-foundry'), DATA_FOUNDRY_MIGRATION_DATABASE_URL: okUrl },
        result.home,
      );
      expect(directory.status).not.toBe(0);
      expect(directory.stderr).toContain('not a regular file');
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

  it('does not install a world-readable file when interrupted mid-run', () => {
    // A handler that cleans up and returns is worse than none: the shell
    // resumes, the redirection recreates the deleted file under the ambient
    // umask, and `mv` installs it. Reproduced before the fix at mode 0644
    // containing the password, with the script exiting 0.
    const result = run('SECRET-PASSWORD', { interruptDuring: 'chmod', umask: '022' });
    try {
      expect(result.status, 'an interrupted run must not report success').not.toBe(0);
      expect(existsSync(targetPath(result.home)), 'no file may be installed').toBe(false);
      expect(readdirSync(join(result.home, '.data-foundry'))).toEqual([]);
    } finally {
      cleanup(result);
    }
  });

  it('restricts the file regardless of the ambient umask', () => {
    const result = run('ordinary-Passw0rd', { umask: '022' });
    try {
      expect((statSync(targetPath(result.home)).mode & 0o777).toString(8)).toBe('600');
      expect((statSync(join(result.home, '.data-foundry')).mode & 0o777).toString(8)).toBe('700');
    } finally {
      cleanup(result);
    }
  });

  it('refuses a target that already exists as a directory', () => {
    // `mv source directory` moves the source INTO it and succeeds, which left
    // PGPASSFILE pointing at a directory with the password in a random file
    // inside — reported as success.
    const result = run('SECRET-PASSWORD', { targetIsDirectory: true });
    try {
      expect(result.status).not.toBe(0);
      expect(result.stdout).not.toContain('export PGPASSFILE=');
      expect(readdirSync(join(result.home, '.data-foundry', 'ua002.pgpass'))).toEqual([]);
    } finally {
      cleanup(result);
    }
  });

  it('refuses a target that is a symlink to a directory', () => {
    const result = run('SECRET-PASSWORD', { targetIsSymlinkToDirectory: true });
    try {
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('symlink to a directory');
      expect(result.stdout).not.toContain('export PGPASSFILE=');
      expect(readdirSync(join(result.home, 'elsewhere'))).toEqual([]);
    } finally {
      cleanup(result);
    }
  });

  it('emits exports that parse even when the path contains a quote', () => {
    // The operator runs this output verbatim. A HOME like /home/o'connor
    // produced an unterminated quoted assignment.
    const result = run('ordinary-Passw0rd', { awkwardHome: true });
    try {
      expect(result.status).toBe(0);
      expect(result.home).toContain("'");
      expect(() =>
        execFileSync('bash', ['-n'], { input: result.stdout, stdio: ['pipe', 'pipe', 'pipe'] }),
      ).not.toThrow();
    } finally {
      cleanup(result);
    }
  });

  it('names the variables an earlier attempt may have left set', () => {
    // The helper is a separate process and cannot unset the caller's
    // environment, so a failure that says nothing would let the next migration
    // command run against settings from an earlier attempt.
    for (const result of [run(null), run('ordinary-Passw0rd', { breaks: ['mv'] })]) {
      try {
        expect(result.stderr).toContain('PGPASSFILE');
        expect(result.stderr).toContain('DATA_FOUNDRY_MIGRATION_DATABASE_URL');
        expect(result.stderr).toContain('may be stale');
      } finally {
        cleanup(result);
      }
    }
  });

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
