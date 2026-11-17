#!/usr/bin/env bash
set -euo pipefail
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/opt/botly/data" "$root/opt/botly/app" "$root/root/.hermes" "$root/root/botly" "$root/out"
printf 'not-a-real-secret\n' > "$root/opt/botly/app/.env"
printf 'remember me\n' > "$root/root/.hermes/MEMORY.md"
printf 'user files\n' > "$root/root/botly/demo.txt"
python3 - "$root/opt/botly/data/botly.db" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('CREATE TABLE important(id INTEGER)')
    db.execute('INSERT INTO important VALUES (42)')
PY
export BOTLY_BACKUP_SOURCE_ROOT="$root"
export BOTLY_BACKUP_DB_PATH="$root/opt/botly/data/botly.db"
export BOTLY_BACKUP_DIR="$root/out"
KEEP=2 bash scripts/backup.sh
archive="$(find "$root/out" -maxdepth 1 -name 'botly-*.tar.gz' -print -quit)"
[ -n "$archive" ] && [ -s "$archive" ]
[ "$(stat -c %a "$archive")" = 600 ]
tar -tzf "$archive" | grep -q '^database-backup.db$'
tar -xOzf "$archive" database-backup.db > "$root/restored.db"
python3 - "$root/restored.db" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
    assert db.execute('SELECT id FROM important').fetchone()[0] == 42
PY
# Missing required input must never overwrite a verified existing archive.
rm "$root/opt/botly/app/.env"
if KEEP=2 bash scripts/backup.sh >/dev/null 2>&1; then
  echo 'ERROR: Backup unexpectedly succeeded without .env' >&2; exit 1
fi
[ -s "$archive" ]
tar -tzf "$archive" >/dev/null
echo 'Backup snapshot, archive verification and failure retention: OK'

# Files changing during the read make GNU tar exit 1: still a good backup. Exit 2 is a real failure.
fake="$root/fakebin"; mkdir -p "$fake"
printf '#!/bin/sh\ncase " $* " in *" -czf "*) "%s" "$@" || exit $?; exit "${FAKE_TAR_EXIT:-1}";; esac\nexec "%s" "$@"\n' "$(command -v tar)" "$(command -v tar)" > "$fake/tar"
chmod +x "$fake/tar"
rm -f "$root/out"/botly-*.tar.gz
printf 'test settings\n' > "$root/opt/botly/app/.env"
PATH="$fake:$PATH" KEEP=2 bash scripts/backup.sh >/dev/null
[ -n "$(find "$root/out" -maxdepth 1 -name 'botly-*.tar.gz' -print -quit)" ] || { echo 'ERROR: tar exit 1 lost the backup' >&2; exit 1; }
rm -f "$root/out"/botly-*.tar.gz
if PATH="$fake:$PATH" FAKE_TAR_EXIT=2 KEEP=2 bash scripts/backup.sh >/dev/null 2>&1; then
  echo 'ERROR: Backup unexpectedly succeeded when tar failed' >&2; exit 1
fi
[ -z "$(find "$root/out" -maxdepth 1 -name 'botly-*.tar.gz' -print -quit)" ] || { echo 'ERROR: a failed tar published an archive' >&2; exit 1; }
echo 'Changed files during the backup (tar exit 1) tolerated; real tar failures still fatal: OK'

# The migration reads the old layout and publishes a verified snapshot before moving it.
mkdir "$root/opt/hq"
mv "$root/opt/botly/"{data,app} "$root/opt/hq/"
mv "$root/root/botly" "$root/root/grokbot"
mv "$root/opt/hq/data/"{botly.db,hq.db}
printf 'test settings\n' > "$root/opt/hq/app/.env"
mkdir "$root/legacy"
BOTLY_BACKUP_LAYOUT=legacy BOTLY_BACKUP_DB_PATH="$root/opt/hq/data/hq.db" BOTLY_BACKUP_DIR="$root/legacy" bash scripts/backup.sh
legacy=( "$root/legacy"/botly-*.tar.gz )
tar -tzf "${legacy[0]}" > "$root/legacy-contents.txt"
grep -Fxq 'opt/hq/app/.env' "$root/legacy-contents.txt"
grep -Fxq 'root/grokbot/demo.txt' "$root/legacy-contents.txt"
grep -Fxq 'database-backup.db' "$root/legacy-contents.txt"
