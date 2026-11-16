#!/usr/bin/env bash
# Nightly backup of everything that makes your Botly yours: chats and settings (database), each
# bot's memory, skills and sign-ins (Hermes homes), bot browser profiles and Library files.
# Keeps the last 3 in /opt/botly/backups (KEEP=n to change). Download the newest from the app (account menu → Download backup).
#   bash /opt/botly/app/scripts/backup.sh
set -euo pipefail
umask 077
SOURCE_ROOT="${BOTLY_BACKUP_SOURCE_ROOT:-/}"
case "${BOTLY_BACKUP_LAYOUT:-botly}" in
  botly) app_dir=opt/botly; library=root/botly; db_name=botly.db ;;
  legacy) app_dir=opt/hq; library=root/grokbot; db_name=hq.db ;;
  *) echo "Invalid backup layout" >&2; exit 2 ;;
esac
DB_PATH="${BOTLY_BACKUP_DB_PATH:-$SOURCE_ROOT/$app_dir/data/$db_name}"
[ -s "$DB_PATH" ] || { echo "Missing database at $DB_PATH" >&2; exit 1; }
OUT="${BOTLY_BACKUP_DIR:-/opt/botly/backups}"; KEEP="${KEEP:-3}"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || { echo "KEEP must be positive" >&2; exit 2; }
mkdir -p "$OUT"; chmod 700 "$OUT"
stamp="$(date -u +%Y%m%d-%H%M)"
tmp="$(mktemp -d)"
partial="$(mktemp "$OUT/.backup-XXXXXXXX.partial")"
trap 'rm -rf "$tmp"; rm -f "$partial"' EXIT
# A consistent copy of the live database (safe while the app is running).
python3 - "$DB_PATH" "$tmp/database-backup.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect(sys.argv[1]); dst = sqlite3.connect(sys.argv[2])
src.backup(dst)
assert dst.execute('PRAGMA integrity_check').fetchone()[0] == 'ok', 'Invalid SQLite snapshot'
dst.close(); src.close()
PY
# Live bot files (browser profiles, Hermes state) change and vanish while tar reads them. GNU tar then exits 1
# ("some files differ") even with these warnings off. The archive is still complete and is verified below;
# exit 2 or more is a real failure.
tar_status=0
tar --warning=no-file-changed --warning=no-file-removed --warning=no-file-shrank -czf "$partial" \
  --exclude="$db_name" --exclude="$db_name-*" \
  --exclude='*/cache' --exclude='*/Cache' --exclude='*/Code Cache' --exclude='*/GPUCache' --exclude='*/CacheStorage' \
  --exclude='*/logs' --exclude='*/node_modules' --exclude='*/.venv' --exclude='*/venv' --exclude='/root/.hermes/hermes-agent' \
  --exclude='*/bot-desktop' --exclude='*/browser-harness' --exclude='*.sock' \
  --exclude='*/Service Worker' --exclude='*/ShaderCache' --exclude='*/GrShaderCache' --exclude='*/GraphiteDawnCache' \
  --exclude='*/component_crx_cache' --exclude='*/extensions_crx_cache' --exclude='*/optimization_guide*' \
  --exclude='*/Safe Browsing' --exclude='*/WidevineCdm' --exclude='*/Crashpad' --exclude='*/OnDeviceHeadSuggestModel' \
  --exclude='*/screen_ai' --exclude='*/hyphen-data' --exclude='*/Subresource Filter' --exclude='*/MEIPreload' \
  --exclude='root/.hermes/cache' --exclude='*/__pycache__' --exclude='*.log' \
  -C "$SOURCE_ROOT" "$app_dir/data" "$app_dir/app/.env" root/.hermes "$library" \
  -C "$tmp" database-backup.db || tar_status=$?
[ "$tar_status" -le 1 ] || { echo "backup: tar failed (exit $tar_status)" >&2; exit "$tar_status"; }
# Publish only a complete archive, keeping old backups on any failure.
tar -tzf "$partial" > "$tmp/contents.txt"
grep -Fxq "database-backup.db" "$tmp/contents.txt"
grep -Fxq "$app_dir/app/.env" "$tmp/contents.txt"
grep -Fxq "$library/" "$tmp/contents.txt"
grep -Fxq 'root/.hermes/' "$tmp/contents.txt"
chmod 600 "$partial"
mv -f "$partial" "$OUT/botly-$stamp.tar.gz"
ls -1t "$OUT"/botly-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup: $OUT/botly-$stamp.tar.gz ($(du -h "$OUT/botly-$stamp.tar.gz" | cut -f1))"
