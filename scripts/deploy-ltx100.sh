#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/OpenJobSlots}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
LOCK_FILE="${LOCK_FILE:-/var/lock/openjobslots-deploy.lock}"
LOG_FILE="${LOG_FILE:-/var/log/openjobslots-deploy.log}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8081/health}"
DEPLOY_KEY="${DEPLOY_KEY:-REDACTED}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"

if [[ -f "$DEPLOY_KEY" && -z "${GIT_SSH_COMMAND:-}" ]]; then
  export GIT_SSH_COMMAND="ssh -i ${DEPLOY_KEY} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new"
fi

mkdir -p "$(dirname "$LOCK_FILE")" "$(dirname "$LOG_FILE")"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "$(date -Is) deploy already running" >> "$LOG_FILE"
  exit 0
fi

log() {
  echo "$(date -Is) $*" | tee -a "$LOG_FILE"
}

cd "$APP_DIR"

LOCAL_SHA="$(git rev-parse HEAD)"
log "checking $REMOTE/$BRANCH from $LOCAL_SHA"

git fetch --prune "$REMOTE" "$BRANCH:refs/remotes/$REMOTE/$BRANCH"
REMOTE_SHA="$(git rev-parse "refs/remotes/$REMOTE/$BRANCH")"

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" && "$FORCE_DEPLOY" != "1" ]]; then
  log "already current at $LOCAL_SHA"
  exit 0
fi

mkdir -p .deploy-backups
git bundle create ".deploy-backups/pre-deploy-${LOCAL_SHA}-$(date +%Y%m%d%H%M%S).bundle" HEAD

log "deploying $REMOTE_SHA"
git reset --hard "$REMOTE_SHA"
git clean -fd -e .env -e data -e .deploy-backups -e "docker-compose.yml.bak*"

docker compose up -d --build

for attempt in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null; then
    log "health check passed at $REMOTE_SHA"
    exit 0
  fi
  sleep 2
done

log "health check failed after deploy to $REMOTE_SHA"
docker compose ps >> "$LOG_FILE" 2>&1 || true
docker compose logs --tail=80 openjobslots-app >> "$LOG_FILE" 2>&1 || true
exit 1
