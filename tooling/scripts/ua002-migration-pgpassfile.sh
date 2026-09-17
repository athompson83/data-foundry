#!/usr/bin/env bash
#
# Write the dedicated PostgreSQL password file for the UA-002 direct-TLS
# migration run.
#
# This exists because the procedure it replaces edited the operator's own
# ~/.pgpass, and six review rounds found six distinct ways that quietly went
# wrong: a stale entry winning on libpq's first-match rule, a stale wildcard
# winning for the same reason, metacharacters corrupting the field structure, a
# cancelled prompt installing an empty password, and a failed rewrite being
# installed anyway. Every one of those is a consequence of mutating a shared
# file that belongs to someone else.
#
# This writes ONE file that belongs to this project and never reads, rewrites,
# or removes ~/.pgpass. The whole class is gone by construction rather than by
# handling each case.
#
# The password is read from a prompt, never from an argument or the
# environment, so it cannot reach the process list or shell history. The file it
# writes is the only place it lands.
#
# Usage:
#   ua002-migration-pgpassfile.sh --host HOST --database DB --login LOGIN \
#       [--port PORT] [--file PATH]
#   ua002-migration-pgpassfile.sh --check
#
# --check verifies the environment the migration will actually run under:
# PGPASSFILE and DATA_FOUNDRY_MIGRATION_DATABASE_URL set, the password file
# present, a regular file and owner-only, and the URL carrying no password. It
# exits non-zero on any of those, so a procedure that chains it stops instead of
# silently reusing settings left over from an earlier attempt.
#
# The login is the name that AUTHENTICATES, which is not always the database
# role: a Supavisor pooler expects a project-qualified login. The runner
# separately asserts that the session resolves to df_migration and refuses the
# run otherwise, so a wrong login fails closed rather than migrating as someone
# else.
set -euo pipefail

# Defence in depth for the password file. Every path that creates it also sets
# its mode explicitly, but a redirection that recreates a file inherits the
# ambient umask instead, and the ambient umask is commonly 022.
umask 077

readonly PROGRAM="${0##*/}"

die() {
  printf '%s: %s\n' "$PROGRAM" "$1" >&2
  # Nothing was installed, but this shell may still carry values exported by an
  # earlier attempt, and the next migration command would use them without
  # saying so. Naming them is the difference between a failure that stops and a
  # failure that quietly proceeds against stale settings.
  printf '%s: nothing was installed. If PGPASSFILE or DATA_FOUNDRY_MIGRATION_DATABASE_URL were exported earlier in this shell they are still set and may be stale; unset both before running the migration.\n' \
    "$PROGRAM" >&2
  exit 1
}

usage() {
  sed -n '/^# Usage:/,/^#$/p' "$0" | sed 's/^# \{0,1\}//'
}

host=''
database=''
login=''
port='5432'
target=''
mode='write'

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check) mode='check'; shift ;;
    --host) host="${2-}"; shift 2 || die 'missing value for --host' ;;
    --database) database="${2-}"; shift 2 || die 'missing value for --database' ;;
    --login) login="${2-}"; shift 2 || die 'missing value for --login' ;;
    --port) port="${2-}"; shift 2 || die 'missing value for --port' ;;
    --file) target="${2-}"; shift 2 || die 'missing value for --file' ;;
    -h|--help) usage; exit 0 ;;
    # A password supplied this way would be in the process list and in history.
    --password|--password=*) die 'refusing a password on the command line; it is read from a prompt' ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [ "$mode" = 'check' ]; then
  [ -n "${PGPASSFILE:-}" ] ||
    die 'PGPASSFILE is not set; run the credential step and the exports it printed'
  [ -n "${DATA_FOUNDRY_MIGRATION_DATABASE_URL:-}" ] ||
    die 'DATA_FOUNDRY_MIGRATION_DATABASE_URL is not set; run the exports the credential step printed'
  [ -e "$PGPASSFILE" ] || die "PGPASSFILE names something that does not exist: $PGPASSFILE"
  [ -f "$PGPASSFILE" ] || die "PGPASSFILE is not a regular file: $PGPASSFILE"
  mode_bits="$(ls -l -- "$PGPASSFILE" | cut -c5-10)"
  [ "$mode_bits" = '------' ] || die "PGPASSFILE is readable by others: $PGPASSFILE"
  # A password would sit in the userinfo, before the @ and after a colon.
  userinfo="${DATA_FOUNDRY_MIGRATION_DATABASE_URL#*//}"
  userinfo="${userinfo%%@*}"
  case "$userinfo" in
    *:*) die 'DATA_FOUNDRY_MIGRATION_DATABASE_URL carries a password; it must read the password from PGPASSFILE' ;;
  esac
  printf '%s: environment is ready (PGPASSFILE present and owner-only, URL carries no password)\n' \
    "$PROGRAM" >&2
  exit 0
fi

[ -n "$host" ] || die 'required: --host'
[ -n "$database" ] || die 'required: --database'
[ -n "$login" ] || die 'required: --login'
case "$port" in
  ''|*[!0-9]*) die "--port must be a number, got: $port" ;;
esac

if [ -z "$target" ]; then
  target="${HOME:?HOME is not set}/.data-foundry/ua002.pgpass"
fi

# `mv source directory` moves the source INTO the directory and succeeds, which
# would leave PGPASSFILE pointing at a directory while the password sat in a
# randomly named file inside it — reported as success. `-T` would cover this but
# is not portable, so reject it outright.
if [ -d "$target" ]; then
  # `-d` follows symlinks, so this covers a link pointing at a directory too.
  if [ -L "$target" ]; then
    die "$target is a symlink to a directory, not a password file"
  fi
  die "$target is a directory, not a password file"
fi

# `mv source directory` moves the source INTO the directory and succeeds. GNU mv
# refuses that with -T; BSD mv has no equivalent, so probe once and fall back to
# re-checking immediately before the move.
mv_no_target_directory='false'
if mv --help 2>/dev/null | grep -q -- '--no-target-directory'; then
  mv_no_target_directory='true'
fi


# `:` separates fields in a password file and `\` escapes; a value containing
# either must be escaped or libpq reads the line as a different shape.
escape_field() {
  printf '%s' "$1" | sed -e 's/[\\:]/\\&/g'
}

directory="$(dirname -- "$target")"
mkdir -p -- "$directory" || die "could not create $directory"
chmod 700 -- "$directory" 2>/dev/null || true

# Read before touching anything, so a cancelled prompt changes nothing at all.
if [ -t 0 ]; then
  IFS= read -rs -p 'migration password: ' password || die 'no password was read; nothing was written'
  printf '\n' >&2
else
  IFS= read -r password || die 'no password was read; nothing was written'
fi
[ -n "$password" ] || die 'the password was empty; nothing was written'

temporary=''
cleanup() {
  [ -n "$temporary" ] && rm -f -- "$temporary"
  return 0
}

# A signal handler that only cleans up and returns is worse than none: the shell
# resumes the script afterwards, the redirection below recreates the file that
# was just deleted, and the run continues to install it and report success. So
# the signal handlers clean up and then leave, while EXIT keeps the ordinary
# cleanup for every other way out.
on_signal() {
  cleanup
  trap - EXIT
  printf '%s: interrupted; nothing was installed.\n' "$PROGRAM" >&2
  exit "$1"
}
trap cleanup EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

temporary="$(mktemp -- "$directory/.ua002.pgpass.XXXXXX")" ||
  die "could not create a temporary file in $directory"

# Permissions first: the file must never be readable by anyone else, not even
# for the instant between writing and chmod.
chmod 600 -- "$temporary" || die 'could not restrict the temporary file'

printf '%s:%s:%s:%s:%s\n' \
  "$(escape_field "$host")" \
  "$(escape_field "$port")" \
  "$(escape_field "$database")" \
  "$(escape_field "$login")" \
  "$(escape_field "$password")" > "$temporary" ||
  die 'could not write the password file'

unset password

# Only now does anything become visible under the real name. A failure above
# leaves the existing file, if any, exactly as it was.
# Re-checked here because the up-front test and the move are not atomic.
[ -d "$target" ] && die "$target became a directory; nothing was installed"
if [ "$mv_no_target_directory" = 'true' ]; then
  mv -T -- "$temporary" "$target" || die "could not install $target"
else
  mv -- "$temporary" "$target" || die "could not install $target"
fi
temporary=''

printf 'Wrote %s for %s at %s:%s/%s\n' "$target" "$login" "$host" "$port" "$database" >&2
printf '\n' >&2
printf 'Then, in the shell that runs the migration:\n' >&2
printf '\n' >&2
# The operator is told to run these verbatim, so they must survive a value that
# contains a quote — a HOME like /home/o'connor produced an unterminated string.
printf 'export PGPASSFILE=%q\n' "$target"
printf 'export DATA_FOUNDRY_MIGRATION_DATABASE_URL=%q\n' \
  "postgresql://$login@$host:$port/$database"
