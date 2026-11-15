#!/usr/bin/env bash
# Set (or reset) the sign-in password for an account, on the server itself, as root:
#   bash set-password.sh you@example.com
# It asks for the password without showing it. Then sign in on any device with that email and password.
set -euo pipefail
email="${1:?usage: set-password.sh <email>}"
ENV_FILE="${ENV_FILE:-/opt/hq/app/.env}"
val() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2-; }
read -rsp "New password (8+ characters): " pw; echo
read -rsp "Same password again: " pw2; echo
[ "$pw" = "$pw2" ] || { echo "The two passwords are not the same."; exit 1; }
key="$(printf 'owner-login' | openssl dgst -sha256 -hmac "$(val SESSION_SECRET)" -r | cut -d' ' -f1)"
body="$(EMAIL="$email" PW="$pw" python3 -c 'import json,os;print(json.dumps({"email":os.environ["EMAIL"],"password":os.environ["PW"]}))')"
curl -fsS -X POST "http://127.0.0.1:$(val PORT)/api/auth/owner" -H "authorization: Bearer $key" -H 'content-type: application/json' --data-binary @- <<<"$body" && echo
