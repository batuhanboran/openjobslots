# OpenJobSlots Deployment

Production source of truth is the private GitHub repository:

`https://github.com/batuhanboran/openjobslots`

The production host runs `/root/OpenJobSlots` and deploys from `main` using a systemd timer. The timer checks GitHub every minute, rebuilds the Docker Compose stack only when `main` changes, and preserves runtime data in `.env`, `data/`, and `.deploy-backups/`.

## production Services

- `openjobslots-app`
- `openjobslots-worker`
- `openjobslots-postgres`
- `openjobslots-meilisearch`
- `openjobslots-deploy.timer`

These four services are the intended v1 runtime. Do not add Redis, a second reverse proxy, or another database engine until measured query, queue, or cache pressure proves the need.

## Deploy Key

The server uses `REDACTED` as a read-only GitHub deploy key. Add the public key to GitHub at:

`Settings -> Deploy keys -> Add deploy key`

Use read-only access. Write access is not needed.

## Useful Commands

```bash
systemctl status openjobslots-deploy.timer
systemctl start openjobslots-deploy.service
journalctl -u openjobslots-deploy.service -n 100 --no-pager
tail -n 100 /var/log/openjobslots-deploy.log
docker compose --project-directory /root/OpenJobSlots ps
curl -fsS http://127.0.0.1:8081/health
curl -fsS "http://127.0.0.1:8081/postings?search=Director%20United%20States&limit=5"
curl -fsS "http://127.0.0.1:8081/postings?search=t%C3%BCrkiye&limit=5"
```

Search correctness checks are part of deployment verification. Service health alone does not prove that Postgres, Meilisearch, and hydration agree. See [Search Quality Runbook](./search-quality-runbook.md).

## Rollback

Each successful deploy creates a git bundle in `/root/OpenJobSlots/.deploy-backups/` before resetting to the new commit. Runtime databases and Docker volumes are not deleted by the deploy watcher.
