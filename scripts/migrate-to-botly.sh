#!/usr/bin/env bash
# Run this script from outside the legacy checkout. See docs/BOTLY-MIGRATION.md.
set -Eeuo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }
[[ ${1:-} == --check || ${1:-} == --apply ]] && [[ $# == 1 ]] || die "Usage: $0 --check|--apply"
mode=$1
[[ $EUID == 0 ]] || die 'Run as root.'
cd /
old=/opt/hq
new=/opt/botly
app="$old/app"
db="$old/data/hq.db"
hermes=/root/.hermes/config.yaml
supervisor=/etc/supervisor/conf.d
unit=/etc/systemd/system
cron=/etc/cron.d
policy=/etc/opt/chrome/policies/managed
branch=free-edition
# The /opt/hq server may run the maintenance branch. Its changes are all in free-edition too.
legacy_branch=legacy-hq-tavily
exec 9>/run/lock/botly-migration.lock
flock -n 9 || die 'Another Botly migration is running.'

if [[ -L $old && $(readlink "$old") == "$new" && -f $new/data/botly.db ]]; then
  die 'Botly has already moved. Check supervisorctl status and use /opt/botly/app/scripts/update.sh.'
fi
for path in "$old" "$old/data" "$app" /root/grokbot /var/log/hq; do
  [[ -d $path && ! -L $path ]] || die "Expected a real directory at $path."
done
for path in "$new" /root/botly /var/log/botly "$supervisor/botly-app.conf" "$supervisor/botly-hermes.conf" "$unit/botly-address.service" "$cron/botly-backup" "$policy/botly.json"; do
  [[ ! -e $path && ! -L $path ]] || die "Destination already exists: $path"
done
for path in "$app/.env" "$db" "$hermes" "$supervisor/hq-app.conf" "$supervisor/hq-hermes.conf" "$unit/hq-address.service" "$cron/hq-backup"; do
  [[ -f $path && ! -L $path ]] || die "Expected a regular file at $path."
done
[[ ! -e $old/data/botly.db && ! -e $old/data/botly.db-wal && ! -e $old/data/botly.db-shm ]] || die 'Botly database paths are already in use.'
installed=$(git -C "$app" branch --show-current)
[[ $installed == "$branch" || $installed == "$legacy_branch" ]] || die "Expected checkout on $branch or $legacy_branch, found ${installed:-no branch}."
[[ -z $(git -C "$app" status --porcelain --untracked-files=normal) ]] || die 'Save or remove checkout changes before migrating.'
grep -Eq '^DB_PATH=/opt/hq/data/hq\.db$' "$app/.env" || die 'This migration requires the standard EC2 database path.'
grep -Eq '^ENGINES_DIR=/opt/hq/data/engines$' "$app/.env" || die 'This migration requires the standard EC2 engines directory.'
port=$(sed -n 's/^PORT=//p' "$app/.env")
port=${port:-8787}
[[ $port =~ ^[0-9]+$ ]] || die 'Invalid PORT in app settings.'
curl -fsS --max-time 5 "http://127.0.0.1:$port/api/health" >/dev/null
curl -fsS --max-time 5 http://127.0.0.1:8642/health >/dev/null
supervisorctl status hq-app hq-hermes >/dev/null
systemctl is-enabled --quiet hq-address.service
if systemctl is-active --quiet hq-address.service; then
  die 'Wait for hq-address.service to finish.'
fi
python3 -c 'import yaml' 2>/dev/null || die 'Python YAML support is missing. Install it with: apt-get install -y python3-yaml'
[[ -s $db ]] || die 'Database is empty.'
before=$(git -C "$app" rev-parse HEAD)
remote=$(git -C "$app" remote get-url origin)
if [[ $installed == "$legacy_branch" ]]; then
  # The maintenance branch never descends from free-edition. Accept only a commit published on it,
  # so no local work is left behind; its changes were all carried over to free-edition.
  git -C "$app" fetch -q origin "$legacy_branch"
  git -C "$app" merge-base --is-ancestor "$before" FETCH_HEAD || die "The installed commit is not on origin/$legacy_branch."
fi
git -C "$app" fetch -q origin "$branch"
target=$(git -C "$app" rev-parse FETCH_HEAD)
if [[ $installed == "$branch" ]]; then
  git -C "$app" merge-base --is-ancestor "$before" "$target" || die 'The fetched release does not descend from the installed commit.'
fi
git -C "$app" cat-file -e "$target:scripts/migrate-to-botly.sh" || die 'The fetched release has no migration.'
printf 'Installed: %s at %s. Moving to: %s at %s.\n' "$installed" "${before:0:7}" "$branch" "${target:0:7}"
printf 'Legacy checkout, data, services and local health checks passed.\n'
[[ $mode == --apply ]] || exit 0

# The cutover stops hq-hermes and every bot. Started from a bot's shell, it would kill itself halfway.
# Look at each parent's program name (and script name, for Python programs), not its full command line.
pid=$PPID
while [[ $pid =~ ^[0-9]+$ && $pid -gt 1 ]]; do
  mapfile -d '' -t argv < "/proc/$pid/cmdline" 2>/dev/null || argv=()
  for word in "$(cat "/proc/$pid/comm" 2>/dev/null)" "${argv[@]:0:2}"; do
    case ${word##*/} in
      supervisord|hermes|hermes-*) die 'Run --apply from your own SSH or EC2 Instance Connect terminal, not from a bot. The cutover stops the bots.' ;;
    esac
  done
  pid=$(awk '/^PPid:/ {print $2}' "/proc/$pid/status" 2>/dev/null || echo 0)
done

recovery=$(mktemp -d /opt/botly-recovery.XXXXXXXX)
printf 'Private migration backup and logs: %s\n' "$recovery"
# Keep the working URL during the cutover. Switch to the new address if GitHub already renamed it.
if [[ $remote == https://github.com/ramanugut/bot-hq.git ]]; then
  renamed_target=$(GIT_TERMINAL_PROMPT=0 timeout 15 git ls-remote https://github.com/ramanugut/botly.git "refs/heads/$branch" 2>/dev/null | cut -f1 || true)
  [[ $renamed_target != "$target" ]] || remote=https://github.com/ramanugut/botly.git
fi
mkdir "$recovery/build"
git -C "$app" archive "$target" | tar -x -C "$recovery/build"
export PATH="$old/node/bin:$PATH"
(
  cd "$recovery/build"
  npm ci --ignore-scripts --no-audit --no-fund
  npm run build
) >"$recovery/build.log" 2>&1 || die "Build failed. See $recovery/build.log."

rewrite() {
  sed -e 's|/opt/hq|/opt/botly|g' -e 's|/var/log/hq|/var/log/botly|g' \
      -e 's|/root/grokbot|/root/botly|g' -e 's|/data/hq\.db|/data/botly.db|g' \
      -e 's|hq-app|botly-app|g' -e 's|hq-hermes|botly-hermes|g' "$1" > "$2"
  chmod --reference="$1" "$2"
}
cp -p "$app/.env" "$recovery/app.env"
cp -p "$hermes" "$recovery/hermes.yaml"
python3 - "$recovery/hermes.yaml" "$recovery/hermes.new" "$port" <<'PY'
import sys, yaml
source, dest, port = sys.argv[1:]
with open(source) as f:
    config = yaml.safe_load(f)
servers = config.get("mcp_servers", {})
entry = servers.get("hq", {})
if "botly" in servers or entry.get("url") != f"http://127.0.0.1:{port}/mcp/primary":
    sys.exit("Expected the legacy local HQ MCP entry and no existing Botly entry.")
servers["botly"] = servers.pop("hq")
with open(dest, "w") as f:
    yaml.safe_dump(config, f, sort_keys=False)
PY

undo=()
add_undo() { undo+=("$*"); }
move() {
  mv -T -- "$1" "$2"
  local command
  printf -v command 'mv -T -- %q %q' "$2" "$1"
  add_undo "$command"
}
alias_path() {
  ln -s -- "$1" "$2"
  local command
  printf -v command 'rm -- %q' "$2"
  add_undo "$command"
}
rollback() {
  local code=$?
  trap - EXIT INT TERM
  if (( code == 0 )); then return; fi
  set +e
  echo 'Cutover failed. Restoring the legacy installation.' >&2
  supervisorctl stop botly-app botly-hermes >/dev/null 2>&1
  systemctl disable botly-address.service >/dev/null 2>&1
  local i failed=0
  for ((i=${#undo[@]}-1; i>=0; i--)); do eval "${undo[i]}" || failed=1; done
  systemctl daemon-reload || failed=1
  systemctl enable hq-address.service >/dev/null || failed=1
  supervisorctl reread >/dev/null && supervisorctl update >/dev/null || failed=1
  supervisorctl status hq-app hq-hermes >/dev/null || supervisorctl start hq-hermes hq-app || failed=1
  if ! health || (( failed )); then
    printf 'Rollback needs attention. Recovery files: %s\n' "$recovery" >&2
  else
    printf 'Legacy service health verified. Recovery files: %s\n' "$recovery" >&2
  fi
  exit "$code"
}
health() {
  for _ in {1..30}; do
    if curl -fsS --max-time 2 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1 &&
       curl -fsS --max-time 2 http://127.0.0.1:8642/health >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

trap rollback EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
move "$cron/hq-backup" "$recovery/hq-backup"
systemctl disable hq-address.service >/dev/null
supervisorctl stop hq-app hq-hermes >/dev/null
# Stop detached managed gateways and browser sessions that still hold legacy paths.
python3 - <<'PY'
import os, pathlib, signal, time
targets = set()
for proc in pathlib.Path("/proc").iterdir():
    if not proc.name.isdecimal():
        continue
    try:
        cmd = (proc / "cmdline").read_bytes().split(b"\0")
        env = (proc / "environ").read_bytes().split(b"\0")
        managed = b"gateway" in cmd and any(x.startswith(b"HERMES_HOME=/opt/hq/data/engines/") for x in env)
        desktop = any(x in (b"/opt/hq/hq-home.py", b"/opt/hq/hq-shell.py") for x in cmd)
        chrome = any(x.startswith(b"--user-data-dir=/root/grokbot/profiles/") for x in cmd)
        if managed or desktop or chrome:
            os.kill(int(proc.name), signal.SIGTERM)
            targets.add(proc)
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        continue
for _ in range(80):
    targets = {p for p in targets if (p / "cmdline").exists() and (p / "cmdline").read_bytes()}
    if not targets:
        break
    time.sleep(.125)
else:
    raise SystemExit("Bot processes have not shut down.")
PY
mkdir -p /root/grokbot/files /root/grokbot/profiles
KEEP=3 BOTLY_BACKUP_LAYOUT=legacy BOTLY_BACKUP_DIR="$recovery" BOTLY_BACKUP_DB_PATH="$db" bash "$recovery/build/scripts/backup.sh"
move "$old" "$new"
move /var/log/hq /var/log/botly
move /root/grokbot /root/botly
# Compatibility for existing attachments, absolute venv shebangs, and Docker bind mounts.
alias_path "$new" "$old"
alias_path /root/botly /root/grokbot
for suffix in '' -wal -shm; do
  [[ ! -e $new/data/hq.db$suffix ]] || move "$new/data/hq.db$suffix" "$new/data/botly.db$suffix"
done
# Keep the original checkout and settings available for rollback.
move "$new/app" "$recovery/checkout"
add_undo 'if [[ -d $new/app ]]; then mv -T -- "$new/app" "$recovery/failed-checkout"; fi'
# Clone without picking a branch: the old checkout may have no free-edition branch, or an outdated one.
git clone -q --no-hardlinks --no-checkout "$recovery/checkout" "$new/app"
git -C "$new/app" checkout -q -B "$branch" "$target"
git -C "$new/app" branch -q -D "$legacy_branch" 2>/dev/null || true
git -C "$new/app" remote set-url origin "$remote"
rewrite "$recovery/app.env" "$new/app/.env"
sed -i -E 's/^HQ_(SCREENS|LOCAL|AGENT_APPROVALS|SCREEN_SIZE|SCREEN_SLEEP_MIN|TIMEZONE|SEARXNG_URL)=/BOTLY_\1=/' "$new/app/.env"
for directory in node_modules server/node_modules web/node_modules server/dist web/dist; do
  if [[ -d $recovery/build/$directory ]]; then mv -T -- "$recovery/build/$directory" "$new/app/$directory"; fi
done
install -m 600 "$recovery/hermes.new" "$hermes"
add_undo 'cp -p -- "$recovery/hermes.yaml" "$hermes"'
for suffix in app hermes; do
  move "$supervisor/hq-$suffix.conf" "$recovery/hq-$suffix.conf"
  add_undo 'rm -f -- "$supervisor/botly-'"$suffix"'.conf"'
  rewrite "$recovery/hq-$suffix.conf" "$supervisor/botly-$suffix.conf"
done
move "$unit/hq-address.service" "$recovery/hq-address.service"
add_undo 'rm -f -- "$unit/botly-address.service"'
rewrite "$recovery/hq-address.service" "$unit/botly-address.service"
if [[ -f $policy/hq.json ]]; then
  move "$policy/hq.json" "$recovery/hq.json"
fi
if [[ -f $new/data/hermes-mcp-hq.yaml ]]; then
  move "$new/data/hermes-mcp-hq.yaml" "$recovery/hermes-mcp-hq.yaml"
  add_undo 'rm -f -- "$new/data/hermes-mcp-botly.yaml"'
  sed 's/^  hq:/  botly:/' "$recovery/hermes-mcp-hq.yaml" > "$new/data/hermes-mcp-botly.yaml"
fi
systemctl daemon-reload
systemctl enable botly-address.service >/dev/null
supervisorctl reread >/dev/null
supervisorctl update >/dev/null
health || die 'New app or Hermes failed its health check.'
supervisorctl status botly-app botly-hermes
# Publish a renamed cron job only after both services respond.
add_undo 'rm -f -- "$cron/botly-backup"'
rewrite "$recovery/hq-backup" "$cron/botly-backup"
trap - EXIT INT TERM
printf 'Botly cutover complete. Recovery data: %s\n' "$recovery"
