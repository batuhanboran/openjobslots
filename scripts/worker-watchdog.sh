#!/usr/bin/env bash
set -Eeuo pipefail

WORKER_CONTAINER="${OPENJOBSLOTS_WORKER_CONTAINER:-openjobslots-worker}"

container_status="$(docker inspect --format '{{.State.Status}}' "$WORKER_CONTAINER" 2>/dev/null || true)"
if [[ "$container_status" != "running" ]]; then
  echo "worker status is ${container_status:-missing}; starting container"
  docker start "$WORKER_CONTAINER" >/dev/null
  exit 0
fi

health_status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$WORKER_CONTAINER")"
case "$health_status" in
  healthy|starting)
    exit 0
    ;;
  unhealthy)
    echo "worker health is unhealthy; restarting container"
    docker restart "$WORKER_CONTAINER" >/dev/null
    ;;
  *)
    echo "worker healthcheck is unavailable; refusing time-based restart" >&2
    exit 1
    ;;
esac
