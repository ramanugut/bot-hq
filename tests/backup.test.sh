#!/usr/bin/env bash
set -euo pipefail
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
mkdir -p "$root/opt/hq/data" "$root/opt/hq/app" "$root/root/.hermes" "$root/root/grokbot" "$root/out"
printf 'not-a-real-secret\n' > "$root/opt/hq/app/.env"
printf 'remember me\n' > "$root/root/.hermes/MEMORY.md"
printf 'user files\n' > "$root/root/grokbot/demo.txt"
python3 - "$root/opt/hq/data/hq.db" <<'PY'
import sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    db.execute('CREATE TABLE important(id INTEGER)')
    db.execute('INSERT INTO important VALUES (42)')
PY
export BOTLY_BACKUP_SOURCE_ROOT="$root"
export BOTLY_BACKUP_DB_PATH="$root/opt/hq/data/hq.db"
export BOTLY_BACKUP_DIR="$root/out"
KEEP=2 bash scripts/backup.sh
archive="$(find "$root/out" -maxdepth 1 -name 'bothq-*.tar.gz' -print -quit)"
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
rm "$root/opt/hq/app/.env"
if KEEP=2 bash scripts/backup.sh >/dev/null 2>&1; then
  echo 'ERROR: Backup unexpectedly succeeded without .env' >&2; exit 1
fi
[ -s "$archive" ]
tar -tzf "$archive" >/dev/null
echo 'Backup snapshot, archive verification and failure retention: OK'
