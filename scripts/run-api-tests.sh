#!/bin/sh
set -eu

if [ -z "${MONGO_TEST_URI:-}" ]; then
  container_id=$(docker ps --filter name=mongodb-atlas --format '{{.ID}}' | head -n 1)
  if [ -n "$container_id" ]; then
    env_lines=$(docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container_id")
    mongo_user=$(printf '%s\n' "$env_lines" | sed -n 's/^MONGODB_INITDB_ROOT_USERNAME=//p')
    mongo_password=$(printf '%s\n' "$env_lines" | sed -n 's/^MONGODB_INITDB_ROOT_PASSWORD=//p')
    encoded_user=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$mongo_user")
    encoded_password=$(node -e 'process.stdout.write(encodeURIComponent(process.argv[1]))' "$mongo_password")
    MONGO_TEST_URI="mongodb://${encoded_user}:${encoded_password}@127.0.0.1:27017/oneringplatform_test?authSource=admin&directConnection=true"
  else
    MONGO_TEST_URI='mongodb://127.0.0.1:27017/oneringplatform_test?directConnection=true'
  fi
fi

LOCAL_DEV_AUTH=1
export MONGO_TEST_URI LOCAL_DEV_AUTH
exec npx vitest run
