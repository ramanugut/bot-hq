# Botly: handover notes

Everything an AI assistant or developer needs to keep working on this install. No secrets here.

## What it is
A team of AI bots, each with its own Linux screen and Chrome, chatted with from a web app.
Runs **without Orgo or any paid key**. Branch: **`free-edition`**.

- App: Node 22 + Hono + SQLite (`server/`), React + Vite (`web/`).
- Bots: [Hermes Agent](https://github.com/NousResearch/hermes-agent). The main bot ("Marvelous") is the Hermes
  install at `/root/.hermes`; extra bots get their own Hermes home under `/opt/botly/data/engines/<botId>`.
- Model: Hermes provider **openai-codex** (ChatGPT Plus sign-in), model `gpt-6-luna`, reasoning medium.
- Screens: X displays on the server (`server/src/localscreen.ts`): Xvfb + openbox + x11vnc (localhost only).
  Main bot on `:99`, others `:100`, `:101`… Chrome DevTools port = 9200 + display (main bot 9299).
- Images: Hermes `image_gen.provider: openai-codex`. Hermes replies `MEDIA:/path` lines; the app turns them into
  image cards (`server/src/agent/loop.ts`, `postImage` in `tools.ts`).
- Web search: free SearXNG remains the first-choice provider. Botly's own Tavily REST tools can read `TAVILY_API_KEY` from the app environment, `TAVILY_API_KEY_FILE`, or the primary Hermes `.env` (without copying secrets to GitHub).

## Server

The paths below apply after the [one-time migration](BOTLY-MIGRATION.md). Check the running checkout before using these paths.
- AWS EC2 instance (eu region), **t4g.small (ARM, 2 GB) + 4 GB swap**, Ubuntu 24.04, AWS free-plan credits.
- Address: `https://<public-ip-with-dashes>.sslip.io` (Caddy, Let's Encrypt). `scripts/refresh-address.sh` runs at
  boot (systemd `botly-address`) and follows a new IP after stop/start.
- Max 2 bots (memory). `MAX_BOTS` in `/opt/botly/app/.env`.

| Thing | Where |
|---|---|
| App code (git checkout of free-edition) | `/opt/botly/app` |
| App settings (secrets) | `/opt/botly/app/.env` |
| Database, VAPID keys, screen state, extra bots | `/opt/botly/data/` |
| Main bot (Hermes) config / keys | `/root/.hermes/config.yaml`, `/root/.hermes/.env`, `auth.json` |
| Bot Library files, Chrome profiles | `/root/botly/files/<botId>`, `/root/botly/profiles/<botId>` |
| Logs | `/var/log/botly/app.log`, `/var/log/botly/hermes.log` |
| Backups (nightly 02:30 UTC, keep 3) | `/opt/botly/backups/` |
| Node | `/opt/botly/node/bin` |
| Document reader (MarkItDown venv) | `/opt/botly/markitdown`, `/usr/local/bin/markitdown` |
| Free web search (SearXNG, Docker container `searxng`) | `127.0.0.1:8888`, settings in `/opt/botly/searxng/settings.yml` |

Processes (supervisor): `botly-app` (the web app, port 8787) and `botly-hermes` (`hermes gateway`, API on 127.0.0.1:8642).
Caddy serves HTTPS in front of 8787.

## Everyday commands (run as root: `sudo -i`)
```
bash /opt/botly/app/scripts/update.sh                 # pull free-edition, build, restart
supervisorctl status                               # botly-app, botly-hermes
supervisorctl restart botly-app | botly-hermes
tail -50 /var/log/botly/app.log; tail -50 /var/log/botly/hermes.log
bash /opt/botly/app/scripts/set-password.sh EMAIL     # set/reset the sign-in password
bash /opt/botly/app/scripts/backup.sh                 # backup now
bash /opt/botly/app/scripts/add-mcp.sh NAME URL       # give bots an MCP server's tools
bash /opt/botly/app/scripts/extras.sh                 # (re)install MarkItDown + SearXNG; update.sh runs it too
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
  Hermes keeps one conversation per chat (`hq-<bot>-g<gen>`; the prefix is the key existing chats are stored under, so it stays), so reopening an old chat keeps its context.
- **Heartbeat** (`server/src/heartbeat.ts`): bots with `heartbeat_min` ≥ 30 check their checklist; replying
  `HEARTBEAT_OK` (or stay_silent) removes the check-in's rows from the chat. Quiet 22:00–07:00 user time by default.
  Uses its own daily Hermes thread (`hq-<bot>-hb-<date>`). Tool `set_heartbeat`; settings in Bot settings → General.
- **read_document** tool (MarkItDown) and **free_search** tool (SearXNG). Both in `server/src/agent/tools.ts`.
- **Screens sleep** after `BOTLY_SCREEN_SLEEP_MIN` (15) idle minutes: the bot's Chrome and desk apps stop
  (`screens.asleep=1`), Xvfb stays. `screenForWork` (every turn) and opening the screen wake it. Settings →
  Computer has Sleep/Wake per screen.

## Promo video engine (Nov 2026)
- `scripts/tools/promo/`: a HyperFrames (Apache-2.0, HeyGen) template + GSAP. `make-promo.py --spec brief.json --out x.mp4`
  builds a vertical promo: auto-fitting titles, Ken Burns, transitions (zoom/whip/wipe/flash/rise), points, price
  cards with count-up, CTA, story progress bar, word-by-word captions from edge-tts WordBoundary timings.
- Bots call the `make_promo_video` tool; it renders in the background and posts a playable video card.
- Server needs `hyperframes@0.9.53` in `/opt/botly/node/bin` (extras.sh installs it) and uses `/usr/local/bin/chromium`
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

## Security and reliability changes (15 Nov 2026, GitHub only)
- Backup downloads now require the owner (BOTLY_OWNER_EMAIL, or the first ALLOWED_EMAILS
  entry) AND a fresh account password. GET /api/backups/latest was replaced with an
  authenticated POST and the account menu asks for the password. Owner-only download
  fails closed when neither owner setting exists.
- scripts/backup.sh uses an online SQLite snapshot with integrity check and a temporary,
  verified tar archive. Previous backups remain intact if the new archive fails.
- The read_document tool accepts local Library files only, with realpath containment,
  symlink checks and a 25 MB limit. Direct URLs must be downloaded separately.
- Sensitive native MCP tools now require approval (unless explicitly always allowed
  by the user), including scheduled routines and video renders.
- Heartbeat skips repeat AI calls for empty checklists with no new tasks or approvals,
  while retaining a daily review and regular checks for configured checklists.
- Video renders have one global slot, a 10-minute watchdog, and persistent job status.
- Deployment script now refuses dirty or wrong-branch checkouts, checks health after
  restart and attempts rollback on failure.
- npm run test:hardening runs a library isolation regression test and checks shell syntax.
- All changes are committed to free-edition. They are NOT deployed or verified on EC2.

**Unresolved before autonomous production work:** Hermes and bots still run as root;
Hermes browser/shell actions bypass Botly MCP approvals. Migrating to separate non-root
users, isolation and an enforceable broker requires a planned server cutover and testing.
See docs/SECURITY-HARDENING.md. Never describe this as already fixed.
 
## Tavily (code on GitHub, not yet verified on EC2)
- Native MCP tools: `tavily_search`, `tavily_extract`, `tavily_map`, `tavily_crawl`, `tavily_research`, and `tavily_research_status`. These use Tavily's REST API without installing a CLI or extra Node packages.
- Search and extract are read-only calls. Mapping, crawling, and starting a deep research job require approval in Botly because they can consume more Tavily credits. Research uses Tavily `mini` and returns a task ID; check with `tavily_research_status`.
- Website targets must be public HTTP(S) hostnames; crawling is bounded to 8 pages, mapping to 30, and external domains are disabled. Web content is untrusted data.
- Configure the API key outside GitHub: in `/opt/hq/app/.env` as `TAVILY_API_KEY`, via `TAVILY_API_KEY_FILE`, or in the primary Hermes `.env` (existing setup). No need to copy a real key into source code.
- After an owner-approved deployment: verify the key is available, run `npm run typecheck`, `npm run test:hardening` and ask a Botly bot to run `tavily_search` for a harmless query. Check Tavily dashboard usage. No live Tavily test from this GitHub-only change.

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

## UI refinement (15 Nov 2026, GitHub only)
- The inline thinking mascot/status box was replaced by a monochrome, animated activity signal in `web/src/components/ActivityLine.tsx` and `web/src/styles/refinement.css`. Modes follow existing Hermes live activity and running tools (thinking, search, read, browser, write, code, create, connect and waiting). No new tools or background activity are implied.
- Botly's main toolbar, shared icons, settings icons and Tasks icon have softer outlines, rounded controls, quiet shadows and tighter grouping. Existing actions and navigation remain unchanged. Reduced-motion settings stop activity animations.
- CSS refinement loads last from `web/src/main.tsx`; change or remove it to adjust the style without rewriting existing layout styles.
- The same UI-only changes are backported to `legacy-hq-tavily` for servers still using `/opt/hq`. Deploy that branch only on the old layout; do not run the renamed `free-edition` updater there. Neither branch was deployed by these GitHub commits.

## UI polish layer (16 Nov 2026, GitHub only)
- `web/src/styles/polish.css` loads last from `web/src/main.tsx` (after `refinement.css`). It is look-and-feel only: ink (#111318 family) dark surfaces and one mint accent (#7CF0C4, from the app icon) via `--color-accent*` tokens, one focus-ring style, a taller composer whose focus ring sits on the whole box (fixes the stray rectangle around the message field), a header fade so messages no longer slide under the floating pills, small-caps section labels, the model chip on its own line in the details panel, a mint sign-in button, and larger touch targets on phones.
- `Sidebar.tsx` gained a "Botly" wordmark (`.sidebar__brand`, uses `/icon.svg`). No other markup, layout, navigation or behaviour changed.
- Checked with `?fixtures` in Vite against a mocked API (desktop and 390px, light and dark). Not deployed and not checked on the EC2 server. Remove the import to undo.
