#!/bin/sh
set -e
cd "$(dirname "$0")/.."
docker compose -f docker-compose.nas.yml pull
docker compose -f docker-compose.nas.yml up -d
echo "Pulled and restarted strength-lab from ghcr.io/psyo1o/strength-lab"
