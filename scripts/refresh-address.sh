#!/usr/bin/env bash
# Keep the app's address in step with the server's public IP (run at boot by botly-address.service).
# Only for the free https://<ip-with-dashes>.sslip.io address; a custom address is left alone.
set -euo pipefail
ENV_FILE="${ENV_FILE:-/opt/botly/app/.env}"
cur="$(grep -E '^APP_URL=' "$ENV_FILE" | cut -d= -f2-)"
case "$cur" in https://*.sslip.io) ;; *) echo "custom address $cur: nothing to do"; exit 0 ;; esac
ip=""
for _ in $(seq 1 30); do
  ip="$(curl -fsS --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]' || true)"
  [[ "$ip" =~ ^[0-9]+(\.[0-9]+){3}$ ]] && break
  ip=""; sleep 2
done
[ -n "$ip" ] || { echo "could not find the public IP"; exit 1; }
new="https://${ip//./-}.sslip.io"
[ "$new" = "$cur" ] && { echo "address unchanged: $cur"; exit 0; }
sed -i -e "s|^APP_URL=.*|APP_URL=$new|" -e "s|^SERVER_URL=.*|SERVER_URL=$new|" "$ENV_FILE"
port="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2-)"
printf '%s {\n\treverse_proxy 127.0.0.1:%s\n}\n' "${new#https://}" "${port:-8787}" > /etc/caddy/Caddyfile
systemctl restart caddy
supervisorctl restart botly-app >/dev/null
echo "address changed: $cur -> $new"
