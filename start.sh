#!/usr/bin/env bash
# Starts Deskcity and starts it again 10 seconds after a crash. Press Ctrl+C to stop it.
#   bash start.sh --no-browser   (or DESKCITY_NO_BROWSER=1) does not open the browser.
# If a hub is already running on this folder, this stops instead of starting a second one.
cd "$(dirname "$0")" || exit 1
[ "${1:-}" = "--no-browser" ] && export DESKCITY_NO_BROWSER=1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20 or newer was not found. Run: bash install.sh   (or get it from https://nodejs.org)"
  exit 1
fi

PORT_USE="$(node tools/open-when-ready.mjs --port 2>/dev/null || echo 3000)"
echo "Deskcity is starting. It will be at http://localhost:$PORT_USE"
echo "Press Ctrl+C to stop it."
# Opens the page once the hub answers (the first start only; skipped with --no-browser).
node tools/open-when-ready.mjs &
WAITER=$!
trap 'kill "$WAITER" 2>/dev/null' EXIT

while true; do
  npm start
  code=$?
  # The hub exits with 3 when it is refused because one is already running (see server.js): stop, do not loop.
  if [ "$code" -eq 3 ]; then
    echo
    echo "Deskcity is already running (see above), so this did not start a second one."
    echo "It is at http://localhost:$PORT_USE"
    exit 0
  fi
  echo
  echo "Deskcity stopped. Starting it again in 10 seconds. Press Ctrl+C to stop."
  sleep 10
done
