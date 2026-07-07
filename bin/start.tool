#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Installing dependencies..."
npm install --prefix "$ROOT_DIR"
npm install --prefix "$ROOT_DIR/relay-server"
npm install --prefix "$ROOT_DIR/storybook-app"

echo "Starting relay-server and storybook-app..."
(cd "$ROOT_DIR/relay-server" && npx tsx server.ts) &
RELAY_PID=$!

npm --prefix "$ROOT_DIR/storybook-app" run storybook &
STORYBOOK_PID=$!

trap "kill $RELAY_PID $STORYBOOK_PID 2>/dev/null" EXIT INT TERM

wait
