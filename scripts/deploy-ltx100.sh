#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/root/OpenJobSlots}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
LOCK_FILE="${LOCK_FILE:-/var/lock/openjobslots-deploy.lock}"
LOG_FILE="${LOG_FILE:-/var/log/openjobslots-deploy.log}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8081/health}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8081}"
DEPLOY_KEY="${DEPLOY_KEY:-REDACTED}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"
FETCH_ATTEMPTS="${FETCH_ATTEMPTS:-3}"

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

REMOTE_REF="refs/remotes/$REMOTE/$BRANCH"
FETCH_REFSPEC="+refs/heads/$BRANCH:$REMOTE_REF"
REMOTE_SHA=""
for attempt in $(seq 1 "$FETCH_ATTEMPTS"); do
  if git fetch --no-tags "$REMOTE" "$FETCH_REFSPEC"; then
    if REMOTE_SHA="$(git rev-parse --verify "${REMOTE_REF}^{commit}" 2>/dev/null)"; then
      break
    fi
    log "fetch attempt $attempt did not produce $REMOTE_REF"
  else
    log "fetch attempt $attempt failed"
  fi
  sleep 2
done

if [[ -z "$REMOTE_SHA" ]]; then
  log "fetch failed after $FETCH_ATTEMPTS attempts; check deploy key, repo access, and remote branch"
  exit 1
fi

if [[ "$LOCAL_SHA" == "$REMOTE_SHA" && "$FORCE_DEPLOY" != "1" ]]; then
  log "already current at $LOCAL_SHA"
  exit 0
fi

mkdir -p .deploy-backups
git bundle create ".deploy-backups/pre-deploy-${LOCAL_SHA}-$(date +%Y%m%d%H%M%S).bundle" HEAD

log "deploying $REMOTE_SHA"
git reset --hard "$REMOTE_SHA"
git clean -fd -e .env -e data -e .deploy-backups -e "docker-compose.yml.bak*"

if ! docker compose up -d --build --remove-orphans; then
  log "compose --remove-orphans unsupported or failed; retrying without it"
  docker compose up -d --build
fi

verify_deploy() {
  curl -fsS "$HEALTH_URL" | grep -q '"ok":true'
  curl -fsS "$BASE_URL/sync/status" | grep -q '"ok":true'
  curl -fsS "$BASE_URL/ingestion/status" | grep -q '"ok":true'
  curl -fsS "$BASE_URL/postings?search=Director%20United%20States&limit=5" | grep -q '"ok":true'
  curl -fsS "$BASE_URL/postings?search=remote%20engineer&limit=5" | grep -q '"ok":true'
  [[ "$(git rev-parse HEAD)" == "$REMOTE_SHA" ]]
}

for attempt in $(seq 1 30); do
  if verify_deploy; then
    log "post-deploy checks passed at $REMOTE_SHA"
    exit 0
  fi
  sleep 2
done

log "health check failed after deploy to $REMOTE_SHA"
docker compose ps >> "$LOG_FILE" 2>&1 || true
docker compose logs --tail=80 openjobslots-app >> "$LOG_FILE" 2>&1 || true
log "rolling back to $LOCAL_SHA"
git reset --hard "$LOCAL_SHA"
docker compose up -d --build openjobslots-app openjobslots-worker >> "$LOG_FILE" 2>&1 || true
exit 1
