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
| Document reader (MarkItDown venv) | `/opt/hq/markitdown`, `/usr/local/bin/markitdown` |
| Free web search (SearXNG, Docker container `searxng`) | `127.0.0.1:8888`, settings in `/opt/hq/searxng/settings.yml` |

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
bash /opt/hq/app/scripts/extras.sh                 # (re)install MarkItDown + SearXNG; update.sh runs it too
docker logs searxng | tail                         # free search not answering?
hermes model                                       # change provider/model (interactive)
```

## Fresh install
See the header of `scripts/install-local.sh` (clone, install Hermes + `hermes model`, run the script, set password).

## Features added in Phase 1 (Nov 2026)
- **Chats per bot**: each "generation" of `rows` is a chat; table `chats` holds title, archived, and a one-time
  `note` handed to the bot on its next turn (merged chat content, or what a heartbeat posted). Routes
  `GET /api/bots/:id/chats`, `POST /api/bots/:id/chats/:gen/{open|rename|archive|unarchive|delete|merge}`.
  UI: `web/src/components/ChatsPanel.tsx` (Chats button in the chat header; clicking the open bot again).
  Hermes keeps one conversation per chat (`hq-<bot>-g<gen>`), so reopening an old chat keeps its context.
- **Heartbeat** (`server/src/heartbeat.ts`): bots with `heartbeat_min` ≥ 30 check their checklist; replying
  `HEARTBEAT_OK` (or stay_silent) removes the check-in's rows from the chat. Quiet 22:00–07:00 user time by default.
  Uses its own daily Hermes thread (`hq-<bot>-hb-<date>`). Tool `set_heartbeat`; settings in Bot settings → General.
- **read_document** tool (MarkItDown) and **free_search** tool (SearXNG). Both in `server/src/agent/tools.ts`.
- **Screens sleep** after `HQ_SCREEN_SLEEP_MIN` (15) idle minutes: the bot's Chrome and desk apps stop
  (`screens.asleep=1`), Xvfb stays. `screenForWork` (every turn) and opening the screen wake it. Settings →
  Computer has Sleep/Wake per screen.

## Promo video engine (Nov 2026)
- `scripts/tools/promo/`: a HyperFrames (Apache-2.0, HeyGen) template + GSAP. `make-promo.py --spec brief.json --out x.mp4`
  builds a vertical promo: auto-fitting titles, Ken Burns, transitions (zoom/whip/wipe/flash/rise), points, price
  cards with count-up, CTA, story progress bar, word-by-word captions from edge-tts WordBoundary timings.
- Bots call the `make_promo_video` tool; it renders in the background and posts a playable video card.
- Server needs `hyperframes@0.9.53` in `/opt/hq/node/bin` (extras.sh installs it) and uses `/usr/local/bin/chromium`
  via `HYPERFRAMES_BROWSER_PATH`; renders with `--low-memory-mode`, CRF 21. Telemetry off.
- Fonts (Montserrat, Inter, Playfair Display, Fredoka, Cormorant Garamond: all OFL) and gsap.min.js are vendored in `template/`.
- Styles (`style`): neon, minimal, editorial, playful, luxury (CSS tokens in index.html + motion table STY in engine.js);
  the tool rotates them per bot when none is given (`<Library>/.promo-style`). Formats (`format`): portrait, square,
  landscape (CSS vars per `fmt-*` class). Scenes: hero, image, points, prices, quote, compare, steps, stats, phone, cta;
  any scene can take a `video` background. `make-promo.py --preview DIR` saves one still per scene without rendering.
- Free-form: `render_video_project` renders a HyperFrames project the bot wrote in its Library; `/usr/local/bin/hyperframes`
  (from extras.sh) is a wrapper with our Node, Chromium and telemetry off.

## Things learned the hard way
- `update.sh` runs inside one function so the `git reset` that rewrites it mid-run can't break it.
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
