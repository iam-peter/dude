#!/bin/sh
# Run a command with Node >= 22 first on PATH (WXT needs it; the system Node may be older).
# Candidates, first match wins: the node on PATH, /snap/bin/node, $NODE22_HOME/bin/node
# (default ~/.local/opt/node-22).
major() { "$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0; }

if [ "$(major node)" -lt 22 ]; then
  found=
  for n in /snap/bin/node "${NODE22_HOME:-$HOME/.local/opt/node-22}/bin/node"; do
    if [ -x "$n" ] && [ "$(major "$n")" -ge 22 ]; then
      found=$n
      break
    fi
  done
  if [ -z "$found" ]; then
    echo "dude: Node >= 22 required, found $(node -v 2>/dev/null || echo none); set NODE22_HOME" >&2
    exit 1
  fi
  # /snap/bin also holds npm/npx for the snap node; put its directory first.
  PATH="$(dirname "$found"):$PATH"
  export PATH
fi
exec "$@"
