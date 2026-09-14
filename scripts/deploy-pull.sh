#!/bin/sh
set -e
cd /volume1/docker/strength-lab
/usr/local/bin/docker compose -f docker-compose.nas.yml pull
/usr/local/bin/docker compose -f docker-compose.nas.yml up -d --force-recreate --remove-orphans
/usr/local/bin/docker ps --filter name=strength-lab
/usr/local/bin/docker exec strength-lab cat /app/.next/BUILD_ID || true
echo DEPLOY_PULL_OK
