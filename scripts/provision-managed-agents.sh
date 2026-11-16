#!/usr/bin/env bash
# Offline, owner-operated provisioning for managed (non-primary) Hermes bots.
# No server is changed in --check mode. --apply requires an explicit maintenance window.
set -euo pipefail
mode="${1:---check}"
case "$mode" in --check|--apply) ;; *) echo "Usage: $0 [--check|--apply]" >&2; exit 2;; esac
db="${DB_PATH:-/opt/botly/data/botly.db}"
engines="${ENGINES_DIR:-/opt/botly/data/engines}"
if [[ "$mode" == --apply ]]; then
  [[ "$(id -u)" == 0 ]] || { echo 'Use root for --apply.' >&2; exit 1; }
  [[ "${BOTLY_SECURITY_CUTOVER:-}" == 'YES' ]] || { echo 'Set BOTLY_SECURITY_CUTOVER=YES after making a verified backup.' >&2; exit 1; }
  if command -v supervisorctl >/dev/null 2>&1 && supervisorctl status botly-app 2>/dev/null | grep -q RUNNING; then
    echo 'Stop the Botly application during provisioning; aborting.' >&2
    exit 1
  fi
fi
[[ -f "$db" ]] || { echo "No database at $db" >&2; exit 1; }
[[ -d "$engines" && ! -L "$engines" ]] || { echo "Missing or symlinked engines directory: $engines" >&2; exit 1; }
python3 - "$mode" "$db" "$engines" <<'PY'
import hashlib, os, pathlib, pwd, re, sqlite3, stat, subprocess, sys
mode, db_path, engines_dir = sys.argv[1:]
root = pathlib.Path(engines_dir).resolve(strict=True)
if root != pathlib.Path(engines_dir).absolute():
    sys.exit("Refusing a symlink in the agent engine directory path")
conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
try:
    ids = [row[0] for row in conn.execute("SELECT id FROM bots WHERE engine='managed'")]
finally:
    conn.close()

def validate_tree(root_dir):
    # Do not let recursive ownership changes cross a symlink planted by a bot.
    for current, dirs, files in os.walk(root_dir, topdown=True, followlinks=False):
        for name in dirs + files:
            p = os.path.join(current, name)
            if stat.S_ISLNK(os.lstat(p).st_mode):
                raise RuntimeError(f"Symlink in managed agent home: {p}")
        # os.walk itself never follows a symlink because followlinks=False.

issues = 0
for bot_id in ids:
    if not isinstance(bot_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{3,120}", bot_id):
        sys.exit("An invalid bot ID was found; refuse to create any OS users")
    user = "botly_" + hashlib.sha256(bot_id.encode()).hexdigest()[:16]
    home = root / bot_id
    if home.is_symlink() or home.parent != root:
        sys.exit("Unsafe managed agent home path")
    try:
        account = pwd.getpwnam(user)
    except KeyError:
        account = None
    if mode == "--apply":
        if account is None:
            subprocess.run(["useradd", "--system", "--user-group", "--no-create-home",
                            "--shell", "/usr/sbin/nologin", user], check=True)
            account = pwd.getpwnam(user)
        if account.pw_uid < 100 or account.pw_gid < 100:
            sys.exit(f"Unsafe root-like agent ID for {user}")
        os.makedirs(home, exist_ok=True)
        validate_tree(home)
        # Only the per-bot Hermes home, never /opt/botly/data or the primary ~/.hermes.
        for current, dirs, files in os.walk(home, topdown=False, followlinks=False):
            for name in files + dirs:
                os.chown(os.path.join(current, name), account.pw_uid, account.pw_gid)
        os.chown(home, account.pw_uid, account.pw_gid)
        os.chmod(home, 0o700)
    if account is None or not home.is_dir():
        print(f"NOT READY {bot_id}: agent account/home missing")
        issues += 1
        continue
    st = home.stat()
    if st.st_uid != account.pw_uid or st.st_gid != account.pw_gid or st.st_mode & 0o077:
        print(f"NOT READY {bot_id}: home must be owned by {user} and mode 0700")
        issues += 1
    else:
        print(f"READY {bot_id}: isolated Linux user {user}")
if not ids:
    print("No managed bots exist yet; primary bot migration is a separate procedure.")
if issues:
    sys.exit(f"{issues} managed agent(s) require provisioning")
PY
