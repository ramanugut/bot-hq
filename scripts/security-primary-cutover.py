#!/usr/bin/env python3
"""Prepare a non-root primary Hermes profile. Does NOT restart or deploy anything.

Read-only: python3 scripts/security-primary-cutover.py --check
Offline stage: BOTLY_PRIMARY_STAGE=YES HERMES_SHARED_BIN=/opt/botly/hermes/bin/hermes \
  python3 scripts/security-primary-cutover.py --stage

The stage contains credentials. Never upload it, paste it, or expose it publicly.
"""
import hashlib
import os
import pathlib
import pwd
import re
import shutil
import stat
import subprocess
import sys
import uuid

SOURCE = pathlib.Path('/root/.hermes')
TARGET = pathlib.Path('/opt/botly/primary')
STAGING = pathlib.Path('/opt/botly/security-staging')
APP_ENV = pathlib.Path('/opt/botly/app/.env')
SUPERVISOR = pathlib.Path('/etc/supervisor/conf.d/botly-hermes.conf')
USER = 'botly_primary'
ALLOW = ['mcp-botly', 'search', 'vision', 'image_gen', 'todo', 'memory', 'session_search']
DENY = ['terminal', 'browser', 'computer_use', 'file', 'code_execution',
        'delegation', 'cronjob', 'skills', 'connections']

def abort(message):
    raise RuntimeError(message)

def confine_home(p):
    if p.is_symlink() or not p.is_dir() or p.stat().st_uid != 0:
        abort('Primary source must be a root-owned regular directory')
    for dirpath, dirs, files in os.walk(p, followlinks=False):
        for name in dirs + files:
            item = pathlib.Path(dirpath) / name
            mode = item.lstat().st_mode
            if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                abort('Symlink or special file found in Hermes profile; inspect before staging')

def change_env(contents):
    lines = contents.rstrip('\n').split('\n')
    if not any(x.startswith('SESSION_SECRET=') for x in lines):
        abort('Not a Botly application environment')
    for k, v in [('HERMES_HOME_PRIMARY', str(TARGET)),
                 ('BOTLY_PRIMARY_SECURITY_MODE', 'restricted')]:
        indexes = [i for i, x in enumerate(lines) if x.startswith(k + '=')]
        if len(indexes) > 1:
            abort('Duplicate application setting ' + k)
        if indexes:
            lines[indexes[0]] = k + '=' + v
        else:
            lines.append(k + '=' + v)
    return '\n'.join(lines) + '\n'

def change_supervisor(contents, binary):
    if '[program:botly-hermes]' not in contents:
        abort('Unexpected Hermes Supervisor configuration')
    settings = {
        'command': binary + ' gateway',
        'directory': str(TARGET),
        'user': USER,
        'environment': 'HOME="' + str(TARGET) + '",HERMES_HOME="' + str(TARGET) +
            '",USER="' + USER + '",LOGNAME="' + USER +
            '",PATH="' + str(pathlib.Path(binary).parent) + ':/opt/botly/node/bin:/usr/local/bin:/usr/bin:/bin"',
    }
    for k, v in settings.items():
        line = re.compile('^' + k + '=.*$', re.MULTILINE)
        if line.search(contents):
            contents = line.sub(lambda m: k + '=' + v, contents)
        else:
            contents = contents.replace('[program:botly-hermes]',
                                        '[program:botly-hermes]\n' + k + '=' + v, 1)
    return contents

def restrict_profile(profile):
    if not isinstance(profile, dict):
        abort('Invalid Hermes configuration')
    botly = profile.get('mcp_servers', {}).get('botly')
    if not isinstance(botly, dict) or '/mcp/primary' not in str(botly.get('url', '')):
        abort('Primary Botly MCP endpoint is missing; do not stage an isolated bot')
    profile.setdefault('platform_toolsets', {})['api_server'] = list(ALLOW)
    agent = profile.setdefault('agent', {})
    disabled = agent.get('disabled_toolsets', [])
    if not isinstance(disabled, list):
        disabled = []
    agent['disabled_toolsets'] = list(dict.fromkeys(disabled + DENY))
    profile['mcp_servers'] = {'botly': botly}
    profile.pop('browser', None)
    profile.pop('terminal', None)
    return profile

def shared_executable(raw):
    if not raw or not raw.startswith('/'):
        abort('Set HERMES_SHARED_BIN to a shared root-owned Hermes executable')
    p = pathlib.Path(raw).resolve(strict=True)
    if str(p).startswith('/root/') or str(p).startswith('/home/'):
        abort('Hermes executable is inside a private user home')
    st = p.stat()
    if not p.is_file() or st.st_uid != 0 or not st.st_mode & 0o111:
        abort('Hermes executable must be root-owned and executable')
    for parent in p.parents:
        if not parent.stat().st_mode & 0o001:
            abort('Hermes executable parent is inaccessible to other Linux users')
    with p.open('rb') as fd:
        first = fd.readline(300)
    if first.startswith(b'#!') and b'/root/' in first:
        abort('Hermes executable interpreter is inside /root')
    return str(p)

def check():
    if not SOURCE.is_dir() or not pathlib.Path('/opt/botly/app').is_dir():
        abort('Finish the Botly server migration before changing Hermes identity')
    if not APP_ENV.is_file() or not SUPERVISOR.is_file():
        abort('App environment or Supervisor configuration is missing')
    confine_home(SOURCE)
    if not (SOURCE / 'auth.json').is_file():
        abort('Hermes sign-in state missing; investigate locally without exposing credentials')
    import yaml
    profile = yaml.safe_load((SOURCE / 'config.yaml').read_text())
    restrict_profile(profile)
    change_env(APP_ENV.read_text())
    change_supervisor(SUPERVISOR.read_text(), '/opt/botly/hermes/bin/hermes')
    print('Primary profile and service settings: compatible for staging (no secrets displayed)')

def account():
    try:
        return pwd.getpwnam(USER)
    except KeyError:
        subprocess.run(['useradd', '--system', '--user-group', '--no-create-home',
                        '--shell', '/usr/sbin/nologin', USER], check=True)
        return pwd.getpwnam(USER)

def assert_stopped():
    output = subprocess.run(['supervisorctl', 'status', 'botly-hermes'],
                            capture_output=True, text=True, check=True).stdout
    if re.search(r'\bRUNNING\b', output):
        abort('Stop botly-hermes during an approved maintenance window before staging')

def chown_tree(folder, uid, gid):
    for p, dirs, files in os.walk(folder, topdown=False):
        for name in files + dirs:
            item = pathlib.Path(p) / name
            st = item.lstat()
            os.chown(item, uid, gid, follow_symlinks=False)
            os.chmod(item, st.st_mode & 0o700)
    os.chown(folder, uid, gid)
    os.chmod(folder, 0o700)

def stage():
    if os.geteuid() != 0 or not sys.stdin.isatty() or os.getenv('BOTLY_PRIMARY_STAGE') != 'YES':
        abort('Use an interactive root SSH terminal with BOTLY_PRIMARY_STAGE=YES for --stage')
    check()
    assert_stopped()
    if TARGET.exists():
        abort('Primary target already exists; refusing to overwrite')
    binary = shared_executable(os.getenv('HERMES_SHARED_BIN', ''))
    owner = account()
    if owner.pw_uid < 100 or owner.pw_gid < 100:
        abort('Refusing unsafe primary UID or GID')
    STAGING.mkdir(mode=0o700, parents=True, exist_ok=True)
    if STAGING.is_symlink() or STAGING.stat().st_uid != 0:
        abort('Unsafe staging directory')
    STAGING.chmod(0o700)
    tmp = STAGING / ('primary-' + uuid.uuid4().hex[:12])
    tmp.mkdir(mode=0o700)
    # Stage independently, leave original Hermes and live service untouched.
    dest = tmp / 'hermes'
    shutil.copytree(SOURCE, dest, symlinks=False)
    import yaml
    conf = restrict_profile(yaml.safe_load((dest / 'config.yaml').read_text()))
    (dest / 'config.yaml').write_text(yaml.safe_dump(conf, sort_keys=False))
    (dest / 'workspace').mkdir(mode=0o700, exist_ok=True)
    chown_tree(dest, owner.pw_uid, owner.pw_gid)
    (tmp / 'botly-hermes.candidate.conf').write_text(change_supervisor(SUPERVISOR.read_text(), binary))
    (tmp / 'botly-app.candidate.env').write_text(change_env(APP_ENV.read_text()))
    for name in ['botly-hermes.candidate.conf', 'botly-app.candidate.env']:
        (tmp / name).chmod(0o600)
    print('Primary bot staged in a private owner-only directory: ' + str(tmp))
    print('Live Hermes, app settings and Supervisor were NOT changed.')
    print('Staged files contain credentials; do not copy or share them.')

if __name__ == '__main__':
    try:
        if sys.argv[1:] == ['--check']:
            check()
        elif sys.argv[1:] == ['--stage']:
            stage()
        else:
            abort('Usage: python3 security-primary-cutover.py --check|--stage')
    except Exception as e:
        print('Primary hardening refused: ' + str(e), file=sys.stderr)
        sys.exit(1)
