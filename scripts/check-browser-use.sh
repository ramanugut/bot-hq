#!/usr/bin/env bash
# Read-only check for Hermes' built-in Browser Use CLI bridge.
# Does not install packages, change config, start a browser, or print secrets.
set -euo pipefail

echo 'Botly Browser Use integration check'
echo '-----------------------------------'
if ! command -v hermes >/dev/null 2>&1; then
  echo 'Hermes CLI: NOT FOUND in PATH'
else
  echo 'Hermes CLI: found'
  # A tool listing confirms support in the installed Hermes version,
  # not that the tool is enabled for the running API-server gateway.
  if hermes chat --list-tools 2>/dev/null | grep -q 'browser_exec'; then
    echo 'Native browser_exec: supported by this Hermes CLI'
  else
    echo 'Native browser_exec: NOT CONFIRMED (check Hermes version/tools)'
  fi
fi

# Botly's primary CDP URL is normally localhost:9299, but do not assume that
# a sleeping browser means the installation is broken. Never print page data.
CDP_URL="${PRIMARY_CDP_URL:-http://127.0.0.1:9299}"
case "$CDP_URL" in
  http://127.0.0.1:*|http://localhost:*|http://\[::1\]:*)
    if curl --silent --show-error --fail --max-time 2 "$CDP_URL/json/version" >/dev/null 2>&1; then
      echo 'Primary browser CDP: responding'
    else
      echo 'Primary browser CDP: not responding (browser may be sleeping)'
    fi
    ;;
  *) echo 'Primary browser CDP: custom endpoint; not contacted by this read-only checker' ;;
esac

if [ "${BOTLY_BROWSER_USE_TOOLSETS:-0}" = '1' ]; then
  echo 'Managed-bot Browser Use toolsets: opt-in is set in this shell'
else
  echo 'Managed-bot Browser Use toolsets: opt-in not set in this shell'
  echo 'The live app environment may differ; inspect the flag without printing .env files.'
fi
echo 'Note: this does NOT prove browser_exec is available in a running bot or that actions are safely isolated.'
