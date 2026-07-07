#!/usr/bin/env bash

set -euo pipefail

dev=true
prod=false

for arg in "$@"; do
  case "$arg" in
    --prod)
      prod=true
      dev=false
      ;;
    *)
      echo "Usage: $0 [--prod]" >&2
      exit 1
      ;;
  esac
done

compose_files=(
  -f node_modules/@immediate_media/docker-templates/docker-compose.network.yaml
  -f node_modules/@immediate_media/docker-templates/docker-compose.nginx.frontend.yaml
  -f node_modules/@immediate_media/docker-templates/docker-compose.cache.yaml
  -f docker-compose.base.yaml
)

if [[ "$dev" == "true" ]]; then
  compose_files+=(-f docker-compose.dev.yaml)
fi

if [[ "$prod" == "true" ]]; then
  compose_files+=(-f docker-compose.prod.yaml)
fi

docker compose --project-directory . "${compose_files[@]}" config --no-interpolate > docker-compose.yaml
