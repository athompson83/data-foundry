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
# PGPASSWORD unset, PGPASSFILE and DATA_FOUNDRY_MIGRATION_DATABASE_URL set, the
# password file present, a regular file and owner-only, and the URL carrying no
# password. It exits non-zero on any of those, so a procedure that chains it
# stops instead of silently reusing settings left over from an earlier attempt.
#
# PGPASSWORD is checked first because it OVERRIDES the password file rather than
# merely competing with it, so every other check would be reporting on a file
# the driver is not going to read.
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

  # Remove the staged credential BEFORE summarising, because the summary's
  # wording depends on whether that succeeded: a run that cannot establish the
  # secret is gone must not print a line that reads as an all-clear.
  cleanup_and_report

  # The lead-in has three cases.
  #
  #   --check      nothing was being installed in the first place, and --check
  #                runs AFTER the credential is in place, so "nothing was
  #                installed" would read as though the credential step failed.
  #   residual     the target was not installed, but the staged copy of the
  #                password could not be shown to be gone. Never an all-clear.
  #   otherwise    nothing was installed and nothing was left behind.
  #
  # The trailing sentence is common to all three: this shell may still carry
  # values exported by an earlier attempt, and the next migration command would
  # use them without saying so. Naming them is the difference between a failure
  # that stops and a failure that quietly proceeds against stale settings.
  if [ "${mode:-write}" = 'check' ]; then
    printf '%s: the environment was rejected; the migration must not be run against it.' "$PROGRAM" >&2
  elif [ "${residual:-false}" = 'true' ]; then
    printf '%s: %s was not installed, but secret-bearing temporary material may remain (see above).' \
      "$PROGRAM" "${target:-the password file}" >&2
  else
    printf '%s: nothing was installed.' "$PROGRAM" >&2
  fi
  printf ' If PGPASSFILE, DATA_FOUNDRY_MIGRATION_DATABASE_URL or PGPASSWORD were exported earlier in this shell they are still set and may be stale; unset all three before running the migration.\n' >&2
  exit 1
}

# Cleanup is a security outcome, so it gets a status and a voice.
#
# The predecessor ran `rm -f` and then `return 0` unconditionally, so a removal
# that failed could not affect anything: the helper reported "nothing was
# installed" while a mode-0600 file holding the complete password line stayed on
# disk at a path it never named. `rm -f` suppresses "no such file", which is
# wanted, but it does not suppress EACCES -- and neither did anything else read
# its status.
#
# `residual` is true only when the file is still THERE after the attempt, so a
# removal that raced with something else deleting it is not reported as a leak.
cleanup() {
  [ -n "${temporary:-}" ] || return 0

  # Destroy the SECRET before trying to destroy the FILE.
  #
  # Truncating needs write permission on the file, which this run owns at 0600.
  # Unlinking needs write permission on the containing DIRECTORY -- which is
  # precisely what is missing in the case this guards. So emptying first turns
  # "the password is still on disk" into "an empty file is still on disk" even
  # when the removal cannot succeed. Reporting the leak accurately is not enough
  # on its own: the bytes have to go.
  #
  # Only truncate something that already exists; `: >` on a path whose file is
  # already gone would CREATE one, and a later failed `rm` would then report a
  # residual file this function had conjured.
  if [ -e "$temporary" ]; then
    : > "$temporary" 2>/dev/null || true
  fi

  rm -f -- "$temporary" 2>/dev/null || true
  if [ -e "$temporary" ]; then
    residual='true'
    # `-s` is true only for a file of non-zero size, so this is set only when the
    # truncation ALSO failed and the password may still be readable.
    if [ -s "$temporary" ]; then
      residual_bytes='true'
    fi
    return 1
  fi
  temporary=''
  return 0
}

# Says it once, however many paths lead here.
cleanup_and_report() {
  cleanup || true
  if [ "${residual:-false}" = 'true' ] && [ "${residual_reported:-false}" != 'true' ]; then
    residual_reported='true'
    printf '%s: WARNING: the temporary password file MAY STILL EXIST: %s\n' \
      "$PROGRAM" "${temporary:-unknown}" >&2
    if [ "${residual_bytes:-false}" = 'true' ]; then
      printf '%s: it holds the migration password in clear text and could not be emptied. Delete it yourself before continuing, and treat that password as exposed.\n' \
        "$PROGRAM" >&2
    else
      printf '%s: it was emptied first, so no password bytes remain in it, but it could not be removed. Delete it yourself when you can.\n' \
        "$PROGRAM" >&2
    fi
  fi
  return 0
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
  # PGPASSWORD wins over PGPASSFILE: pg reads it into the connection password,
  # and only consults pgpass when that password is still null. Measured against
  # a live TLS PostgreSQL 16 with scram-sha-256 -- a CORRECT password file plus
  # a stale PGPASSWORD fails to authenticate. So a leftover PGPASSWORD makes
  # this whole procedure advisory, and the gate has to reject it rather than
  # report on a file the driver will not read.
  [ -z "${PGPASSWORD:-}" ] ||
    die 'PGPASSWORD is set; it overrides PGPASSFILE and the migration would authenticate with it instead. Run: unset PGPASSWORD'
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
  printf '%s: environment is ready (PGPASSWORD unset, PGPASSFILE present and owner-only, URL carries no password)\n' \
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
# Only restrict a directory this run creates. A --file target may point into a
# directory someone else owns and shares, and tightening it here would revoke
# other people's access to unrelated contents -- including on a run that then
# declines to write anything. The password file itself is created 0600, so a
# permissive directory does not expose its contents.
if [ -d "$directory" ]; then
  :
else
  mkdir -p -- "$directory" || die "could not create $directory"
  chmod 700 -- "$directory" 2>/dev/null || true
fi

# Refuse a directory other local users can write to.
#
# mktemp creates the staged file safely -- O_EXCL, a name nobody can predict --
# but the redirection that writes the password resolves that name a SECOND
# time. Between the two, a user with write access to this directory can unlink
# the entry and leave a symlink of their own in its place; the password line is
# then written through the link, `mv` installs the link as $target, and the
# helper prints "Wrote" and exits 0. Nothing about the run says the credential
# went somewhere the operator did not choose.
#
# Shell redirection cannot be made race-safe against that. Tightening the
# directory instead is not available either: a --file target may live in a
# directory someone else owns and shares, and revoking other people's access to
# unrelated contents is the defect an earlier round already fixed. So this
# refuses. Where only the owner can write, no other user can create, unlink or
# rename an entry and the race has no second player.
#
# The default path is unaffected: ~/.data-foundry is created 0700 above, and an
# existing one is typically 0700 or 0755 -- neither is group- or world-writable.
# This check runs on BOTH branches, so it also binds the chmod above, whose
# failure is otherwise swallowed.
#
# The checks below run against the PHYSICAL directory, not the name the
# operator typed: a name can traverse symlinks, and inspecting the name while
# staging into what it points at would be checking a different directory from
# the one the password lands in. Messages keep naming `$directory`, because
# that is the path the operator can act on.
physical_directory="$(cd -P -- "$directory" 2>/dev/null && pwd -P)" ||
  die "could not resolve $directory; refusing to stage a password file in a directory this run cannot inspect"
[ -n "$physical_directory" ] ||
  die "could not resolve $directory; refusing to stage a password file in a directory this run cannot inspect"

# Who this run actually is, for the ownership checks. Bash computes EUID
# itself, so unlike `id -u` there is no child process to fail and no status to
# go unread -- but it is still validated rather than trusted, because an
# ownership comparison against an empty string would silently match nothing
# and, read the other way, could match everything.
effective_uid="${EUID-}"
case "$effective_uid" in
  ''|*[!0-9]*) die 'could not determine the effective user id; refusing to stage a password file' ;;
esac

# Mode and numeric owner of one directory, or a non-zero status.
#
# Numeric, because a name is a lookup that can fail, collide, or differ
# between the passwd database and the comparison this makes.
#
# Nothing here is read until its shape is proven. A listing this run could not
# obtain, or one whose fields are not a directory mode followed by numeric link
# and owner counts, is UNKNOWN -- and unknown is not acceptable. That is the
# same rule the mode check below has always applied, extended to the owner,
# because a check that computes the right answer and then does not bind is the
# defect this helper keeps producing.
inspected_mode=''
inspected_owner=''
inspect_directory() {
  inspected_mode=''
  inspected_owner=''
  local listing mode links owner
  listing="$(ls -ldn -- "$1" 2>/dev/null)" || return 1
  # `read` splits on IFS, which is the field split `ls` intends, and unlike an
  # unquoted expansion it does no pathname expansion -- so a directory whose
  # name contains a glob character cannot reshape the line being parsed. It
  # takes the first line, so extra output cannot smuggle a second answer past
  # the checks below.
  read -r mode links owner _ <<<"$listing" || return 1
  case "$mode" in
    d?????????*) : ;;
    *) return 1 ;;
  esac
  # The link count and the numeric owner must EACH be a number. Checked
  # separately rather than concatenated: `2` and an empty owner concatenate to
  # `2`, which is all digits, so a short line would have passed a joint check
  # and left the owner empty -- failing closed further down, but reporting
  # `owned by uid ` with nothing in it.
  case "$links" in
    ''|*[!0-9]*) return 1 ;;
  esac
  case "$owner" in
    ''|*[!0-9]*) return 1 ;;
  esac
  inspected_mode="$mode"
  inspected_owner="$owner"
  return 0
}

inspect_directory "$physical_directory" ||
  die "could not read the permissions of $directory; refusing to stage a password file where the permissions are unknown"
directory_mode="$inspected_mode"
directory_owner="$inspected_owner"

# Position 6 is group-write and position 9 is other-write, the same reading the
# --check branch above does with `cut -c5-10`.
case "$directory_mode" in
  ?????w*|????????w*)
    die "$directory can be written by other users (mode $directory_mode); another local user could replace the staged password file before it is written, so the password could land somewhere this helper does not control. Point --file at a directory only you can write to, or remove group and world write access from $directory"
    ;;
esac

# Refuse a staging directory this run does not OWN.
#
# The mode check above reads the group- and other-write bits, which is not the
# same as establishing that only this run can write here. A directory owned by
# another user at mode 0755 passes it, and that owner can still unlink an entry
# staged inside — ownership of the directory carries the right to remove its
# contents regardless of who created them. The case that matters in practice is
# a root run staging into a user-owned directory: root has write access it does
# not own, the mode looks unremarkable, and the directory's owner wins the same
# race the mode check exists to prevent.
#
# An owner check is available here in a way that tightening the mode is not: it
# refuses rather than modifies, so a directory someone else owns and shares is
# left exactly as it was.
[ "$directory_owner" = "$effective_uid" ] ||
  die "$directory is owned by uid $directory_owner, not by uid $effective_uid which is running this; its owner could replace the staged password file before it is written. Point --file at a directory you own"

# Walk the ancestors, so the staging directory cannot be SUBSTITUTED.
#
# Every check so far describes the staging directory itself. None of them says
# anything about how that directory is reached. If an ancestor is writable by
# another user, that user can rename the staging directory aside and put their
# own in its place — owned by them, mode 0700, passing the owner check for
# THEIR uid but not ours — or, where the run creates it, win the directory
# outright. The password then lands in a directory the operator never chose,
# and the run reports success.
#
# Two conditions make an ancestor safe, and both are required:
#
#   owner    uid 0 or this run's own uid. Root is trusted because a hostile
#            root needs none of this; any other user is a second player.
#   writers  no group- or other-write bit, OR the sticky bit. Sticky is not a
#            relaxation: in a sticky directory only an entry's owner, the
#            directory's owner and root may rename or unlink it, and the entry
#            in question is the next component down, which this same loop has
#            already established is owned by root or by us. /tmp is 1777 and
#            has to keep working; a world-writable ancestor WITHOUT the sticky
#            bit is the case that does not.
#
# The staging directory itself is held to the stricter rule above, without the
# sticky exemption, because a new entry is CREATED there rather than merely
# reached.
ancestor="$physical_directory"
while [ "$ancestor" != '/' ]; do
  ancestor="${ancestor%/*}"
  [ -n "$ancestor" ] || ancestor='/'

  inspect_directory "$ancestor" ||
    die "could not read the permissions of $ancestor, an ancestor of $directory; refusing to stage a password file below a directory whose permissions are unknown"

  [ "$inspected_owner" = '0' ] || [ "$inspected_owner" = "$effective_uid" ] ||
    die "$ancestor, an ancestor of $directory, is owned by uid $inspected_owner; its owner could replace $directory with a directory of their own before the password is written. Point --file below a directory you own"

  case "$inspected_mode" in
    ?????w*|????????w*)
      case "$inspected_mode" in
        # Position 10 carries the sticky bit as `t` or `T`.
        ?????????[tT]*) : ;;
        *)
          die "$ancestor, an ancestor of $directory, can be written by other users (mode $inspected_mode) and is not sticky, so another local user could replace $directory itself before the password is written. Point --file below a directory only you can write to"
          ;;
      esac
      ;;
  esac
done

# Write through the chain that was actually checked.
#
# Everything above inspects the PHYSICAL directory; everything below would
# otherwise have gone on using the name the operator typed, and the two are
# only the same until a symlink in that name is swapped. `--file
# /tmp/shared/link/ua002.pgpass`, where `/tmp/shared` is world-writable and
# `link` points at a directory of the operator's own, passes every check above
# -- the resolved chain really is safe -- and then `mktemp` and `mv` resolve
# `link` again, so another local user can point it somewhere else in between
# and take the password. Checking one directory and writing to another is the
# same defect as a check that does not bind, arriving by way of the path.
#
# So the staged file and the installed file both go through the resolved path,
# every component of which the loop above has just accounted for. The basename
# is kept as given; it is the last component and is never resolved as a
# directory. Messages keep using `$directory`, which is what the operator
# typed and can act on.
staging_directory="$physical_directory"
target_name="${target##*/}"
# A `--file` ending in `/` names no file. Before this rebinding it produced a
# `mv` into a directory, which GNU `mv -T` refuses and BSD `mv` does not --
# installing the password under the temporary file's random name. Rejected
# outright, the same way a directory target already is.
[ -n "$target_name" ] ||
  die "--file must name a file, not a directory path ending in '/': $target"
target="$staging_directory/$target_name"

# Read before touching anything, so a cancelled prompt changes nothing at all.
if [ -t 0 ]; then
  IFS= read -rs -p 'migration password: ' password || die 'no password was read; nothing was written'
  printf '\n' >&2
else
  IFS= read -r password || die 'no password was read; nothing was written'
fi
[ -n "$password" ] || die 'the password was empty; nothing was written'

# Escape every field BEFORE anything is created, and make each failure bind.
#
# `printf '%s' "$(escape_field "$x")"` reports the status of printf, never of
# the substitution, so `set -e` cannot see a sed that failed -- and the pipeline
# status that `pipefail` computes is discarded with the subshell. A sed that
# cannot run therefore produced `::::` and a "Wrote ..." message at exit 0, and
# a sed that failed for the password alone produced a file with an EMPTY
# password: the precise thing this helper exists to make impossible, arriving
# through a different door. An assignment is the form that binds, because its
# status IS the substitution's.
escape_or_die() {
  # $1 names the field, for a message that says which one went wrong.
  local escaped
  escaped="$(escape_field "$2")" || die "could not escape the $1 for the password file"
  # sed can also exit 0 having written nothing -- a truncated write, a closed
  # pipe. Every input here is already known non-empty and escaping only ever
  # adds characters, so an empty result is a failure whatever the status said.
  [ -n "$escaped" ] || die "escaping the $1 produced nothing; nothing was written"
  printf '%s' "$escaped"
}

escaped_host="$(escape_or_die 'host' "$host")" || exit 1
escaped_port="$(escape_or_die 'port' "$port")" || exit 1
escaped_database="$(escape_or_die 'database' "$database")" || exit 1
escaped_login="$(escape_or_die 'login' "$login")" || exit 1
escaped_password="$(escape_or_die 'password' "$password")" || exit 1

temporary=''
# Where the run got to, so an interrupt can report what actually happened rather
# than assuming. A signal is serviced between commands, so it can land after the
# rename has already committed.
stage='start'
# Set by cleanup() when the staged credential could not be shown to be gone.
residual='false'
# True only when the staged file survived AND could not be emptied, which is the
# difference between an empty file left behind and a credential left behind.
residual_bytes='false'
residual_reported='false'

# A signal handler that only cleans up and returns is worse than none: the shell
# resumes the script afterwards, the redirection below recreates the file that
# was just deleted, and the run continues to install it and report success. So
# the signal handlers clean up and then leave, while EXIT keeps the ordinary
# cleanup for every other way out.
on_signal() {
  trap - EXIT
  case "$stage" in
    installed)
      printf '%s: interrupted, but %s was already replaced. Verify with --check.\n' \
        "$PROGRAM" "$target" >&2
      ;;
    staged)
      if [ -n "$temporary" ] && [ -e "$temporary" ]; then
        cleanup_and_report
        if [ "$residual" = 'true' ]; then
          printf '%s: interrupted; %s was not installed, but secret-bearing temporary material may remain (see above).\n' \
            "$PROGRAM" "$target" >&2
        else
          printf '%s: interrupted; nothing was installed.\n' "$PROGRAM" >&2
        fi
      else
        # The temporary file is gone but the run never reached the point after
        # the rename, so the rename may or may not have committed. Say so
        # rather than guess: claiming "nothing was installed" over a replaced
        # credential is the more damaging of the two errors.
        printf '%s: interrupted during the final rename; %s may or may not have been replaced. Verify with --check.\n' \
          "$PROGRAM" "$target" >&2
      fi
      ;;
    *)
      cleanup_and_report
      if [ "$residual" = 'true' ]; then
        printf '%s: interrupted; nothing was installed, but secret-bearing temporary material may remain (see above).\n' \
          "$PROGRAM" >&2
      else
        printf '%s: interrupted; nothing was installed.\n' "$PROGRAM" >&2
      fi
      ;;
  esac
  exit "$1"
}
trap cleanup_and_report EXIT
trap 'on_signal 130' INT
trap 'on_signal 143' TERM

temporary="$(mktemp -- "$staging_directory/.ua002.pgpass.XXXXXX")" ||
  die "could not create a temporary file in $directory"
stage='staged'

# Permissions first: the file must never be readable by anyone else, not even
# for the instant between writing and chmod.
chmod 600 -- "$temporary" || die 'could not restrict the temporary file'

printf '%s:%s:%s:%s:%s\n' \
  "$escaped_host" \
  "$escaped_port" \
  "$escaped_database" \
  "$escaped_login" \
  "$escaped_password" > "$temporary" ||
  die 'could not write the password file'

unset password escaped_password

# Only now does anything become visible under the real name. A failure above
# leaves the existing file, if any, exactly as it was.
# Re-checked here because the up-front test and the move are not atomic.
[ -d "$target" ] && die "$target became a directory; nothing was installed"
if [ "$mv_no_target_directory" = 'true' ]; then
  mv -T -- "$temporary" "$target" || die "could not install $target"
else
  mv -- "$temporary" "$target" || die "could not install $target"
fi
stage='installed'
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
