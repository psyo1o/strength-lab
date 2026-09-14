#!/bin/sh
set -e
mkdir -p /data /data/media
export MEDIA_PATH="${MEDIA_PATH:-/data/media}"
export DATABASE_PATH="${DATABASE_PATH:-/data/app.db}"
if [ -z "$AUTH_SECRET" ] || [ "$AUTH_SECRET" = "change-me-to-a-long-random-secret" ]; then
  echo "WARNING: Set a strong AUTH_SECRET in .env before exposing this beyond your LAN."
fi
exec node server.js
