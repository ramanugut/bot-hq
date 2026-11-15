#!/usr/bin/env bash
# Nightly backup of everything that makes your Bot HQ yours: chats and settings (database), each
# bot's memory, skills and sign-ins (Hermes homes), bot browser profiles and Library files.
# Keeps the last 3 in /opt/hq/backups (KEEP=n to change). Download the newest from the app (account menu → Download backup).
#   bash /opt/hq/app/scripts/backup.sh
set -euo pipefail
OUT=/opt/hq/backups; KEEP="${KEEP:-3}"
mkdir -p "$OUT"; chmod 700 "$OUT"
stamp="$(date -u +%Y%m%d-%H%M)"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
# A consistent copy of the live database (safe while the app is running).
python3 - "$tmp/database-backup.db" <<'PY'
import sqlite3, sys
src = sqlite3.connect('/opt/hq/data/hq.db'); dst = sqlite3.connect(sys.argv[1])
src.backup(dst); dst.close(); src.close()
PY
tar --warning=no-file-changed --ignore-failed-read -czf "$OUT/bothq-$stamp.tar.gz" \
  --exclude='hq.db' --exclude='hq.db-*' \
  --exclude='*/cache' --exclude='*/Cache' --exclude='*/Code Cache' --exclude='*/GPUCache' --exclude='*/CacheStorage' \
  --exclude='*/logs' --exclude='*/node_modules' --exclude='*/.venv' --exclude='*/venv' --exclude='/root/.hermes/hermes-agent' \
  --exclude='*/bot-desktop' --exclude='*/browser-harness' --exclude='*.sock' \
  --exclude='*/Service Worker' --exclude='*/ShaderCache' --exclude='*/GrShaderCache' --exclude='*/GraphiteDawnCache' \
  --exclude='*/component_crx_cache' --exclude='*/extensions_crx_cache' --exclude='*/optimization_guide*' \
  --exclude='*/Safe Browsing' --exclude='*/WidevineCdm' --exclude='*/Crashpad' --exclude='*/OnDeviceHeadSuggestModel' \
  --exclude='*/screen_ai' --exclude='*/hyphen-data' --exclude='*/Subresource Filter' --exclude='*/MEIPreload' \
  --exclude='root/.hermes/cache' --exclude='*/__pycache__' --exclude='*.log' \
  -C / opt/hq/data opt/hq/app/.env root/.hermes root/grokbot \
  -C "$tmp" database-backup.db 2>/dev/null || true
chmod 600 "$OUT/bothq-$stamp.tar.gz"
ls -1t "$OUT"/bothq-*.tar.gz | tail -n +$((KEEP + 1)) | xargs -r rm -f
echo "backup: $OUT/bothq-$stamp.tar.gz ($(du -h "$OUT/bothq-$stamp.tar.gz" | cut -f1))"
