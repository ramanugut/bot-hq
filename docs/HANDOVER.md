# Bot HQ (free edition): handover notes

Everything an AI assistant or developer needs to keep working on this install. No secrets here.

## What it is
A team of AI bots, each with its own Linux screen and Chrome, chatted with from a web app.
Fork of nickvasilescu/bot-hq, changed to run **without Orgo or any paid key**. Branch: **`free-edition`**.

- App: Node 22 + Hono + SQLite (`server/`), React + Vite (`web/`).
- Bots: [Hermes Agent](https://github.com/NousResearch/hermes-agent). The main bot ("Doug") is the Hermes
  install at `/root/.hermes`; extra bots get their own Hermes home under `/opt/hq/data/engines/<botId>`.
- Model: Hermes provider **openai-codex** (ChatGPT Plus sign-in), model `gpt-6-luna`, reasoning medium.
- Screens: X displays on the server (`server/src/localscreen.ts`): Xvfb + openbox + x11vnc (localhost only).
  Main bot on `:99`, others `:100`, `:101`… Chrome DevTools port = 9200 + display (main bot 9299).
- Images: Hermes `image_gen.provider: openai-codex`. Hermes replies `MEDIA:/path` lines; the app turns them into
  image cards (`server/src/agent/loop.ts`, `postImage` in `tools.ts`).
- Web search: Tavily key in `/root/.hermes/.env`.

## Server
- AWS EC2 `bot-hq`, eu region, **t4g.small (ARM, 2 GB) + 4 GB swap**, Ubuntu 24.04, AWS free-plan credits.
- Address: `https://<public-ip-with-dashes>.sslip.io` (Caddy, Let's Encrypt). `scripts/refresh-address.sh` runs at
  boot (systemd `hq-address`) and follows a new IP after stop/start.
- Max 2 bots (memory). `MAX_BOTS` in `/opt/hq/app/.env`.

| Thing | Where |
|---|---|
| App code (git checkout of free-edition) | `/opt/hq/app` |
| App settings (secrets) | `/opt/hq/app/.env` |
| Database, VAPID keys, screen state, extra bots | `/opt/hq/data/` |
| Main bot (Hermes) config / keys | `/root/.hermes/config.yaml`, `/root/.hermes/.env`, `auth.json` |
| Bot Library files, Chrome profiles | `/root/grokbot/files/<botId>`, `/root/grokbot/profiles/<botId>` |
| Logs | `/var/log/hq/app.log`, `/var/log/hq/hermes.log` |
| Backups (nightly 02:30 UTC, keep 3) | `/opt/hq/backups/` |
| Node | `/opt/hq/node/bin` |

Processes (supervisor): `hq-app` (the web app, port 8787) and `hq-hermes` (`hermes gateway`, API on 127.0.0.1:8642).
Caddy serves HTTPS in front of 8787.

## Everyday commands (run as root: `sudo -i`)
```
bash /opt/hq/app/scripts/update.sh                 # pull free-edition, build, restart
supervisorctl status                               # hq-app, hq-hermes
supervisorctl restart hq-app | hq-hermes
tail -50 /var/log/hq/app.log; tail -50 /var/log/hq/hermes.log
bash /opt/hq/app/scripts/set-password.sh EMAIL     # set/reset the sign-in password
bash /opt/hq/app/scripts/backup.sh                 # backup now
bash /opt/hq/app/scripts/add-mcp.sh NAME URL       # give bots an MCP server's tools
hermes model                                       # change provider/model (interactive)
```

## Fresh install
See the header of `scripts/install-local.sh` (clone, install Hermes + `hermes model`, run the script, set password).

## Things learned the hard way
- Main bot needs `browser.cdp_url: http://127.0.0.1:9299` and `computer_use` in `platform_toolsets.api_server`
  in `/root/.hermes/config.yaml`, plus `hermes computer-use install` and `at-spi2-core`. Without it the bot uses a
  hidden browser and claims success while the Live screen shows nothing.
- Hermes `approvals.mode: off`: its approval prompts can't be answered through the app (they time out).
  Bots are told in their prompt to ask in chat before posting, sending, paying, deleting or submitting.
- Hermes fixes a conversation's system prompt; the app re-sends changed instructions/skills in the next message.
- Origin check (`server/src/origin.ts`) needs `APP_URL` to match the public address.
- Codespaces needs `PARALLAX_ORIGIN` (that was the separate ReelForge app, not this one).
- Composio (connected apps), xAI (voice, X search) and Orgo are optional and off; their buttons are hidden.

## Open items
1. Usage meter (`server/src/usage.ts`) shows nothing yet: the shape of Hermes' `auth.json` and the Codex
   usage endpoint response need checking on the server.
2. Bots still run as root. Plan: a `bots` user for Hermes gateways, Chrome and Xvfb, with the app as root.
3. Telegram via `hermes gateway setup` (optional).
4. Edge-tts voice-over untested on the server.

## Rules for whoever works on this
- Never paste the EC2 `.pem` key, passwords or API keys into a chat. The owner types secrets into the server
  terminal at hidden prompts (`read -rsp`).
- Commit to `free-edition`, then run `scripts/update.sh` on the server.
- Ask the owner before anything that costs money (bigger EC2, paid APIs).
