#!/usr/bin/env bash
# Build and copy the UI to the foobar2000 machine.
#
# Requires SSH key auth to the Windows box. Configure with:
#   export BEEFWEB_SSH=you@home.local
#   export BEEFWEB_WEB_DIR='C:/Users/you/AppData/Roaming/foobar2000-v2/beefweb/ui'
#
# Then in %APPDATA%\foobar2000-v2\beefweb\config.json:
#   { "urlMappings": { "/muse": "ui" } }
#
# Then point beefweb at that directory — see README, "Deploying".
set -euo pipefail

: "${BEEFWEB_SSH:?set BEEFWEB_SSH, e.g. you@home.local}"
: "${BEEFWEB_WEB_DIR:?set BEEFWEB_WEB_DIR, the target directory on Windows}"

pnpm build

# Windows OpenSSH runs commands through cmd by default; forward slashes are fine.
ssh "$BEEFWEB_SSH" "mkdir \"$BEEFWEB_WEB_DIR\" 2>NUL || exit 0"
scp -r dist/. "$BEEFWEB_SSH:$BEEFWEB_WEB_DIR/"

echo "Deployed to $BEEFWEB_SSH:$BEEFWEB_WEB_DIR"
