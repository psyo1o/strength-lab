#!/bin/sh
# Routine NAS update: pull image + recreate container.
# pull does not wipe user data.
# Never: docker compose down -v, docker volume rm, rm app.db, FORCE_RESEED=1.
set -e

COMPOSE_DIR="${COMPOSE_DIR:-/volume1/docker/strength-lab}"
DATA_DIR="${DATA_DIR:-/volume1/docker/strength-lab/data}"
COMPOSE_BIN="${COMPOSE_BIN:-/usr/local/bin/docker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.nas.yml}"

for arg in "$@"; do
  case "$arg" in
    -v|--volumes|down|prune)
      echo "REFUSING: deploy-pull.sh will not wipe volumes or sqlite. Use FORCE_RESEED=1 only to rebuild the program catalog (users/1RM/logs/WOD stay)."
      exit 1
      ;;
  esac
done

cd "$COMPOSE_DIR"
mkdir -p "$DATA_DIR"

# Recreate the container when the image digest changes. Do not --force-recreate
# (that replaces anonymous volumes if /data is not bind-mounted).
"$COMPOSE_BIN" compose -f "$COMPOSE_FILE" pull
"$COMPOSE_BIN" compose -f "$COMPOSE_FILE" up -d --remove-orphans
"$COMPOSE_BIN" ps --filter name=strength-lab
"$COMPOSE_BIN" exec strength-lab cat /app/.next/BUILD_ID || true
echo "DEPLOY_PULL_OK (sqlite on ${DATA_DIR} — pull does not wipe user data)"
