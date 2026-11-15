#!/usr/bin/env bash
# Install Botly on an ordinary Ubuntu server (x86 or ARM), with no Orgo: every bot's screen is an
# X display on this server (Xvfb + x11vnc), and the app is served over HTTPS by Caddy at
# https://<public-ip-with-dashes>.sslip.io (free, no domain needed).
#
# Fresh server, as root:
#   1. git clone -b free-edition https://github.com/ramanugut/bot-hq.git /opt/botly/app
#   2. curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash && source ~/.bashrc
#      hermes model          (pick "ChatGPT or Codex Subscription" and sign in)
#   3. ALLOWED_EMAILS=you@example.com bash /opt/botly/app/scripts/install-local.sh
#   4. bash /opt/botly/app/scripts/set-password.sh you@example.com
# Later updates: bash /opt/botly/app/scripts/update.sh
#
# Optional: PUBLIC_URL (default https://<ip>.sslip.io), MAX_BOTS (default 2), PORT (8787),
# XAI_API_KEY / COMPOSIO_API_KEY (voice, X research, connected apps; all optional).
# Running it again upgrades the app and keeps its settings and data.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "run as root: sudo -i, then run this again"; exit 1; }
: "${ALLOWED_EMAILS:?set ALLOWED_EMAILS=you@example.com}"
APP=/opt/botly/app; DATA=/opt/botly/data; NODE_DIR=/opt/botly/node; NODE_V=v22.21.1; BROWSERS=/opt/botly/browsers
PORT="${PORT:-8787}"; HERMES_HOME_DIR=/root/.hermes
[ -f "$APP/package.json" ] || { echo "clone the repo to $APP first"; exit 1; }
[[ ! -d /opt/hq/app || -L /opt/hq ]] || { echo 'Existing HQ install detected. Follow docs/BOTLY-MIGRATION.md.' >&2; exit 1; }
mkdir -p /root/botly/files /root/botly/profiles "$DATA" "$NODE_DIR" /var/log/botly
say() { printf '\n== %s\n' "$*"; }

say "1/7 system packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends supervisor xvfb x11vnc openbox x11-utils x11-xserver-utils \
  imagemagick wmctrl xdotool dbus dbus-x11 python3-gi python3-gi-cairo gir1.2-gtk-3.0 librsvg2-common \
  fonts-inter fonts-noto-color-emoji python3-yaml python3-pip ffmpeg pandoc poppler-utils openssl curl git ca-certificates caddy >/var/log/botly/apt.log 2>&1 \
  || { tail -20 /var/log/botly/apt.log; exit 1; }

pip3 install -q --break-system-packages edge-tts >/var/log/botly/pip.log 2>&1 || echo "note: edge-tts (free voice-overs) did not install"

say "2/7 Node.js"
case "$(uname -m)" in aarch64|arm64) ARCH=arm64 ;; x86_64) ARCH=x64 ;; *) echo "unsupported CPU $(uname -m)"; exit 1 ;; esac
if ! "$NODE_DIR/bin/node" -v 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL "https://nodejs.org/dist/$NODE_V/node-$NODE_V-linux-$ARCH.tar.gz" | tar -xz -C "$NODE_DIR" --strip-components=1
fi
export PATH="$NODE_DIR/bin:$PATH"
node -v

say "3/7 Chromium for the bots"
if [ ! -x /usr/local/bin/chromium ]; then
  PLAYWRIGHT_BROWSERS_PATH="$BROWSERS" npx -y playwright@1 install --with-deps chromium >/var/log/botly/chromium.log 2>&1 \
    || { tail -20 /var/log/botly/chromium.log; exit 1; }
  bin="$(find "$BROWSERS" -path '*chromium-*' -type f \( -name chrome -o -name chromium \) -perm -u+x | grep -v headless | head -1)"
  [ -n "$bin" ] || { echo "Chromium download finished but no browser was found under $BROWSERS"; exit 1; }
  ln -sf "$bin" /usr/local/bin/chromium
fi
/usr/local/bin/chromium --version || true

say "4/7 Hermes API server"
HERMES_BIN="$(command -v hermes || true)"
[ -n "$HERMES_BIN" ] || for p in /root/.local/bin/hermes /usr/local/bin/hermes; do [ -x "$p" ] && HERMES_BIN="$p"; done
[ -n "$HERMES_BIN" ] || { echo "Hermes is not installed yet. Install it and choose a model first (see the steps you were given)."; exit 1; }
touch "$HERMES_HOME_DIR/.env"; chmod 600 "$HERMES_HOME_DIR/.env"
setenv() { grep -q "^$1=" "$HERMES_HOME_DIR/.env" && sed -i "s|^$1=.*|$1=$2|" "$HERMES_HOME_DIR/.env" || echo "$1=$2" >> "$HERMES_HOME_DIR/.env"; }
setenv API_SERVER_ENABLED true
setenv API_SERVER_HOST 127.0.0.1
setenv API_SERVER_PORT 8642
grep -q '^API_SERVER_KEY=.\+' "$HERMES_HOME_DIR/.env" || setenv API_SERVER_KEY "$(openssl rand -hex 24)"
# The main bot works on the default screen (:99): its browser tool drives the Chrome we run there
# (DevTools port 9299), and its computer-use tool acts on that display.
setenv BROWSER_CDP_URL http://127.0.0.1:9299
apt-get install -y -qq at-spi2-core >/dev/null 2>&1 || true
"$HERMES_BIN" computer-use install >/var/log/botly/cua.log 2>&1 || echo "note: computer-use driver did not install (see /var/log/botly/cua.log); the browser tool still works"
touch "$HERMES_HOME_DIR/config.yaml"
python3 - "$HERMES_HOME_DIR/config.yaml" <<'PY'
import shutil, sys, time, yaml
p = sys.argv[1]
c = yaml.safe_load(open(p)) or {}
c.setdefault('browser', {})['cdp_url'] = 'http://127.0.0.1:9299'
pt = c.setdefault('platform_toolsets', {})
cur = list(pt.get('api_server') or ['hermes-api-server'])
for t in ('hermes-api-server', 'computer_use'):
    if t not in cur:
        cur.append(t)
pt['api_server'] = cur
# Nobody can answer Hermes' own approval prompts through the app; bots ask in the chat instead.
c.setdefault('approvals', {})['mode'] = 'off'
# Images on the ChatGPT sign-in (no API key needed); harmless if another provider is used.
c.setdefault('image_gen', {}).setdefault('provider', 'openai-codex')
shutil.copy2(p, f'{p}.before-botly-{int(time.time())}')
yaml.safe_dump(c, open(p, 'w'), sort_keys=False)
PY
cat > /etc/supervisor/conf.d/botly-hermes.conf <<EOF
[program:botly-hermes]
command=$HERMES_BIN gateway
directory=/root
autostart=true
autorestart=true
startsecs=5
stdout_logfile=/var/log/botly/hermes.log
stdout_logfile_maxbytes=10MB
redirect_stderr=true
environment=HOME="/root",DISPLAY=":99",PATH="$(dirname "$HERMES_BIN"):$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EOF

say "5/7 the app"
cd "$APP"
# The SQLite package ships ready-made binaries (ARM included), so no compiler is needed.
npm ci --ignore-scripts --no-audit --no-fund >/var/log/botly/npm.log 2>&1 || { tail -20 /var/log/botly/npm.log; exit 1; }
npm run build >/var/log/botly/build.log 2>&1 || { tail -30 /var/log/botly/build.log; exit 1; }
if [ ! -f "$APP/.env" ]; then
  if [ -z "${PUBLIC_URL:-}" ]; then
    ip="$(curl -fsS https://checkip.amazonaws.com | tr -d '[:space:]')"
    PUBLIC_URL="https://${ip//./-}.sslip.io"
  fi
  {
    echo "PORT=$PORT"
    echo "APP_URL=$PUBLIC_URL"
    echo "SERVER_URL=$PUBLIC_URL"
    echo "SESSION_SECRET=$(openssl rand -hex 32)"
    echo "DEV_LOGIN=0"
    echo "ALLOWED_EMAILS=$ALLOWED_EMAILS"
    echo "DB_PATH=$DATA/botly.db"
    echo "ENGINES_DIR=$DATA/engines"
    echo "HERMES_BIN=$HERMES_BIN"
    echo "HERMES_URL=http://127.0.0.1:8642"
    echo "HERMES_HOME_PRIMARY=$HERMES_HOME_DIR"
    echo "BOTLY_SCREENS=local"
    echo "MAX_BOTS=${MAX_BOTS:-2}"
    echo "XAI_API_KEY=${XAI_API_KEY:-}"
    echo "COMPOSIO_API_KEY=${COMPOSIO_API_KEY:-}"
  } > "$APP/.env"
  chmod 600 "$APP/.env"
fi
PUBLIC_URL="$(grep -E '^APP_URL=' "$APP/.env" | cut -d= -f2-)"
cat > /etc/supervisor/conf.d/botly-app.conf <<EOF
[program:botly-app]
command=$NODE_DIR/bin/node --env-file=$APP/.env $APP/server/dist/index.js
directory=$APP
autostart=true
autorestart=true
startsecs=3
stopasgroup=false
killasgroup=false
stdout_logfile=/var/log/botly/app.log
stdout_logfile_maxbytes=10MB
redirect_stderr=true
environment=HOME="/root",PATH="$(dirname "$HERMES_BIN"):$NODE_DIR/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
EOF

say "6/7 start everything"
systemctl enable --now supervisor >/dev/null 2>&1 || true
supervisorctl reread >/dev/null
supervisorctl update >/dev/null
supervisorctl restart botly-hermes botly-app >/dev/null || true
for _ in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null 2>&1 && break; sleep 1; done
curl -fsS "http://127.0.0.1:$PORT/api/health" >/dev/null || { echo "the app did not start:"; tail -30 /var/log/botly/app.log; exit 1; }
for _ in $(seq 1 40); do curl -fsS http://127.0.0.1:8642/health >/dev/null 2>&1 && break; sleep 1; done
curl -fsS http://127.0.0.1:8642/health >/dev/null || { echo "Hermes' API server did not start:"; tail -30 /var/log/botly/hermes.log; exit 1; }
# Give the main agent the app's tools (bot-to-bot messages, tasks, Library...).
secret="$(grep -E '^SESSION_SECRET=' "$APP/.env" | cut -d= -f2-)"
tok="$(printf 'mcp:primary' | openssl dgst -sha256 -hmac "$secret" -r | cut -d' ' -f1)"
( umask 077; cat > "$DATA/hermes-mcp-botly.yaml" <<EOF
  botly:
    url: http://127.0.0.1:$PORT/mcp/primary
    headers:
      Authorization: Bearer $tok
    timeout: 1800
    connect_timeout: 30
EOF
)
touch "$HERMES_HOME_DIR/config.yaml"
python3 "$APP/scripts/add-botly-to-hermes.py" >/dev/null 2>&1 || echo "note: could not add the app's tools to Hermes; run: python3 $APP/scripts/add-botly-to-hermes.py"

say "7/7 HTTPS"
host="${PUBLIC_URL#https://}"; host="${host%%/*}"
cat > /etc/caddy/Caddyfile <<EOF
$host {
	reverse_proxy 127.0.0.1:$PORT
}
EOF
systemctl restart caddy
sleep 5

# Follow the public IP if the server is stopped and started (AWS gives it a new one).
cat > /etc/systemd/system/botly-address.service <<EOF
[Unit]
Description=Keep Botly's address in step with the public IP
After=network-online.target supervisor.service caddy.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash $APP/scripts/refresh-address.sh

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable botly-address.service >/dev/null 2>&1

# Nightly backup at 02:30 UTC; keeps the last 3.
printf '30 2 * * * root /bin/bash %s/scripts/backup.sh >/var/log/botly/backup.log 2>&1\n' "$APP" > /etc/cron.d/botly-backup
chmod 644 /etc/cron.d/botly-backup

echo "Installing free extras (document reading, free web search)..."
bash "$APP/scripts/extras.sh" || true

echo
echo "Done. Open: $PUBLIC_URL"
echo "(If it doesn't load, open ports 80 and 443 in the server's AWS security group.)"
echo "One-time sign-in link (valid 15 minutes):"
ENV_FILE="$APP/.env" bash "$APP/scripts/sign-in-link.sh" "${ALLOWED_EMAILS%%,*}" || true
