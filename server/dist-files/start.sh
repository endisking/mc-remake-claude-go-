#!/bin/sh
# Starts the Blockcraft server. Needs Node.js 20 or newer (https://nodejs.org).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "The Blockcraft server needs Node.js 20 or newer. Install it from https://nodejs.org and run this again."
  exit 1
fi
exec node server.mjs
