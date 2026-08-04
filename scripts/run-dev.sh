#!/bin/sh
set -eu

# Reuse the Atlas Local instance owned by ~/dev/icos. Credentials are read from
# the running container and are never printed or written into this repository.
if [ -z "${MONGO_URI:-}" ]; then
  container_id=$(docker ps --filter name=mongodb-atlas --format '{{.ID}}' | head -n 1)
  if [ -z "$container_id" ]; then
    echo "MongoDB Atlas Local is not running. Start it with: cd ~/dev/icos && npm run docker:up" >&2
    exit 1
  fi
  env_lines=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id")
  mongo_user=$(printf '%s\n' "$env_lines" | sed -n 's/^MONGODB_INITDB_ROOT_USERNAME=//p')
  mongo_password=$(printf '%s\n' "$env_lines" | sed -n 's/^MONGODB_INITDB_ROOT_PASSWORD=//p')
  encoded_user=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$mongo_user")
  encoded_password=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$mongo_password")
  MONGO_URI="mongodb://${encoded_user}:${encoded_password}@127.0.0.1:27017/oneringplatform?authSource=admin&directConnection=true"
fi

LOCAL_DEV_AUTH="${LOCAL_DEV_AUTH:-1}"
export MONGO_URI LOCAL_DEV_AUTH
exec npm run dev:direct
