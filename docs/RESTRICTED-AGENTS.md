# Restricted Agent Mode — staged backend security change

**Implementation state:** Prepared on a separate branch. **Not merged, deployed,
or validated against EC2.** No UI changes. It protects **managed** Hermes
gateways only. It does not secure the primary Hermes process by itself.

## Threat model and key finding

The stock Hermes `hermes-api-server` toolset is a **full-access composite**:
it includes terminal, browser, file editing and code execution. Adding a Botly
MCP approval card does not protect actions launched through those native tools.
Browser Use's `browser_exec` runs Python, which is too powerful to expose from
an unrestricted root Hermes process.

Restricted mode replaces that composite with an explicit API-server allowlist
(`mcp-botly`, search, vision, image generation, tasks and memory) and subtracts
dangerous toolsets. External MCP servers are removed from the managed bot's
direct configuration, so app integrations are mediated by Botly's MCP gateway.

## What is implemented

- Per-bot Linux usernames derived from stable hashes of bot IDs.
- A read-only preflight and guarded **offline** account/ownership provisioner.
- Managed Hermes gateway launched with its own `uid` and `gid` when restricted
  mode is enabled; never silently falls back to root.
- Runtime refuses to reuse a managed gateway with an unexpected process UID.
- Hermes config and auth files written through atomic replacement with
  file-descriptor permissions, avoiding symlink-based privileged writes.
- Strict allowlisted API-server toolsets; direct terminal/browser/computer
  tools and unrelated MCP servers disabled for managed bots.
- `approved_shell` MCP tool: one reviewed command, under the bot's UID and
  private workspace, with a maximum timeout and bounded output.
- `browser_inspect`: reads the active visible tab without changing it.
- `approved_browser_action`: only navigate, click or type using the bot's
  existing Chrome CDP, each call waiting for an approval card.
- A metadata-only audit table `restricted_action_audit` (action name and
  success/failure/status, no command text or tokens). Approval decisions are
  also recorded in the existing Botly approvals table.
- Regression tests for the toolset, path, user and URL guards.

High-risk approved tools **always ask**. An existing `always_allow` policy
does not suppress these prompts.

## What is not yet secure

1. **Primary bot**: still a separate root-owned Hermes installation in
   `/root/.hermes`. This branch intentionally never modifies it.
2. **Linux desktop isolation**: Xvfb currently uses `-ac` and Chrome CDP is
   on localhost; per-bot desktop access is not yet OS-isolated.
3. **Root-owned app and workers**: Botly's application, screen manager and
   media renderers still run as root. Only managed Hermes gateways change UID.
4. **Network controls**: an unprivileged process can still connect to local
   ports and public websites. The URL guard rejects obvious private URLs but
   **cannot stop redirects, DNS rebinding or page scripts**. OS-level
   egress controls are still required.
5. **Hermes config integrity**: the runtime profile resides in a bot-owned
   writable home. Native high-risk tools are disabled by config but an
   exploited process may tamper with that config. Immutable, root-controlled
   policy enforcement is a separate required step.
6. **Full Browser Use automation**: native `browser_exec` remains disabled in
   restricted mode. The approved CDP broker offers a deliberately smaller
   operation set and has not been exercised against real websites.
7. **New bots**: require an OS account to be provisioned before their managed
   gateway can start. The app refuses to fall back to root.
8. **The existing UI** may still show an `Always allow` option on the approval
   card. High-risk broker actions ignore any stored always-allow permission.

**Do not claim that Botly is fully sandboxed or that unattended sensitive
browser operations are safe.**

## Read-only evaluation

From a genuine Botly checkout, without printing secrets:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm run build
npm run test:hardening
bash scripts/provision-managed-agents.sh --check
```

The checker identifies managed bots whose Linux account or home ownership
is missing. It does not change the server.

## Owner-approved cutover (NOT AUTHORIZED BY THIS DOCUMENT)

A production change requires a separate approval, an EC2 snapshot, a verified
Botly backup, a maintenance window, and a tested rollback.

1. Confirm which checkout is actually running. The server might still be
   on the legacy `/opt/hq` layout.
2. Verify the Hermes executable and its Python environment are executable by
   non-root Linux users. A binary under `/root/.local` is **not** accessible.
   Move/install a supported Hermes runtime into a shared root-controlled
   directory before attempting the cutover.
3. Stop **both** Botly app and all managed Hermes gateways. Do not run an
   ownership migration while they are writing data.
4. After a verified backup, review and run the provisioner in an **SSH**
   session. Apply requires root, an interactive terminal and the explicit
   `BOTLY_SECURITY_CUTOVER=YES` flag:

   ```sh
   BOTLY_SECURITY_CUTOVER=YES bash scripts/provision-managed-agents.sh --apply
   ```

5. Run the read-only `--check` again and confirm home permissions. Set
   `BOTLY_AGENT_SECURITY_MODE=restricted` in the app's private environment
   **only after** the running gateway accounts are prepared.
6. Restart the app and managed gateways under an approved change window.
   Existing root managed gateways must be stopped: restricted Botly will
   refuse to adopt them.
7. Verify each managed gateway's effective UID, model authentication, chat,
   memory, bot Library tools, live screen, approved shell, approved browser
   actions, denied actions, timeouts, and resource consumption.
8. Test denial/expiry of approval and a malicious webpage before allowing
   business-critical sites. No payments, domain changes, messaging or deletion
   until stronger broker and egress checks are proved.
9. If anything fails, disable restricted mode and restore the approved
   snapshot/checkpoint. Do not casually downgrade permissions on a live system.

## Follow-up work before claiming completion

- Migrate the primary Hermes process and its credentials into a dedicated
  non-root identity with independent rollback.
- Move all bot file and browser profiles out of `/root` to per-agent directories.
- Replace Xvfb `-ac` with per-display Xauthority cookies; isolate CDP listeners.
- Enforce outbound network policy per agent, including cloud metadata routes.
- Move privileged approvals into an OS-enforced broker (or a dedicated
  sandbox) that cannot be bypassed by changed agent config or terminal code.
- Make the broker's "always allow" policy explicit in the UI after Claude's
  current UI work is complete.
- Run live end-to-end tests on staging before enabling production.

See also `docs/SECURITY-HARDENING.md`.
