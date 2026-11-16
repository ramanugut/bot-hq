# Primary Hermes and desktop security: staged cutover

**Status: backend changes prepared in a separate feature branch. No GitHub merge,
server restart, live credential migration or AWS deployment has happened.**

This builds on [RESTRICTED-AGENTS.md](RESTRICTED-AGENTS.md), the earlier
managed-agent security PR. Claude's UI work on free-edition is untouched.

## What is now prepared

- Xvfb may use a root-private Xauthority cookie instead of unrestricted -ac:
  set BOTLY_X11_AUTH=secure only during an owner-approved screen cutover.
- A previously running Xvfb without authenticated startup is rejected, not reused.
- Root-controlled desktop manager receives the Xauthority path. Its launched
  desktop processes no longer inherit the app's SESSION_SECRET or other API keys.
- Rootless primary gateway: a staged copy of /root/.hermes with existing
  authentication, chats and model settings preserved; API tools restricted to
  selected read/creation capabilities and Botly's approval-mediated MCP.
- The primary Hermes listener's effective UID is checked through Linux /proc.
  A root-owned listener will be refused when BOTLY_PRIMARY_SECURITY_MODE=restricted.
- The same owner approval broker supports both primary and managed bots.
- Approved shell is disabled by default. To enable it later requires
  BOTLY_SHELL_SANDBOX=bubblewrap and a working Bubblewrap sandbox with no network,
  access only to that agent's private workspace, a short timeout and bounded output.
  No raw host-shell fallback is permitted.
- Read-only/staged migration script: scripts/security-primary-cutover.py.
  It does not change the live Supervisor or app .env files.

## Critical limitations

This is **not yet complete multi-tenant isolation**:
- The root-owned Botly web process still orchestrates Xvfb, Chrome, VNC,
  HyperFrames and the existing shared desktop support programs.
- Native Chrome CDP listeners are still on localhost, where an unsandboxed
  unprivileged process could connect. Do not allow an agent arbitrary code
  execution outside a verified sandbox. Additional egress rules are planned.
- The primary Hermes gateway currently remains root on production until a
  separately approved migration takes place. Stage files are NOT activation.
- A full cutover also needs the per-bot libraries and Chrome profiles moved
  out of /root, new ownership for desktop helpers, and CDP isolation.
- Bubblewrap may be prevented by Ubuntu user namespace/AppArmor policy.
  It must fail closed rather than disable its isolation settings.
- Botly MCP approvals are enforced only for calls through Botly MCP; other
  Hermes/plugin tools must be blocked through config or OS policy.
- Stage source must contain no symlinks/special files. The script refuses a
  profile it cannot safely copy.
- We have not inspected the running EC2 host, its permissions or its credentials.
  Do NOT claim success on AWS until all live acceptance tests pass.

## Read-only check

Only run on a host that has completed the /opt/botly migration, not on legacy
/opt/hq. From the server's current checkout:

    npm run typecheck
    npm run build
    npm run test:hardening
    python3 scripts/security-primary-cutover.py --check
    bash scripts/provision-managed-agents.sh --check

The primary checker verifies the original Hermes configuration and the
required Botly MCP link. It does not print keys or authentication data.

## Future owner-approved maintenance window

Before executing any stage/cutover:
1. Confirm server migration is complete, the code is deployed and EC2 rollback
   is available. Create a server snapshot and a backup that has been restored
   successfully in an isolated test environment. Test that logins remain valid.
2. Install a supported Hermes runtime into a root-controlled location accessible
   by non-root users. A binary in /root/.local/bin is NOT suitable.
3. Plan a short outage and stop the primary Hermes gateway before copying its
   live state. The staging script refuses to copy a running gateway.
4. Review and run, from an interactive SSH terminal, NOT inside a bot:

    BOTLY_PRIMARY_STAGE=YES HERMES_SHARED_BIN=/opt/botly/hermes/bin/hermes \
      python3 scripts/security-primary-cutover.py --stage

   This creates a dedicated Linux user and a root-private staging directory
   containing a Hermes copy and candidate Supervisor/app settings. It does NOT
   install the candidates, move the files to the live destination or restart.
5. After reviewing the candidate config and confirming the model runtime can run
   as botly_primary, explicitly approve a cutover procedure with rollback.
   Move only the staged Hermes home to /opt/botly/primary, and atomically install
   the candidate service and app environment files. Test the primary gateway
   under its new UID, then restart the app and verify health. Restore the old
   Supervisor/app settings immediately if any check fails.
6. Secure the X11 displays separately: stop the existing -ac Xvfb, VNC and
   Chrome sessions in a controlled change window, set BOTLY_X11_AUTH=secure,
   and restart the desktop manager. Verify fresh Xauthority files are root-only,
   screen sharing works and unmanaged local users cannot connect.
7. Verify denial and approval on real test pages (not payment/hosting admin),
   library access, voice, image generation, chat history, live screens,
   sleep/wake, background jobs, snapshots and bot isolation.
8. Only after Bubblewrap works with network unshared and filesystem mounts
   restricted may BOTLY_SHELL_SANDBOX=bubblewrap be enabled.
9. Test safe rollback and restoration of original state and sign-ins.

The staging files include secrets and must remain mode 0700/0600 under
/opt/botly/security-staging. Never upload them or put their contents into
GitHub, logs or chat.

## Review checklist before merging

- All GitHub CI type checks and unit tests pass.
- Integration is rebased/reviewed against latest Claude work on free-edition.
- The primary shared Hermes executable and stage migration are tested on an
  isolated Ubuntu ARM64 environment with the same UID and filesystem layout.
- The Browser Use feature PR is reviewed for direct shell/browser tool exposure.
- The primary cutover is approved separately from this source-code change.
