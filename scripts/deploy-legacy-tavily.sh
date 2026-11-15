#!/usr/bin/env bash
# Safe, one-time deployment of Tavily MCP tools onto the existing /opt/hq installation.
# No migration, no service rename, no database or credential changes.
# Usage (root): bash /root/deploy-legacy-tavily.sh --check|--apply
set -Eeuo pipefail
umask 077

die() { echo "$*" >&2; exit 1; }
[[ $# == 1 && ( $1 == --check || $1 == --apply ) ]] || die "Usage: $0 --check|--apply"
mode=$1
[[ $EUID == 0 ]] || die "Run as root."

APP=/opt/hq/app
cd "$APP" || die "Legacy installation missing: $APP"
[[ -d .git && -f .env ]] || die "Legacy checkout or server .env is missing."
[[ $(git branch --show-current) == free-edition ]] || die "Expected the existing free-edition checkout, not another branch."
[[ -z $(git status --porcelain --untracked-files=no) ]] || die "Uncommitted tracked files: save them before deploying."
[[ -d /opt/hq/data && -d /root/grokbot ]] || die "Expected original /opt/hq and /root/grokbot layout."
supervisorctl status hq-app hq-hermes | grep -q 'hq-app[[:space:]]*RUNNING' || die "hq-app not running."
supervisorctl status hq-app hq-hermes | grep -q 'hq-hermes[[:space:]]*RUNNING' || die "hq-hermes not running."
curl -fsS --max-time 5 http://127.0.0.1:8787/api/health >/dev/null || die "Legacy app health check failed."
[[ -d /opt/hq/backups ]] || die "Backups directory missing."
[[ -n $(find /opt/hq/backups -maxdepth 1 -type f -name '*.tar.gz' -print -quit) ]] ||
  die "Make a verified backup first; none found."

before=$(git rev-parse HEAD)
git fetch -q origin legacy-hq-tavily
target=$(git rev-parse FETCH_HEAD)
git merge-base --is-ancestor "$before" "$target" ||
  die "Tavily branch does not descend from the installed release. No changes made."
git cat-file -e "$target:server/src/tavily.ts" || die "Tavily integration missing from the release."
git cat-file -e "$target:tests/tavily.test.mjs" || die "Tavily tests missing from the release."
echo "Current: $before"
echo "Tavily release: $target"
echo "Layout: /opt/hq, hq-app, hq-hermes (unchanged)"
[[ $mode == --apply ]] || { echo "Readiness checks passed. Nothing deployed."; exit 0; }

export PATH=/opt/hq/node/bin:$PATH
rollback() {
  local code=$?
  trap - ERR
  echo "Tavily deployment failed. Restoring original checkout and build..." >&2
  cd "$APP" || exit "$code"
  git switch -q free-edition || true
  npm ci --ignore-scripts --no-audit --no-fund >/var/log/hq/legacy-tavily-rollback-npm.log 2>&1 || true
  npm run build >/var/log/hq/legacy-tavily-rollback-build.log 2>&1 || true
  supervisorctl restart hq-app || true
  if curl -fsS --max-time 5 http://127.0.0.1:8787/api/health >/dev/null; then
    echo "Legacy app health verified after rollback." >&2
  else
    echo "Rollback needs manual attention. Review /var/log/hq/ and supervisorctl status." >&2
  fi
  exit "$code"
}
trap rollback ERR

# A separate maintenance branch keeps the renamed free-edition release untouched.
git switch -q -c legacy-hq-tavily --track origin/legacy-hq-tavily
if ! git diff --quiet "$before" "$target" -- package-lock.json; then
  echo "Installing changed dependencies..."
  npm ci --ignore-scripts --no-audit --no-fund >/var/log/hq/legacy-tavily-npm.log 2>&1 ||
    { tail -30 /var/log/hq/legacy-tavily-npm.log; false; }
fi
echo "Checking types..."
npm run typecheck >/var/log/hq/legacy-tavily-typecheck.log 2>&1 ||
  { tail -30 /var/log/hq/legacy-tavily-typecheck.log; false; }
echo "Building..."
npm run build >/var/log/hq/legacy-tavily-build.log 2>&1 ||
  { tail -30 /var/log/hq/legacy-tavily-build.log; false; }
echo "Running Tavily and library security tests..."
node --test tests/tavily.test.mjs tests/hardening.test.mjs >/var/log/hq/legacy-tavily-tests.log 2>&1 ||
  { tail -35 /var/log/hq/legacy-tavily-tests.log; false; }

echo "Restarting hq-app only (not Hermes)..."
supervisorctl restart hq-app >/dev/null
healthy=0
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:8787/api/health >/dev/null 2>&1; then healthy=1; break; fi
  sleep 1
done
[[ $healthy == 1 ]] || die "Updated app failed its health check."
trap - ERR
echo "Legacy Tavily release deployed successfully: $(git rev-parse --short HEAD)"
echo "Verify with a Botly agent: use tavily_search for a harmless public query."
