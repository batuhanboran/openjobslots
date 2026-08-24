#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
REMOTE="${REMOTE:-origin}"
BRANCH="${BRANCH:-main}"
LOCK_FILE="${LOCK_FILE:-/var/lock/openjobslots-deploy.lock}"
LOG_FILE="${LOG_FILE:-/var/log/openjobslots-deploy.log}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8081/health/ready}"
BASE_URL="${BASE_URL:-http://127.0.0.1:8081}"
DEPLOY_KEY="${DEPLOY_KEY:-}"
FORCE_DEPLOY="${FORCE_DEPLOY:-0}"
FETCH_ATTEMPTS="${FETCH_ATTEMPTS:-3}"
ORIGIN_PORT="${OPENJOBSLOTS_ORIGIN_PORT:-8081}"
WEB_ORIGIN_PORT="${OPENJOBSLOTS_WEB_ORIGIN_PORT:-8090}"
WEB_BASE_URL="${WEB_BASE_URL:-http://127.0.0.1:${WEB_ORIGIN_PORT}}"
BACKUP_DIR="${BACKUP_DIR:-$APP_DIR/backups}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-openjobslots-postgres}"
CURL_CONNECT_TIMEOUT_SECONDS="${CURL_CONNECT_TIMEOUT_SECONDS:-3}"
CURL_MAX_TIME_SECONDS="${CURL_MAX_TIME_SECONDS:-15}"

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

validate_postings_response() {
  docker exec -i openjobslots-app node -e '
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { raw += chunk; });
    process.stdin.on("end", () => {
      try {
        const payload = JSON.parse(raw);
        const valid = payload && typeof payload === "object"
          && Array.isArray(payload.items)
          && Number.isFinite(Number(payload.count))
          && Number.isFinite(Number(payload.limit))
          && Number.isFinite(Number(payload.offset));
        process.exit(valid ? 0 : 1);
      } catch (_error) {
        process.exit(1);
      }
    });
  '
}

cd "$APP_DIR"
harden_origin_port "$ORIGIN_PORT"
harden_origin_port "$WEB_ORIGIN_PORT"

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

DIRTY_STATE="$(git status --porcelain --untracked-files=all -- . \
  ':(exclude).env' \
  ':(exclude)data/**' \
  ':(exclude).deploy-backups/**' \
  ':(exclude)backups/**' \
  ':(exclude)reports/**' \
  ':(exclude)docker-compose.yml.bak*')"
if [[ -n "$DIRTY_STATE" ]]; then
  log "refusing deploy because the application worktree is dirty"
  printf '%s\n' "$DIRTY_STATE" >> "$LOG_FILE"
  exit 2
fi

mkdir -p .deploy-backups
git bundle create ".deploy-backups/pre-deploy-${LOCAL_SHA}-$(date +%Y%m%d%H%M%S).bundle" HEAD

mkdir -p "$BACKUP_DIR"
POSTGRES_BACKUP="$BACKUP_DIR/postgres-openjobslots-predeploy-$(date +%Y%m%d%H%M%S).dump"
docker exec "$POSTGRES_CONTAINER" pg_dump -U openjobslots -d openjobslots -Fc > "$POSTGRES_BACKUP"
test -s "$POSTGRES_BACKUP"
log "fresh Postgres backup created at $POSTGRES_BACKUP ($(wc -c < "$POSTGRES_BACKUP") bytes)"

log "deploying $REMOTE_SHA"
git reset --hard "$REMOTE_SHA"
git clean -fd -e .env -e data -e .deploy-backups -e backups -e reports -e "docker-compose.yml.bak*"

rollback_deploy() {
  log "rolling back to $LOCAL_SHA"
  git reset --hard "$LOCAL_SHA"
  docker compose up -d --build openjobslots-app openjobslots-worker openjobslots-web >> "$LOG_FILE" 2>&1 || true
}

if ! docker compose up -d --build --remove-orphans; then
  log "compose --remove-orphans unsupported or failed; retrying without it"
  if ! docker compose up -d --build; then
    log "compose startup failed after retry"
    rollback_deploy
    exit 1
  fi
fi

verify_deploy() {
  local web_version
  web_version="$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' web/package.json | head -n 1)"
  curl -fsS --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" --max-time "$CURL_MAX_TIME_SECONDS" "$HEALTH_URL" | grep -q '"ok":true' || return 1
  curl -fsS --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" --max-time "$CURL_MAX_TIME_SECONDS" "$BASE_URL/postings?search=Director%20United%20States&limit=5" | validate_postings_response || return 1
  curl -fsS --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" --max-time "$CURL_MAX_TIME_SECONDS" "$BASE_URL/postings?search=remote%20engineer&limit=5" | validate_postings_response || return 1
  curl -fsS --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" --max-time "$CURL_MAX_TIME_SECONDS" "$WEB_BASE_URL/" | grep -q "v${web_version}" || return 1
  curl -fsS --connect-timeout "$CURL_CONNECT_TIMEOUT_SECONDS" --max-time "$CURL_MAX_TIME_SECONDS" "$WEB_BASE_URL/health/ready" | grep -q '"ok":true' || return 1
  [[ "$(docker inspect --format '{{.State.Health.Status}}' openjobslots-app)" == "healthy" ]] || return 1
  [[ "$(docker inspect --format '{{.State.Health.Status}}' openjobslots-worker)" == "healthy" ]] || return 1
  [[ "$(docker inspect --format '{{.State.Health.Status}}' openjobslots-web)" == "healthy" ]] || return 1
  [[ "$(git rev-parse HEAD)" == "$REMOTE_SHA" ]] || return 1
  return 0
}

for attempt in $(seq 1 60); do
  if verify_deploy; then
    log "post-deploy checks passed at $REMOTE_SHA"
    exit 0
  fi
  sleep 3
done

log "health check failed after deploy to $REMOTE_SHA"
docker compose ps >> "$LOG_FILE" 2>&1 || true
docker compose logs --tail=80 openjobslots-app >> "$LOG_FILE" 2>&1 || true
docker compose logs --tail=80 openjobslots-web >> "$LOG_FILE" 2>&1 || true
rollback_deploy
exit 1
