#!/bin/sh
set -e

# beefweb reads this rather than its settings screen, which is what keeps the container
# reproducible: no preferences dialog is ever opened in here.
mkdir -p "$HOME/.config/deadbeef/beefweb"
cat > "$HOME/.config/deadbeef/beefweb/config.json" <<JSON
{
  "port": 8880,
  "allowRemote": true,
  "musicDirs": ["/music"],
  "urlMappings": { "/jean": "/jean" }
}
JSON

# DeaDBeeF exits 1 if its GTK ui cannot open a display, so headless still needs an X server.
# Started here rather than through xvfb-run, whose wait-for-display loop never returns under
# emulation and leaves the player unlaunched with no output to say so.
Xvfb :99 -screen 0 1024x768x24 -nolisten tcp &
until [ -e /tmp/.X11-unix/X99 ]; do sleep 1; done
export DISPLAY=:99

# Scoped to this exec: /opt/deadbeef/lib carries an older libcurl that breaks the container's
# own tools if it goes into the environment.
LD_LIBRARY_PATH=/opt/deadbeef/lib exec /opt/deadbeef/deadbeef "$@"
