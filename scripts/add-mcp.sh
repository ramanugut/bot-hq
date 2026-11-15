#!/usr/bin/env bash
# Give your bots an MCP server's tools (for example your Mumatec WHMCS tools). Run as root:
#   bash /opt/hq/app/scripts/add-mcp.sh whmcs https://your-server/mcp
# It asks for an access token (optional, hidden as you paste). The main bot gets it straight away;
# bots created afterwards get it too. Remove with: bash add-mcp.sh whmcs --remove
set -euo pipefail
name="${1:?usage: add-mcp.sh NAME URL | NAME --remove}"; url="${2:?usage: add-mcp.sh NAME URL | NAME --remove}"
[[ "$name" =~ ^[a-z0-9_]+$ ]] || { echo "NAME: lowercase letters, digits and _ only"; exit 1; }
token=""
if [ "$url" != "--remove" ]; then read -rsp "Access token (Enter for none): " token; echo; fi
NAME="$name" URL="$url" TOKEN="$token" python3 - <<'PY'
import json, os, re, shutil, time, yaml
name, url, token = os.environ['NAME'], os.environ['URL'], os.environ['TOKEN']
entry = {'url': url, 'timeout': 300, 'connect_timeout': 30}
if token: entry['headers'] = {'Authorization': f'Bearer {token}'}
# The main bot (Hermes' own config)
p = '/root/.hermes/config.yaml'
c = yaml.safe_load(open(p)) or {}
shutil.copy2(p, f'{p}.bak-{int(time.time())}')
servers = c.setdefault('mcp_servers', {})
if url == '--remove': servers.pop(name, None)
else: servers[name] = entry
yaml.safe_dump(c, open(p, 'w'), sort_keys=False)
# Bots created by the app later (EXTRA_MCP_SERVERS in the app's .env)
e = '/opt/hq/app/.env'
lines = open(e).read().splitlines()
cur = {}
for l in lines:
    if l.startswith('EXTRA_MCP_SERVERS='):
        try: cur = json.loads(l.split('=', 1)[1] or '{}')
        except Exception: cur = {}
if url == '--remove': cur.pop(name, None)
else: cur[name] = entry
lines = [l for l in lines if not l.startswith('EXTRA_MCP_SERVERS=')] + [f"EXTRA_MCP_SERVERS={json.dumps(cur)}"]
open(e, 'w').write('\n'.join(lines) + '\n')
print(('removed ' if url == '--remove' else 'added ') + name)
PY
supervisorctl restart hq-hermes hq-app >/dev/null && echo "restarted; open a new chat and ask your main bot what tools it has from '$name'"
