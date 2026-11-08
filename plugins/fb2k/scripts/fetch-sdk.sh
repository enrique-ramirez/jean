#!/usr/bin/env bash
# Fetches the foobar2000 SDK into sdk/, the shell twin of fetch-sdk.ps1: same pin, same check.
# Fetched rather than vendored because the SDK's licence does not permit redistributing it.
# The version is a pinned release date: the SDK carries no other version, and a silent bump
# breaks the build.
set -euo pipefail

version=2026-10-01
sha=d4c55077336fae81bf8df0259b5b2748fa45ea84132c656ead93eb123cbcdc26

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
sdk="$root/sdk"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if [ "$(cat "$sdk/.fetched" 2>/dev/null)" = "$version $sha" ]; then
  echo "SDK $version is current"
  exit 0
fi

archive="$work/foobar2000-SDK-$version.7z"
echo "Fetching foobar2000 SDK $version ..."
curl -fsSL -o "$archive" "https://www.foobar2000.org/downloads/SDK-$version.7z"

got=$(shasum -a 256 "$archive" | cut -d' ' -f1)
if [ "$got" != "$sha" ]; then
  echo "checksum mismatch for the SDK archive: expected $sha, got $got" >&2
  exit 1
fi

# The archive is verified, so the old SDK goes only now. sdk/wtl/ is fetch-wtl's and survives.
mkdir -p "$sdk"
find "$sdk" -mindepth 1 -maxdepth 1 ! -name wtl ! -name .gitkeep -exec rm -rf {} +

# The SDK ships as .7z. macOS's tar is bsdtar, which reads it; elsewhere 7z does.
if command -v 7z >/dev/null 2>&1; then
  7z x "$archive" -o"$sdk" -y >/dev/null
else
  tar xf "$archive" -C "$sdk"
fi

# Both readers restore the release's file times, which would leave a refetched header older than
# the archives built from the last one.
find "$sdk" -mindepth 1 -path "$sdk/wtl" -prune -o ! -path "$sdk/.gitkeep" -exec touch {} +
echo "$version $sha" >"$sdk/.fetched"

echo "SDK unpacked into $sdk"
ls "$sdk"
