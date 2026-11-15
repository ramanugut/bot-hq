#!/usr/bin/env bash
# Update Botly on the server to the latest code from GitHub. Run as root:
#   bash /opt/hq/app/scripts/update.sh
# This is a temporary compatibility release for the existing /opt/hq server.
# It deliberately does not follow the renamed free-edition branch.
# Keeps settings (.env), data, bots and logins; only the app's code changes.
set -euo pipefail
# All in one function: bash reads it whole before running, so the update replacing this file mid-run is safe.
main() {
  APP=/opt/hq/app
  cd "$APP"
  export PATH=/opt/hq/node/bin:$PATH
  branch="$(git rev-parse --abbrev-ref HEAD)"
  [ "$branch" = 'legacy-hq-tavily' ] || { echo 'Legacy /opt/hq updater only supports legacy-hq-tavily. Do not use the renamed release here.' >&2; exit 1; }
  [ -z "$(git status --porcelain --untracked-files=no)" ] || { echo 'Uncommitted changes detected; refusing to discard them' >&2; exit 1; }
  before="$(git rev-parse HEAD)"
  git fetch -q origin "$branch"
  target="$(git rev-parse "origin/$branch")"
  if [ "$before" = "$target" ]; then echo "Already up to date ($(git log -1 --format=%s))."; exit 0; fi
  rollback() {
    trap - ERR
    echo 'Deployment failed; attempting to restore the previous release...' >&2
    git reset -q --hard "$before"
    npm ci --ignore-scripts --no-audit --no-fund >/var/log/hq/rollback-npm.log 2>&1 || true
    npm run build >/var/log/hq/rollback-build.log 2>&1 || true
    supervisorctl restart hq-app || true
    echo "Rollback attempted to commit $before. Inspect logs and verify service health." >&2
  }
  trap rollback ERR
  git reset -q --hard "$target"
  after="$(git rev-parse HEAD)"
  # Free extras (document reading, free web search): installs only what is missing.
  bash "$APP/scripts/extras.sh" || echo "note: an extra did not install; the app still works"
  if ! git diff --quiet "$before" "$after" -- package-lock.json; then
    echo "Installing packages..."; npm ci --ignore-scripts --no-audit --no-fund >/var/log/hq/npm.log 2>&1 || { tail -20 /var/log/hq/npm.log; false; }
  fi
  echo "Building..."
  npm run build >/var/log/hq/build.log 2>&1 || { tail -30 /var/log/hq/build.log; false; }
  supervisorctl restart hq-app >/dev/null
  healthy=0
  for _ in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then healthy=1; break; fi
    sleep 1
  done
  [ "$healthy" = 1 ] || { echo 'Health check failed after restart' >&2; false; }
  trap - ERR
  echo "Updated to: $(git log -1 --format='%h %s')"
  git log --format='  - %s' "$before..$after" | head -20
}
main "$@"
