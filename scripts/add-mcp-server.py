#!/usr/bin/env python3
"""Give every Botly bot an outside MCP server (for example the Mumatec WHMCS one).

Run on the Orgo computer, as root:
    python3 add-mcp-server.py                      # asks for name, URL and token
    python3 add-mcp-server.py --name whmcs --remove

It asks for the token without showing it, then:
  1. adds the server to the main agent's Hermes config (/root/.hermes/config.yaml),
  2. adds it to every extra bot's config (/opt/hq/data/engines/*/config.yaml),
  3. stores it in the app's .env (EXTRA_MCP_SERVERS) so bots made later get it too,
  4. restarts the app (the bots themselves keep running; Hermes reloads its config by itself).

Every config file is edited as text (comments and layout stay), a dated copy is kept next to it,
and the result must read back with every other setting unchanged before it replaces the original.
"""
import argparse, getpass, glob, json, os, re, shutil, subprocess, sys, time

p = argparse.ArgumentParser()
p.add_argument('--name', help='short name for the server, e.g. whmcs')
p.add_argument('--url')
p.add_argument('--remove', action='store_true')
p.add_argument('--hermes-config', default='/root/.hermes/config.yaml')
p.add_argument('--engines', default='/opt/hq/data/engines')
p.add_argument('--app-env', default='/opt/hq/app/.env')
a = p.parse_args()

try:
    import yaml
except ImportError:
    # Hermes' own Python has PyYAML; try it before giving up.
    try:
        hermes = shutil.which('hermes') or '/usr/local/bin/hermes'
        first = open(hermes, encoding='utf-8', errors='replace').readline()
        py = first[2:].strip().split()[0] if first.startswith('#!') else ''
        if py and os.path.exists(py) and os.path.realpath(py) != os.path.realpath(sys.executable):
            os.execv(py, [py] + sys.argv)
    except OSError:
        pass
    sys.exit('PyYAML is needed; run this with the Python that Hermes uses.')

try:
    tty = open('/dev/tty')
except OSError:
    tty = sys.stdin
def ask(q, default=''):
    sys.stdout.write(f'{q}{f" [{default}]" if default else ""}: '); sys.stdout.flush()
    v = tty.readline().strip()
    return v or default

name = a.name or ask('Name for this server', 'whmcs')
if not re.fullmatch(r'[a-z][a-z0-9_-]{0,30}', name) or name == 'hq':
    sys.exit('Name must be short, lower case, letters/digits/-/_ only, and not "hq".')

entry = None
if not a.remove:
    url = a.url or ask('Server URL (starts with https://)')
    if not url.startswith('http'):
        sys.exit('That does not look like a URL.')
    token = getpass.getpass('Token (hidden as you type or paste; press Enter when done): ').strip()
    if not token:
        sys.exit('No token given.')
    if token.lower().startswith('bearer '):
        token = token[7:].strip()
    entry = {'url': url, 'headers': {'Authorization': f'Bearer {token}'}, 'timeout': 300, 'connect_timeout': 30}

def block_for(e):
    out = [f'  {name}:', f'    url: {json.dumps(e["url"])}', '    headers:',
           f'      Authorization: {json.dumps(e["headers"]["Authorization"])}',
           f'    timeout: {e["timeout"]}', f'    connect_timeout: {e["connect_timeout"]}']
    return out

def edit(path):
    old = open(path, encoding='utf-8').read()
    lines = old.split('\n')
    sec = None
    for i, l in enumerate(lines):
        if re.match(r'^mcp_servers:\s*(#.*)?$', l):
            j = i + 1
            while j < len(lines) and (not lines[j].strip() or lines[j][0] in ' \t#'):
                j += 1
            sec = (i, j); break
    if sec:
        # Entries may be indented by any amount; find this section's indent from its first entry.
        ind = None
        for k in range(sec[0] + 1, sec[1]):
            m = re.match(r'^( +)[^ #]', lines[k])
            if m: ind = m.group(1); break
        ind = ind or '  '
        for k in range(sec[0] + 1, sec[1]):
            if re.match(rf'^{ind}{re.escape(name)}:\s*(#.*)?$', lines[k]):
                j = k + 1
                while j < sec[1] and (not lines[j].strip() or len(lines[j]) - len(lines[j].lstrip()) > len(ind)):
                    j += 1
                while j > k + 1 and not lines[j - 1].strip():
                    j -= 1
                del lines[k:j]; break
        if entry:
            blk = [ind + l[2:] for l in block_for(entry)]
            lines[sec[0] + 1:sec[0] + 1] = blk
    elif entry:
        if re.search(r'^mcp_servers:', old, re.M):
            return 'skipped (mcp_servers written in a form this script does not edit)'
        if lines and lines[-1].strip():
            lines.append('')
        lines += ['mcp_servers:'] + block_for(entry) + ['']
    new = '\n'.join(lines)
    if new == old:
        return 'nothing to change'
    before, after = yaml.safe_load(old) or {}, yaml.safe_load(new) or {}
    bs, as_ = dict(before.get('mcp_servers') or {}), dict(after.get('mcp_servers') or {})
    bs.pop(name, None); got = as_.pop(name, None)
    rest = lambda d: {k: v for k, v in d.items() if k != 'mcp_servers'}
    if rest(before) != rest(after) or bs != as_:
        return 'skipped (the edit would have changed other settings)'
    if (entry and got != entry) or (not entry and got is not None):
        return 'skipped (the entry did not read back correctly)'
    backup = f"{path}.before-{name}-{time.strftime('%Y%m%d-%H%M%S')}"
    shutil.copy2(path, backup)
    tmp = path + '.mcp-tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(new)
    shutil.copymode(path, tmp)
    st = os.stat(path); os.chown(tmp, st.st_uid, st.st_gid)
    os.replace(tmp, path)
    return ('removed' if not entry else 'added') + f' (old copy: {backup})'

targets = [a.hermes_config] + sorted(glob.glob(os.path.join(a.engines, '*', 'config.yaml')))
for t in targets:
    if not os.path.exists(t):
        print(f'- {t}: not found, skipped'); continue
    print(f'- {t}: {edit(t)}')

# Bots made later: EXTRA_MCP_SERVERS in the app's .env.
if os.path.exists(a.app_env):
    lines = open(a.app_env, encoding='utf-8').read().split('\n')
    cur = {}
    idx = next((i for i, l in enumerate(lines) if l.startswith('EXTRA_MCP_SERVERS=')), None)
    if idx is not None:
        try: cur = json.loads(lines[idx].split('=', 1)[1].strip().strip("'")) or {}
        except ValueError: cur = {}
    if entry: cur[name] = entry
    else: cur.pop(name, None)
    val = 'EXTRA_MCP_SERVERS=' + json.dumps(cur, separators=(',', ':'))
    if idx is None: lines.insert(len(lines) - (1 if lines and lines[-1] == '' else 0), val)
    else: lines[idx] = val
    shutil.copy2(a.app_env, f"{a.app_env}.before-{name}-{time.strftime('%Y%m%d-%H%M%S')}")
    with open(a.app_env, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines))
    os.chmod(a.app_env, 0o600)
    print(f'- {a.app_env}: updated for bots made later')
    try:
        r = subprocess.run(['supervisorctl', 'restart', 'hq-app'], capture_output=True, text=True)
        print('- app restarted' if r.returncode == 0 else f'- could not restart the app: {r.stdout}{r.stderr}'.strip())
    except FileNotFoundError:
        print('- supervisorctl not found; restart the app yourself')
else:
    print(f'- {a.app_env}: not found (is Botly installed here?)')

print(f'\nDone. Ask a bot: "what {name} tools do you have?"' if entry else '\nDone.')
