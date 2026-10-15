#!/bin/sh
set -e
mkdir -p /data /data/media
export MEDIA_PATH="${MEDIA_PATH:-/data/media}"
export DATABASE_PATH="${DATABASE_PATH:-/data/app.db}"

# Never point SQLite at the image copy under /app/data (wiped on every recreate).
case "$DATABASE_PATH" in
  /app/data/*|./data/*)
    echo "WARNING: DATABASE_PATH=$DATABASE_PATH is inside the image. Switching to /data/app.db"
    export DATABASE_PATH=/data/app.db
    ;;
esac

if grep -q ' /data ' /proc/mounts 2>/dev/null; then
  :
else
  echo "WARNING: /data is not a volume mount. SQLite will be lost when the container is replaced. Bind-mount DATA_DIR or the named volume strength-lab-data."
fi

if [ -z "$AUTH_SECRET" ] || [ "$AUTH_SECRET" = "change-me-to-a-long-random-secret" ]; then
  echo "WARNING: Set a strong AUTH_SECRET in .env before exposing this beyond your LAN."
fi

# Never delete $DATABASE_PATH. First boot creates it; later boots reuse it.

# Affiliate catalog: copy bundled slots once. Never overwrite a NAS-edited file.
if [ ! -f /data/gear-affiliates.json ] && [ -f /app/data/gear-affiliates.json ]; then
  cp /app/data/gear-affiliates.json /data/gear-affiliates.json
fi

exec node server.js
