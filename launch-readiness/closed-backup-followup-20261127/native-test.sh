#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
image=postgres@sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe
container=rr-closed-pg17-$(node -p 'require("node:crypto").randomUUID()')
trap 'docker rm -f "$container" >/dev/null 2>&1 || true' EXIT
docker run --pull=never --rm -d --name "$container" --network=none \
  --tmpfs /var/lib/postgresql/data -e POSTGRES_HOST_AUTH_METHOD=trust \
  "$image" postgres -c listen_addresses= >/dev/null
for ((attempt=0;attempt<60;attempt++)); do
  if docker exec "$container" sh -c 'test "$(cat /proc/1/comm)" = postgres && pg_isready -q -U postgres' 2>/dev/null; then
    break
  fi
  sleep 0.5
done
docker exec "$container" psql -XqAt -U postgres -v ON_ERROR_STOP=1 -c 'SHOW server_version'
version=$(docker exec "$container" psql -XqAt -U postgres -c 'SHOW server_version_num')
[[ "$version" =~ ^17[0-9]{4}$ ]]
docker exec "$container" psql -Xq -U postgres -v ON_ERROR_STOP=1 -c \
  'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE authenticator;'
RR_NATIVE_CONTAINER="$container" node --test closed-install.test.cjs
RR_NATIVE_CONTAINER="$container" node --test restore-native.test.cjs
