# Browser Use for Botly — optional Hermes integration

**Status:** Backend integration prepared on a feature branch; not merged or deployed. No UI changes.

## Why use the built-in integration?

Recent [Hermes Agent](https://github.com/NousResearch/hermes-agent) versions already
ship `browser_exec` (via `browser-harness`, the Browser Use CLI engine). Adding
the separate Browser Use hosted agent or another Python REPL inside Botly would
duplicate capabilities, consume RAM, and could require a paid model API.

The native `browser_exec` tool executes browser operations using the Hermes
model you already configured. When `browser.cdp_url` is set, it attaches to
Botly's existing Chrome for that bot, preserving the live screen and profile.

This integration **does not use Browser Use Cloud** or create a paid subscription.

## Managed bots (secondary)

A Botly-managed Hermes gateway already receives a per-bot
`browser.cdp_url` and `BROWSER_CDP_URL`. On the server where Botly runs,
setting `BOTLY_BROWSER_USE_TOOLSETS=1` tells Botly to include both
`terminal` and `browser` in the managed gateway's API-server toolsets.
Existing toolsets are preserved.

Default is **off** while Hermes/browser processes still run with root access.
Only enable after reviewing the security warnings below. Newly written
managed-bot config takes effect the next time that managed Hermes gateway is
started. A healthy existing gateway is reused, so changing the environment
alone does **not** reload a running bot.

## Primary bot

Botly intentionally does not rewrite the primary Hermes configuration.
For a supported Hermes version, the owner can review these commands on the
server (they modify the primary profile, so do not run without approval):

```sh
hermes tools enable terminal --platform api_server
hermes tools enable browser --platform api_server
```

Confirm the primary Hermes config still points to the existing Chrome CDP
endpoint (`127.0.0.1:9299` in the standard Botly configuration). Do not
paste the full config, auth.json or .env file into a chat. Changing toolsets
may require an approved gateway restart and a new conversation.

## Read-only preflight

From the server, using the correct Botly checkout:

```sh
bash scripts/check-browser-use.sh
```

This reports whether Hermes exposes the native `browser_exec` tool and whether
the primary Chrome CDP endpoint is answering. It does not change anything.
A passing preflight is not proof of end-to-end browser functionality.

## Acceptance tests after an owner-approved cutover

1. Confirm `browser_exec` is exposed to the API-server session (not merely
   in the Hermes CLI's global tool list).
2. Ask the bot to open `https://example.com`, report the title and take a
   screenshot through `browser_exec`. Verify the bot's **existing** live
   screen shows the same page.
3. Check that a second bot uses a different CDP endpoint and Chrome profile.
4. Confirm Browser Use Cloud is not selected and that no paid Browser Use API
   key is required.
5. Verify start/restart, sleep/wake and timeouts do not leave a runaway
   browser process. Check RAM, swap, browser logs and renderer usage.
6. Attempt a write operation in a dedicated test account. The owner must be
   able to approve/deny before the action; do not assume text prompts are a
   reliable approval mechanism.

## Security gate: NOT approved for unrestricted autonomous use

The `browser_exec` tool runs model-written Python and requires `terminal`;
both are **privileged** while Hermes runs as root. Botly's MCP approval cards
do not intercept native Hermes browser or shell calls. A per-tool instruction
to ask permission is **not** a technical control.

Do not enable browser automation for unattended sensitive operations until
Bots have least-privilege users and an enforceable approval broker. Avoid using
it on payments, production hosting administration, domain transfers, deleting
data or sending messages without independent, enforceable approval.

Reference: `docs/SECURITY-HARDENING.md`.

## Compatibility and rollback

- Requires a Hermes version with native `browser_exec` and bundled
  `browser_harness`. Older Hermes may have different browser tools.
- Does not add another paid model or require a new browser installation.
- Removing `BOTLY_BROWSER_USE_TOOLSETS=1` stops Botly from adding the
  toolsets to future **fresh** managed configurations, but previously saved
  toolsets remain until explicitly removed from the managed profile.
- Botly must not automatically restart or update primary Hermes.
- On a server still using `/opt/hq`, resolve the actual checkout and service
  names first; this branch follows the post-migration `/opt/botly` layout.

Upstream docs:
- https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/browser.md
- https://github.com/NousResearch/hermes-agent/blob/main/tools/browser_use_cli.py
- https://github.com/browser-use/browser-use
