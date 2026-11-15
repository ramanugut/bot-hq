#!/usr/bin/env bash
# Update Bot HQ on the server to the latest code from GitHub. Run as root:
#   bash /opt/hq/app/scripts/update.sh
# Keeps settings (.env), data, bots and logins; only the app's code changes.
set -euo pipefail
APP=/opt/hq/app
cd "$APP"
export PATH=/opt/hq/node/bin:$PATH
branch="$(git rev-parse --abbrev-ref HEAD)"
before="$(git rev-parse HEAD)"
git fetch -q origin "$branch"
git reset -q --hard "origin/$branch"
after="$(git rev-parse HEAD)"
if [ "$before" = "$after" ]; then echo "Already up to date ($(git log -1 --format=%s))."; exit 0; fi
if ! git diff --quiet "$before" "$after" -- package-lock.json; then
  echo "Installing packages..."; npm ci --ignore-scripts --no-audit --no-fund >/var/log/hq/npm.log 2>&1 || { tail -20 /var/log/hq/npm.log; exit 1; }
fi
echo "Building..."
npm run build >/var/log/hq/build.log 2>&1 || { tail -30 /var/log/hq/build.log; exit 1; }
supervisorctl restart hq-app >/dev/null
for _ in $(seq 1 30); do curl -fsS http://127.0.0.1:8787/api/health >/dev/null 2>&1 && break; sleep 1; done
echo "Updated to: $(git log -1 --format='%h %s')"
git log --format='  - %s' "$before..$after" | head -20
