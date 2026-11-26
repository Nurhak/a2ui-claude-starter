#!/bin/sh
# Reads the add-on options and starts the MCP server over HTTP. Home Assistant is reached
# through the Supervisor with the add-on's own token, so no long-lived token is needed.
set -eu
opt() { node -p "require('/data/options.json')['$1'] || ''"; }
secret=$(opt path_secret)
if [ ${#secret} -lt 24 ]; then
  echo "Set path_secret (24+ random characters) in the add-on configuration." >&2
  exit 1
fi
export HA_URL=http://supervisor/core HA_TOKEN="$SUPERVISOR_TOKEN"
export HA_LIGHT="$(opt light)" HA_TV="$(opt tv)" HA_BLINDS="$(opt blinds)"
export MCP_HTTP_PORT=8790 MCP_PATH="/a2ui-scene/$secret/mcp"
cd /app
exec node --import tsx server/mcp.ts
