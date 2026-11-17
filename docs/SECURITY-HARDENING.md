# Botly security migration — remaining work

This document is a safety plan, not a script that automatically changes a running server.
The running free-edition install is still configured to execute Hermes and the local
desktops as root. Browser and shell actions invoked directly inside Hermes do not go
through the Botly MCP approval cards.

## Code-side protections now implemented
- The app's sensitive internal MCP actions require explicit user approval.
- Downloads of server-wide backups require an owner login and password confirmation.
- The document reader only opens files within the calling bot's own Library.
- Backups are snapshotted and verified before rotation.
- Deployment attempts a rollback after a failed build, restart or health check.
- Heartbeat and video render jobs are bounded to reduce resource pressure.

These protections limit some accidental behaviour but **do not** sandbox Hermes' own
root shell or browser actions. Treat the agent as privileged until that is resolved.

## Proposed non-root cutover (requires owner approval before executing)
1. Create a backup, verify that it can be restored on a separate test machine, and
   create a server snapshot. Do not store an unencrypted backup in a public location.
2. Establish a dedicated unprivileged system user for each agent or, as a smaller
   first step, a single restricted agent user. Keep the main web server/control
   service separate and privilege its helper commands narrowly.
3. Move each Hermes home, browser profile, and per-bot Library out of /root, into
   per-agent directories with restricted ownership and permissions. Preserve the
   existing ChatGPT sign-in through a documented migration; never copy credentials
   into code, logs or chat.
4. Change the Supervisor Hermes programs to launch as restricted users, and grant
   access to their own Xvfb/Chromium sessions only. Keep MCP gateway ports on
   loopback and test CDP connections with the new users.
5. Separate bot-specific workspaces and secrets. Restrict network egress to
   necessary destinations and block cloud metadata endpoints. Validate the
   filesystem boundary and non-root identity with commands run *inside* each bot.
6. Place shell and browser actions behind an OS-enforced approval broker. If Hermes
   cannot guarantee this, keep sensitive actions disabled until a secure integration
   is available. Prompt instructions alone are never an approval mechanism.
7. Run chat, browser, screen sharing, generated media, file upload, document reads,
   cron, image generation and bot-to-bot acceptance tests. Test denial paths,
   malicious documents and a failed process recovery.
8. Only after success, switch Supervisor services through an approved deployment.
   Maintain a documented rollback to the previous working service layout.

## Deployment checks
- `npm ci --ignore-scripts --no-audit --no-fund`
- `npm run typecheck`
- `npm run build`
- `node --test tests/hardening.test.mjs`
- `bash -n scripts/backup.sh scripts/update.sh`
- Run a real test backup and verify it can be extracted into an isolated directory.
- Test `POST /api/backups/latest`: unauthenticated -> 401, nonowner -> 403,
  owner with bad password -> 403, owner with correct password -> a verified archive.
- Test malicious `read_document` inputs: relative traversal, absolute sensitive
  file path, symlink to another bot, URL to local services, and oversized document.
- Deliberately fail the candidate build and health check in a staging deployment to
  verify the rollback logic before production.
- Confirm the nightly backup job and the site's Caddy HTTPS configuration.

## Known limits
- With a checklist, each heartbeat still calls Hermes at the selected interval.
- Media display can read arbitrary files accessible to the Hermes/app user and
  must be fully sandboxed before multi-tenant production use.
- The backup is sensitive and not encrypted by the application; protect it offline.
- The deployment rollback is a best-effort script, not a fully staged release system.
- Python/Chromium video rendering can still contend with RAM on the t4g.small;
  verify a full render and monitor memory under real workload.

Nothing in this plan authorizes a server restart, service migration or deployment.
