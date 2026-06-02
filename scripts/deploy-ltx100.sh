#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/app}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
LOCK_FILE="${LOCK_FILE:-/var/lock/openjobslots-deploy.lock}"
LOG_FILE="${LOG_FILE:-/var/log/openjobslots-deploy.log}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8081/health}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8081}"
DEPLOY_KEY="${DEPLOY_KEY:-REDACTED}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"
FETCH_ATTEMPTS="${FETCH_ATTEMPTS:-3}"
ORIGIN_PORT="${OPENJOBSLOTS_ORIGIN_PORT:-8081}"

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

ensure_docker_user_rule() {
  local bin="$1"
  shift
  if ! command -v "$bin" >/dev/null 2>&1; then
    return 0
  fi
  "$bin" -N DOCKER-USER >/dev/null 2>&1 || true
  if "$bin" -C DOCKER-USER "$@" >/dev/null 2>&1; then
    return 0
  fi
  "$bin" -A DOCKER-USER "$@"
}

delete_docker_user_rule() {
  local bin="$1"
  shift
  if ! command -v "$bin" >/dev/null 2>&1; then
    return 0
  fi
  while "$bin" -C DOCKER-USER "$@" >/dev/null 2>&1; do
    "$bin" -D DOCKER-USER "$@"
  done
}

harden_origin_port() {
  local port="$1"
  if [[ -z "$port" || "$port" == "0" ]]; then
    return 0
  fi
  if ! [[ "$port" =~ ^[0-9]+$ ]]; then
    log "skipping origin firewall hardening: invalid OPENJOBSLOTS_ORIGIN_PORT=$port"
    return 0
  fi

  local ipv4_sources=(
    "131.0.72.0/22"
    "172.64.0.0/13"
    "104.24.0.0/14"
    "104.16.0.0/13"
    "162.158.0.0/15"
    "198.41.128.0/17"
    "197.234.240.0/22"
    "188.114.96.0/20"
    "190.93.240.0/20"
    "108.162.192.0/18"
    "141.101.64.0/18"
    "103.31.4.0/22"
    "103.22.200.0/22"
    "103.21.244.0/22"
    "173.245.48.0/20"
    "192.168.0.0/16"
    "172.16.0.0/12"
    "10.0.0.0/8"
    "127.0.0.0/8"
  )
  local ipv6_sources=(
    "2400:cb00::/32"
    "2606:4700::/32"
    "2803:f800::/32"
    "2405:b500::/32"
    "2405:8100::/32"
    "2a06:98c0::/29"
    "2c0f:f248::/32"
    "::1/128"
    "fc00::/7"
    "fe80::/10"
  )

  delete_docker_user_rule iptables -p tcp -m conntrack --ctorigdstport "$port" -j DROP
  for source in "${ipv4_sources[@]}"; do
    ensure_docker_user_rule iptables -s "$source" -p tcp -m conntrack --ctorigdstport "$port" -j RETURN
  done
  ensure_docker_user_rule iptables -p tcp -m conntrack --ctorigdstport "$port" -j DROP

  delete_docker_user_rule ip6tables -p tcp -m conntrack --ctorigdstport "$port" -j DROP
  for source in "${ipv6_sources[@]}"; do
    ensure_docker_user_rule ip6tables -s "$source" -p tcp -m conntrack --ctorigdstport "$port" -j RETURN
  done
  ensure_docker_user_rule ip6tables -p tcp -m conntrack --ctorigdstport "$port" -j DROP
  log "origin firewall hardening ensured for docker-published port $port"
}

cd "$APP_DIR"
harden_origin_port "$ORIGIN_PORT"

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
