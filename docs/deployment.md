# OpenJobSlots Deployment

Production source of truth is the private GitHub repository:

`https://github.com/batuhanboran/openjobslots`

The ltx100 host runs `/root/OpenPostings` and deploys from `main` using a systemd timer. The timer checks GitHub every minute, rebuilds the Docker Compose stack only when `main` changes, and preserves runtime data in `.env`, `data/`, and `.deploy-backups/`.

## ltx100 Services

- `openjobslots-app`
- `openjobslots-worker`
- `openjobslots-postgres`
- `openjobslots-meilisearch`
- `openjobslots-deploy.timer`

## Deploy Key

The server uses `/root/.ssh/openjobslots_deploy` as a read-only GitHub deploy key. Add the public key to GitHub at:

`Settings -> Deploy keys -> Add deploy key`

Use read-only access. Write access is not needed.

## Useful Commands

```bash
systemctl status openjobslots-deploy.timer
systemctl start openjobslots-deploy.service
journalctl -u openjobslots-deploy.service -n 100 --no-pager
tail -n 100 /var/log/openjobslots-deploy.log
docker compose --project-directory /root/OpenPostings ps
```

## Rollback

Each successful deploy creates a git bundle in `/root/OpenPostings/.deploy-backups/` before resetting to the new commit. Runtime databases and Docker volumes are not deleted by the deploy watcher.
