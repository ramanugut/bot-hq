# Move the existing EC2 installation to Botly

Use this migration for the standard Ubuntu EC2 installation with the `hq-app`
and `hq-hermes` Supervisor services and the SQLite database at `/opt/hq/data/hq.db`.
Run it as root during a maintenance window. It builds Botly before stopping
services. Chats, bot files, browser profiles and Hermes homes are carried over.
Active bot work and live browser windows are interrupted during the cutover.

## Check first

From the EC2 terminal, run:

```bash
sudo -i
git -C /opt/hq/app fetch origin free-edition
git -C /opt/hq/app show FETCH_HEAD:scripts/migrate-to-botly.sh > /root/migrate-to-botly.sh
bash /root/migrate-to-botly.sh --check
```

When the check passes and bot work is idle, run:

```bash
bash /root/migrate-to-botly.sh --apply
supervisorctl status botly-app botly-hermes
```

The migration makes a verified backup in a root-only recovery directory under
`/opt`. If the cutover fails, it attempts to restore the previous paths, checkout,
services and configuration, then checks their health. Keep the recovery directory
private because it contains credentials. The new services and nightly backup use
`/opt/botly`, `/root/botly` and `/var/log/botly`. Existing backups stay readable.
Old `/opt/hq` and `/root/grokbot` paths become symlinks for historical file links,
existing Python environments and Docker mounts. Hermes conversation IDs stay stable.

After the cutover, sign in to the app, reopen a previous chat, open a saved
Library file, check the live desktop and ask a bot to list its tasks through MCP.
Future updates use `bash /opt/botly/app/scripts/update.sh`.

## Rename the GitHub repository

In the repository Settings, set the repository name to `botly`. GitHub redirects
normal Git operations from the old URL. If the migration ran first, update the
EC2 checkout after renaming:

```bash
git -C /opt/botly/app remote set-url origin https://github.com/ramanugut/botly.git
git -C /opt/botly/app fetch origin free-edition
```
