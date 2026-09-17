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
#
# The login is the name that AUTHENTICATES, which is not always the database
# role: a Supavisor pooler expects a project-qualified login. The runner
# separately asserts that the session resolves to df_migration and refuses the
# run otherwise, so a wrong login fails closed rather than migrating as someone
# else.
set -euo pipefail

readonly PROGRAM="${0##*/}"

die() {
  printf '%s: %s\n' "$PROGRAM" "$1" >&2
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

while [ "$#" -gt 0 ]; do
  case "$1" in
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

[ -n "$host" ] || die 'required: --host'
[ -n "$database" ] || die 'required: --database'
[ -n "$login" ] || die 'required: --login'
case "$port" in
  ''|*[!0-9]*) die "--port must be a number, got: $port" ;;
esac

if [ -z "$target" ]; then
  target="${HOME:?HOME is not set}/.data-foundry/ua002.pgpass"
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
# Covers failure and interruption alike: the temporary file holds the password,
# so it must not survive either.
trap cleanup EXIT INT TERM

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
mv -- "$temporary" "$target" || die "could not install $target"
temporary=''

printf 'Wrote %s for %s at %s:%s/%s\n' "$target" "$login" "$host" "$port" "$database" >&2
printf '\n' >&2
printf 'Then, in the shell that runs the migration:\n' >&2
printf '\n' >&2
printf "export PGPASSFILE='%s'\n" "$target"
printf "export DATA_FOUNDRY_MIGRATION_DATABASE_URL='postgresql://%s@%s:%s/%s'\n" \
  "$login" "$host" "$port" "$database"
