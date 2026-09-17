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
  chownSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
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
  /** Let the stubbed command do its real work first, then signal. */
  readonly interruptAfterRealWork?: boolean;
  /** Create the target path as a directory before running. */
  readonly targetIsDirectory?: boolean;
  /** Use a HOME containing a single quote. */
  readonly awkwardHome?: boolean;
  /** Put the target behind a symlink pointing at a directory. */
  readonly targetIsSymlinkToDirectory?: boolean;
  /** Extra environment for the child. */
  readonly env?: Readonly<Record<string, string>>;
  /** Replace commands with arbitrary stub bodies, for failures a flat stub cannot express. */
  readonly stubScripts?: Readonly<Record<string, string>>;
  /** Create `$HOME/shared` with this mode and point `--file` inside it. */
  readonly parentMode?: number;
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

  const parentArgs: string[] = [];
  if (options.parentMode !== undefined) {
    const shared = join(home, 'shared');
    mkdirSync(shared);
    // mkdir applies the ambient umask, so set the mode we actually want to test.
    chmodSync(shared, options.parentMode);
    parentArgs.push('--file', join(shared, 'ua002.pgpass'));
  }

  let path = process.env['PATH'] ?? '/usr/bin:/bin';
  const stubbed = [...(options.breaks ?? [])];
  const stubScripts = Object.entries(options.stubScripts ?? {});
  if (stubbed.length > 0 || stubScripts.length > 0 || options.interruptDuring !== undefined) {
    const stubs = join(home, 'stubs');
    mkdirSync(stubs);
    for (const [command, body] of stubScripts) {
      writeFileSync(join(stubs, command), body);
      chmodSync(join(stubs, command), 0o755);
    }
    for (const command of stubbed) {
      writeFileSync(join(stubs, command), `#!/bin/bash\necho "${command}: injected failure" >&2\nexit 7\n`);
      chmodSync(join(stubs, command), 0o755);
    }
    if (options.interruptDuring !== undefined) {
      // Succeeds, but signals the script first — so the handler runs at a point
      // where the script would otherwise carry on.
      writeFileSync(
        join(stubs, options.interruptDuring),
        options.interruptAfterRealWork === true
          ? `#!/bin/bash\n/bin/${options.interruptDuring} "$@"\nkill -INT "$PPID" 2>/dev/null\nexit 0\n`
          : '#!/bin/bash\nkill -INT "$PPID" 2>/dev/null\nexit 0\n',
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
    ...parentArgs,
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

  it('refuses while PGPASSWORD is set, because it overrides the password file', () => {
    // Not a competing source -- an overriding one. `pg` reads PGPASSWORD into
    // the connection password and consults pgpass only when that is still null,
    // so every other check here would be reporting on a file the driver never
    // reads. Measured against a live TLS PostgreSQL 16 with scram-sha-256: a
    // CORRECT password file plus a stale PGPASSWORD fails to authenticate.
    const result = run('ordinary-Passw0rd');
    try {
      const outcome = check(
        {
          PGPASSFILE: targetPath(result.home),
          DATA_FOUNDRY_MIGRATION_DATABASE_URL: okUrl,
          PGPASSWORD: 'STALE-ENV-SECRET',
        },
        result.home,
      );
      expect(outcome.status, 'a set PGPASSWORD must fail the gate').not.toBe(0);
      expect(outcome.stderr).toContain('PGPASSWORD');
      expect(outcome.stderr).toContain('unset PGPASSWORD');
    } finally {
      cleanup(result);
    }
  });

  it('still passes when PGPASSWORD is present but empty', () => {
    // An exported-but-empty PGPASSWORD is not a credential, and `pg` treats it
    // as absent. Refusing it would block a shell that had merely cleared it.
    const result = run('ordinary-Passw0rd');
    try {
      const outcome = check(
        {
          PGPASSFILE: targetPath(result.home),
          DATA_FOUNDRY_MIGRATION_DATABASE_URL: okUrl,
          PGPASSWORD: '',
        },
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

  it('does not claim nothing was installed when the rename already committed', () => {
    // A signal is serviced between commands, so it can land after `mv` has
    // completed. Reported "nothing was installed" over a replaced credential,
    // which is the more damaging of the two possible wrong answers.
    const result = run('NEW-PASSWORD', {
      interruptDuring: 'mv',
      interruptAfterRealWork: true,
      seedTarget: 'old:5432:old:old:OLD-PASSWORD',
    });
    try {
      expect(result.status, 'an interrupted run must still fail').not.toBe(0);
      expect(result.stderr).not.toContain('nothing was installed');
      expect(result.stderr).toContain('may or may not have been replaced');
      expect(result.stderr).toContain('--check');
      // The rename did commit, so the file must hold the new password. Read it
      // directly: a failed run does not populate `lines`.
      const installed = readFileSync(targetPath(result.home), 'utf8').replace(/\n$/u, '');
      expect(parsePgpassLine(installed)[4]).toBe('NEW-PASSWORD');
    } finally {
      cleanup(result);
    }
  });

  it('never changes the mode of a directory it did not create', () => {
    // A --file target may live in a directory someone else owns and shares.
    // Tightening it -- especially on a run that then writes nothing -- revokes
    // other people's access to unrelated contents.
    const outer = mkdtempSync(join(tmpdir(), 'ua002-shared-'));
    const shared = join(outer, 'shared');
    mkdirSync(shared);
    chmodSync(shared, 0o755);
    const target = join(shared, 'ua002.pgpass');
    const invoke = (input: string): number => {
      try {
        execFileSync('bash', [HELPER, '--host', 'h', '--database', 'd', '--login', 'l', '--file', target], {
          env: { HOME: outer, PATH: process.env['PATH'] ?? '/usr/bin:/bin' },
          input,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        return 0;
      } catch (error) {
        return (error as { status?: number }).status ?? -1;
      }
    };
    try {
      expect(invoke(''), 'a cancelled run must fail').not.toBe(0);
      expect(
        (statSync(shared).mode & 0o777).toString(8),
        'a cancelled run changed a shared directory',
      ).toBe('755');
      expect(invoke('pw\n')).toBe(0);
      expect(
        (statSync(shared).mode & 0o777).toString(8),
        'a successful run changed a shared directory',
      ).toBe('755');
      // The file itself still carries the protection that matters.
      expect((statSync(target).mode & 0o777).toString(8)).toBe('600');
    } finally {
      rmSync(outer, { recursive: true, force: true });
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

describe('a failure while escaping a field cannot install a corrupted file', () => {
  // `printf '%s' "$(escape_field "$x")"` reports the status of printf, never of
  // the command substitution, so `set -e` could not see a failing `sed` and the
  // pipeline status `pipefail` computed was discarded with the subshell. Both
  // shapes below were reproduced against the helper at b9ec9b9, installing a
  // file and exiting 0.
  const REAL_SED = '#!/bin/bash\nfor candidate in /usr/bin/sed /bin/sed; do\n  [ -x "$candidate" ] && exec "$candidate" "$@"\ndone\nexit 127\n';

  it('installs nothing when escaping fails for every field', () => {
    // Observed before the fix: a file containing `::::` — five empty fields —
    // with a "Wrote ..." message and exit 0.
    const result = run('SECRET-PASSWORD', { breaks: ['sed'], seedPgpass: true });
    try {
      expect(result.status, 'a failed escape must not report success').not.toBe(0);
      expect(existsSync(targetPath(result.home)), 'no file may be installed').toBe(false);
      expect(result.stdout).not.toContain('export PGPASSFILE=');
      expect(result.stderr).toMatch(/could not escape the host/u);
      // And the operator's own file is still untouched, as always.
      expect(readFileSync(join(result.home, '.pgpass'), 'utf8')).toBe(`${DECOY}\n`);
    } finally {
      cleanup(result);
    }
  });

  it('installs nothing when escaping fails for the password alone', () => {
    // The dangerous shape, and worse than a file of empty fields: the first
    // four fields escape normally and only the password comes back empty, so
    // the installed line matched the real host and login with an EMPTY
    // password. That is the defect this helper exists to make impossible,
    // arriving through a different door. Observed before the fix as
    // `<host>:5432:<database>:<login-name>:` at exit 0.
    const countingSed = [
      '#!/bin/bash',
      'counter="$(dirname "$0")/sed.count"',
      'n=$(cat "$counter" 2>/dev/null || echo 0)',
      'n=$((n + 1))',
      'printf "%s" "$n" > "$counter"',
      // Fields are escaped left to right: host, port, database, login, password.
      'if [ "$n" -ge 5 ]; then',
      '  echo "sed: injected failure on field $n" >&2',
      '  exit 4',
      'fi',
      'for candidate in /usr/bin/sed /bin/sed; do',
      '  [ -x "$candidate" ] && exec "$candidate" "$@"',
      'done',
      'exit 127',
      '',
    ].join('\n');
    const result = run('SECRET-PASSWORD', {
      stubScripts: { sed: countingSed },
      seedTarget: 'kept:5432:kept:kept:KEEP-ME',
    });
    try {
      expect(result.status, 'a failed escape must not report success').not.toBe(0);
      expect(result.stderr).toMatch(/could not escape the password/u);
      expect(result.stdout).not.toContain('export PGPASSFILE=');
      // An existing credential survives, and nothing empty replaced it.
      expect(readFileSync(targetPath(result.home), 'utf8')).toBe('kept:5432:kept:kept:KEEP-ME\n');
    } finally {
      cleanup(result);
    }
  });

  it('names which field failed, so the message is actionable', () => {
    const result = run('SECRET-PASSWORD', { breaks: ['sed'] });
    try {
      expect(result.stderr).toMatch(/could not escape the (host|port|database|login|password)/u);
      // And still says what it always says about stale exports.
      expect(result.stderr).toContain('may be stale');
    } finally {
      cleanup(result);
    }
  });

  it('still escapes correctly when sed works, so the guard did not replace the behaviour', () => {
    // The control: the stub above is a real `sed` until it decides to fail, and
    // this asserts the ordinary path through the same harness is unchanged.
    const result = run('pa:ss\\wo:rd', { stubScripts: { sed: REAL_SED } });
    try {
      expect(result.status).toBe(0);
      const line = readFileSync(targetPath(result.home), 'utf8').replace(/\n$/u, '');
      expect(parsePgpassLine(line)).toEqual([
        '<host>',
        '5432',
        '<database>',
        '<login-name>',
        'pa:ss\\wo:rd',
      ]);
    } finally {
      cleanup(result);
    }
  });
});

describe('a failed cleanup is a security outcome, not a silent one', () => {
  // The staged temporary file holds the complete password line. `cleanup` ran
  // `rm -f` and then `return 0` unconditionally, so a removal that FAILED could
  // not affect the outcome: the helper printed "nothing was installed" and
  // exited 1 while the credential sat on disk at a path it never named.
  //
  // Reproduced against e9f2735 as an unprivileged user with a stubbed `mv` that
  // made the directory mode 0500 before failing. That real-permission run is in
  // the verification record; root bypasses the directory check, so it cannot be
  // the harness here. Stubbing `rm` reproduces the same compound failure
  // deterministically for any user, which is what these assertions need: the
  // property under test is how the helper responds when removal fails and the
  // secret-bearing file remains.
  const REMAINS = /\.ua002\.pgpass\./u;

  function stagedFiles(home: string): string[] {
    return readdirSync(join(home, '.data-foundry')).filter((name) => REMAINS.test(name));
  }

  it('does not claim nothing was installed when the credential may remain', () => {
    const result = run('SECRET-PASSWORD', { breaks: ['mv', 'rm'] });
    try {
      expect(result.status, 'the run must still fail').not.toBe(0);
      // The file really is still there — this is not a hypothetical.
      expect(stagedFiles(result.home).length, 'the staged file must survive for this test to mean anything').toBe(1);
      expect(
        result.stderr,
        'claiming nothing was installed hides a credential that is still on disk',
      ).not.toMatch(/nothing was installed/u);
    } finally {
      cleanup(result);
    }
  });

  it('says the secret may remain and names the file, without printing it', () => {
    const result = run('SECRET-PASSWORD', { breaks: ['mv', 'rm'] });
    try {
      const [staged] = stagedFiles(result.home);
      expect(staged).toBeDefined();
      expect(result.stderr).toMatch(/may still exist|may remain/iu);
      expect(result.stderr, 'the operator cannot remediate a path they are not given').toContain(
        join(result.home, '.data-foundry', staged as string),
      );
      // Naming the file must not mean printing what is in it.
      expect(result.stderr).not.toContain('SECRET-PASSWORD');
      expect(result.stdout).not.toContain('SECRET-PASSWORD');
    } finally {
      cleanup(result);
    }
  });

  it('leaves no password bytes in a staged file it could not remove', () => {
    // Reporting the leak honestly is not enough on its own. Truncating needs
    // write permission on the FILE (owned here, 0600); unlinking needs it on the
    // DIRECTORY, which is what fails in this case -- so the secret can be
    // destroyed even when the file cannot be. This asserts the bytes, not the
    // wording.
    const result = run('SECRET-PASSWORD', { breaks: ['mv', 'rm'] });
    try {
      const staged = stagedFiles(result.home);
      expect(staged.length, 'the file must survive for this test to mean anything').toBe(1);
      const residualPath = join(result.home, '.data-foundry', staged[0] as string);
      const bytes = readFileSync(residualPath);
      expect(bytes.length, 'a file that could not be removed must at least be empty').toBe(0);
      expect(bytes.toString('utf8')).not.toContain('SECRET-PASSWORD');
      // And the operator is told which of the two situations they are in.
      expect(result.stderr).toMatch(/no password bytes remain/u);
      expect(result.stderr).not.toMatch(/treat that password as exposed/u);
    } finally {
      cleanup(result);
    }
  });

  it('still reports cleanly when the operation fails but cleanup succeeds', () => {
    // The ordinary failure path must not become alarming: only a cleanup that
    // could not be established may warn about a residual secret.
    const result = run('SECRET-PASSWORD', { breaks: ['mv'] });
    try {
      expect(result.status).not.toBe(0);
      expect(stagedFiles(result.home), 'nothing may be left behind here').toEqual([]);
      expect(result.stderr).toContain('nothing was installed');
      expect(result.stderr).not.toMatch(/may still exist|may remain/iu);
      expect(result.stderr).not.toContain('SECRET-PASSWORD');
    } finally {
      cleanup(result);
    }
  });

  it('warns about a residual secret when interrupted and cleanup fails', () => {
    // A signal must not be a way around the same guarantee.
    const result = run('SECRET-PASSWORD', { interruptDuring: 'chmod', breaks: ['rm'] });
    try {
      expect(result.status, 'an interrupted run must still fail').not.toBe(0);
      if (stagedFiles(result.home).length > 0) {
        expect(result.stderr).toMatch(/may still exist|may remain/iu);
        expect(result.stderr).not.toMatch(/nothing was installed/u);
      }
      expect(result.stderr).not.toContain('SECRET-PASSWORD');
    } finally {
      cleanup(result);
    }
  });

  it('never puts the password in output on the ordinary success path', () => {
    const result = run('SECRET-PASSWORD');
    try {
      expect(result.status).toBe(0);
      expect(result.stdout).not.toContain('SECRET-PASSWORD');
      expect(result.stderr).not.toContain('SECRET-PASSWORD');
      expect(stagedFiles(result.home), 'no temporary file may survive a success').toEqual([]);
    } finally {
      cleanup(result);
    }
  });
});

describe('a parent directory other local users can write to is refused', () => {
  // `mktemp` creates the staged file safely -- O_EXCL, an unpredictable name --
  // but the redirection that writes the password resolves that name a SECOND
  // time. In a directory another local user can write to, that user can unlink
  // the entry and leave a symlink of their own in its place between the two
  // steps. The password line is then written through the link, `mv` installs
  // the link as the target, and the helper prints "Wrote" and exits 0, so
  // nothing in the run says the credential went somewhere else.
  //
  // Shell redirection cannot be made race-safe against that, and the helper
  // must not tighten a directory it did not create (the test above pins that).
  // So it refuses: where only the owner can write, no other user can create,
  // unlink or rename an entry and the race has no second player.
  const sharedPath = (home: string): string => join(home, 'shared');

  it('refuses a world-writable parent and stages nothing inside it', () => {
    const result = run('SECRET-PASSWORD', { parentMode: 0o777 });
    try {
      expect(result.status, 'a world-writable parent must fail closed').not.toBe(0);
      expect(result.stderr).toContain('can be written by other users');
      expect(result.stderr).toContain(sharedPath(result.home));
      expect(result.stdout).not.toContain('export PGPASSFILE=');
      expect(
        readdirSync(sharedPath(result.home)),
        'a refused directory must not be left holding staged secret material',
      ).toEqual([]);
      expect(result.stderr).not.toContain('SECRET-PASSWORD');
    } finally {
      cleanup(result);
    }
  });

  it('refuses a group-writable parent', () => {
    // Group-writable is the likelier real case: a shared project directory
    // whose group contains people who are not the operator.
    const result = run('SECRET-PASSWORD', { parentMode: 0o770 });
    try {
      expect(result.status, 'a group-writable parent must fail closed').not.toBe(0);
      expect(result.stderr).toContain('can be written by other users');
      expect(readdirSync(sharedPath(result.home))).toEqual([]);
    } finally {
      cleanup(result);
    }
  });

  it('still writes into a parent only its owner can write to', () => {
    const result = run('SECRET-PASSWORD', { parentMode: 0o700 });
    try {
      expect(result.status).toBe(0);
      const written = join(sharedPath(result.home), 'ua002.pgpass');
      const line = readFileSync(written, 'utf8').replace(/\n$/u, '');
      expect(parsePgpassLine(line)[4]).toBe('SECRET-PASSWORD');
      expect((statSync(written).mode & 0o777).toString(8)).toBe('600');
      expect(
        (statSync(sharedPath(result.home)).mode & 0o777).toString(8),
        'an accepted directory must still not be modified',
      ).toBe('700');
    } finally {
      cleanup(result);
    }
  });

  it('refuses when the parent permissions could not be read at all', () => {
    // The defect this whole file keeps finding is a check that computes the
    // right answer and then does not bind. A mode the run could not read is
    // UNKNOWN, which is not the same as acceptable, so it must stop the run.
    const result = run('SECRET-PASSWORD', { parentMode: 0o700, breaks: ['ls'] });
    try {
      expect(result.status, 'an unreadable mode must fail closed').not.toBe(0);
      expect(result.stderr).toContain('permissions are unknown');
      expect(readdirSync(sharedPath(result.home))).toEqual([]);
    } finally {
      cleanup(result);
    }
  });
});

/**
 * The two residuals the previous round recorded rather than fixed.
 *
 * The mode check above establishes that no other user can WRITE in the staging
 * directory. Neither residual is about writing:
 *
 *   1. Ownership was never read. A directory owned by another user at mode
 *      0755 passed every check, and its owner may unlink entries inside it
 *      whoever created them — so a run with write access it does not own, in
 *      practice a root run staging into a user-owned directory, still loses
 *      the race the mode check exists to win.
 *   2. Only the immediate parent was read. A directory is reached THROUGH its
 *      ancestors, and a world-writable non-sticky ancestor lets another user
 *      rename the staging directory aside and leave their own 0700 directory
 *      in its place — which then passes every check, for them.
 *
 * Both are ordering claims as much as refusal claims: a refusal that happens
 * after the prompt has been answered has already taken the operator's
 * password. So each test below drains whatever is left on stdin and asserts
 * the password line is still sitting there unread.
 */
describe('a staging directory another user owns, or could substitute, is refused', () => {
  /** Not a real account here; any uid that is not this run's own will do. */
  const OTHER_UID = 65534;

  interface StageResult {
    readonly status: number;
    readonly stdout: string;
    readonly stderr: string;
    /** True when the password line was STILL on stdin when the helper exited. */
    readonly passwordUnread: boolean;
  }

  /**
   * Runs the helper, then drains the rest of stdin through `cat`.
   *
   * bash reads a pipe one byte at a time precisely so that what it did not
   * consume is still available to the next command, which makes the order of a
   * refusal against the prompt observable rather than assumed. The password
   * reappearing in the drained output means the helper never reached the
   * prompt; the helper itself never prints it, which the tests above pin.
   */
  function stage(
    home: string,
    file: string,
    options: { readonly stubScripts?: Readonly<Record<string, string>> } = {},
  ): StageResult {
    let path = process.env['PATH'] ?? '/usr/bin:/bin';
    const stubScripts = Object.entries(options.stubScripts ?? {});
    if (stubScripts.length > 0) {
      const stubs = join(home, 'stubs');
      mkdirSync(stubs, { recursive: true });
      for (const [command, body] of stubScripts) {
        writeFileSync(join(stubs, command), body);
        chmodSync(join(stubs, command), 0o755);
      }
      path = `${stubs}:${path}`;
    }

    const wrapper = [
      '-c',
      '"$1" --host "<host>" --database "<database>" --login "<login-name>" --file "$2"; status=$?; cat; exit "$status"',
      'stdin-witness',
      HELPER,
      file,
    ];

    const finish = (status: number, stdout: string, stderr: string): StageResult => ({
      status,
      stdout,
      stderr,
      passwordUnread: stdout.includes('SECRET-PASSWORD'),
    });

    try {
      const stdout = execFileSync('bash', wrapper, {
        env: { HOME: home, PATH: path },
        input: 'SECRET-PASSWORD\n',
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return finish(0, stdout, '');
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return finish(failure.status ?? -1, failure.stdout ?? '', failure.stderr ?? '');
    }
  }

  /** `outer/inner`, with `inner` at 0700 so only the ancestor is in question. */
  function chain(home: string, outerMode: number): { outer: string; inner: string; file: string } {
    const outer = join(home, 'outer');
    const inner = join(outer, 'inner');
    mkdirSync(inner, { recursive: true });
    chmodSync(inner, 0o700);
    chmodSync(outer, outerMode);
    return { outer, inner, file: join(inner, 'ua002.pgpass') };
  }

  function withHome(body: (home: string) => void): void {
    // Resolved, so the paths these tests assert on are the same strings the
    // helper reports: it inspects the physical directory, and a symlinked
    // temporary directory would otherwise make the two disagree.
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'ua002-staging-')));
    try {
      body(home);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }

  it('refuses a staging directory owned by another user, before reading the password', () => {
    withHome((home) => {
      // Constructed from whichever side this run can actually reach, so the
      // refusal is measured rather than assumed in both environments: as root
      // by giving the directory away, and unprivileged by staging into one
      // already owned by root. CI runs unprivileged and takes the second.
      let file: string;
      let owner: number;
      // Optional in Node's types because Windows has no uid. This file runs
      // bash either way, so a missing one takes the unprivileged branch.
      const uid = process.getuid?.() ?? -1;
      if (uid === 0) {
        const shared = join(home, 'shared');
        mkdirSync(shared);
        chmodSync(shared, 0o755);
        chownSync(shared, OTHER_UID, OTHER_UID);
        file = join(shared, 'ua002.pgpass');
        owner = OTHER_UID;
      } else {
        // 0755 and root-owned: every mode check passes, and this run provably
        // does not own it. Nothing is created, so nothing is left behind.
        file = '/ua002.pgpass';
        owner = 0;
      }

      const result = stage(home, file);
      expect(result.status, 'a staging directory owned by another user must fail closed').not.toBe(
        0,
      );
      expect(result.stderr).toContain(`is owned by uid ${owner}`);
      expect(
        result.passwordUnread,
        'the directory must be refused before the password is read',
      ).toBe(true);
      expect(existsSync(file), 'nothing may be staged in a refused directory').toBe(false);
      expect(result.stdout).not.toContain('export PGPASSFILE=');
    });
  });

  it('refuses a world-writable non-sticky ancestor, before reading the password', () => {
    withHome((home) => {
      // The staging directory itself is 0700 and owned by this run, so every
      // check that existed before this round passes. What does not is the
      // directory above it.
      const { outer, inner, file } = chain(home, 0o777);
      const result = stage(home, file);
      expect(result.status, 'a substitutable ancestor must fail closed').not.toBe(0);
      expect(result.stderr).toContain(`${outer}, an ancestor of ${inner}`);
      expect(result.stderr).toContain('is not sticky');
      expect(
        result.passwordUnread,
        'the ancestor must be refused before the password is read',
      ).toBe(true);
      expect(readdirSync(inner), 'nothing may be staged below a refused ancestor').toEqual([]);
    });
  });

  it('refuses a group-writable non-sticky ancestor', () => {
    withHome((home) => {
      // The likelier real shape: a shared project directory whose group holds
      // people who are not the operator.
      const { outer, inner, file } = chain(home, 0o770);
      const result = stage(home, file);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`${outer}, an ancestor of ${inner}`);
      expect(result.passwordUnread).toBe(true);
      expect(readdirSync(inner)).toEqual([]);
    });
  });

  it('still writes below a world-writable ancestor that is sticky, because /tmp is one', () => {
    withHome((home) => {
      // Sticky is not an exemption granted to be convenient. In a sticky
      // directory only an entry's owner, the directory's owner and root may
      // rename or unlink it, and the entry here is the staging directory,
      // which the check above has already established this run owns. Refusing
      // it anyway would refuse /tmp, and with it every supported run whose
      // HOME lives there — including this test suite.
      const { inner, file } = chain(home, 0o1777);
      const result = stage(home, file);
      expect(result.status, 'a sticky ancestor is not substitutable and must be accepted').toBe(0);
      expect(result.passwordUnread, 'the supported path must still read the password').toBe(false);
      const line = readFileSync(file, 'utf8').replace(/\n$/u, '');
      expect(parsePgpassLine(line)[4]).toBe('SECRET-PASSWORD');
      expect((statSync(file).mode & 0o777).toString(8)).toBe('600');
      expect(
        (statSync(inner).mode & 0o777).toString(8),
        'an accepted directory must still not be modified',
      ).toBe('700');
    });
  });

  it('accepts a root-owned ancestor, which is what every supported path has', () => {
    withHome((home) => {
      // The other half of the ownership rule. Root is trusted because a
      // hostile root needs none of this, and refusing it would refuse `/`,
      // `/home` and `/tmp` — every real chain. Asserted here rather than
      // inferred from the tests that happen to pass.
      const { outer, file } = chain(home, 0o755);
      expect(statSync('/').uid, '/ is expected to be root-owned').toBe(0);
      expect(statSync(tmpdir()).uid, 'the temporary directory is expected to be root-owned').toBe(0);
      const result = stage(home, file);
      expect(result.status, 'a chain of root-owned ancestors must be accepted').toBe(0);
      expect(readFileSync(file, 'utf8')).toContain('SECRET-PASSWORD');
      expect(
        (statSync(outer).mode & 0o777).toString(8),
        'an accepted ancestor must not be modified',
      ).toBe('755');
    });
  });

  it('stages through the chain it checked, not through a symlink that can be swapped', () => {
    withHome((home) => {
      // The residual recorded ancestor substitution as scope rather than as a
      // confirmed attack. This is the confirmed version, and it survives an
      // ancestor check on its own: the chain that gets CHECKED is the resolved
      // one — safe, 0700, owned by this run — while the chain that gets
      // WRITTEN is the name the operator typed, which still runs through a
      // world-writable directory. Nothing in the resolved chain is wrong; the
      // two are simply not the same path, and only one of them was verified.
      //
      // The swap is done from a `mktemp` stub rather than a second process, so
      // it lands in the window deterministically instead of being raced for.
      // That is the same technique the interrupt tests above use.
      const safe = join(home, 'safe');
      const attacker = join(home, 'attacker');
      const shared = join(home, 'shared');
      for (const [directory, mode] of [
        [safe, 0o700],
        [attacker, 0o777],
        [shared, 0o777],
      ] as const) {
        mkdirSync(directory);
        chmodSync(directory, mode);
      }
      symlinkSync(safe, join(shared, 'link'));
      const file = join(shared, 'link', 'ua002.pgpass');

      const result = stage(home, file, {
        stubScripts: {
          mktemp: `#!/bin/bash\nln -sfn '${attacker}' '${join(shared, 'link')}'\nexec /bin/mktemp "$@"\n`,
        },
      });

      expect(result.status, 'the resolved chain is safe, so the run must succeed').toBe(0);
      expect(
        readdirSync(attacker),
        'the password must not follow a symlink swapped after the checks',
      ).toEqual([]);
      const written = join(safe, 'ua002.pgpass');
      expect(existsSync(written), 'the password belongs in the directory that was checked').toBe(
        true,
      );
      expect(parsePgpassLine(readFileSync(written, 'utf8').replace(/\n$/u, ''))[4]).toBe(
        'SECRET-PASSWORD',
      );
      // The operator is told where the file physically is, so PGPASSFILE names
      // the checked path too rather than re-entering through the same symlink.
      expect(result.stdout).toContain(`export PGPASSFILE=${written}`);
    });
  });

  it('refuses a --file that ends in a slash and so names no file', () => {
    withHome((home) => {
      // An EXISTING directory is already caught further up by the `-d` test.
      // This is the case that is not: a path ending in `/` that does not
      // exist, where `dirname` strips the slash and the basename is empty.
      // The rebinding onto the resolved path would otherwise have produced a
      // `mv` into a directory — GNU `mv -T` refuses that, BSD `mv` installs
      // the password under the temporary file's random name and reports
      // success.
      const result = stage(home, `${join(home, 'nowhere')}/`);
      expect(result.status, 'a path naming no file must fail closed').not.toBe(0);
      expect(result.stderr).toContain('--file must name a file');
      expect(result.passwordUnread, 'it must be refused before the password is read').toBe(true);
      expect(
        readdirSync(home).filter((entry) => entry.startsWith('.ua002')),
        'nothing may be staged for a rejected target',
      ).toEqual([]);
    });
  });

  it('refuses an ancestor whose permissions could not be read', () => {
    withHome((home) => {
      // An unreadable ancestor is UNKNOWN, and unknown is not acceptable —
      // the same rule the immediate parent has always been held to. The stub
      // fails for one path only, because breaking `ls` outright would stop
      // the run at the staging directory and never reach this branch.
      const { outer, inner, file } = chain(home, 0o755);
      const result = stage(home, file, {
        stubScripts: {
          ls: [
            '#!/bin/bash',
            'for argument in "$@"; do',
            `  if [ "$argument" = '${outer}' ]; then`,
            '    echo "ls: injected failure" >&2',
            '    exit 7',
            '  fi',
            'done',
            'exec /bin/ls "$@"',
            '',
          ].join('\n'),
        },
      });
      expect(result.status, 'an unreadable ancestor must fail closed').not.toBe(0);
      expect(result.stderr).toContain(`could not read the permissions of ${outer}`);
      expect(result.passwordUnread).toBe(true);
      expect(readdirSync(inner)).toEqual([]);
    });
  });
});
