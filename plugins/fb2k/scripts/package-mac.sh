#!/usr/bin/env bash
# Packages the macOS bundle, and a foo_jean.dll where handed one, as a .fb2k-component.
#
#   scripts/package-mac.sh [path/to/foo_jean.dll]
#
# foobar2000 for Mac installs only mac/<name>.component from the archive, and a Windows player looks
# only in x64/. zip is the tool because it stores the binary's Unix mode, and the player needs it
# executable.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bundle="$root/bin/mac/foo_jean.component"
binary="$bundle/Contents/MacOS/foo_jean"
dll="${1-}"

if [ ! -x "$binary" ]; then
  echo "package-mac.sh: no executable binary at $binary -- run scripts/build-mac.sh first." >&2
  exit 1
fi
if [ -n "$(find "$bundle" -type l -print -quit)" ]; then
  echo "package-mac.sh: $bundle holds a symbolic link, which this script does not package." >&2
  exit 1
fi
if [ -n "$dll" ] && [ ! -f "$dll" ]; then
  echo "package-mac.sh: $dll is not a file." >&2
  exit 1
fi

dist="$root/dist"
out="$dist/foo_jean.fb2k-component"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

mkdir -p "$dist" "$stage/mac"
rm -f "$out"
cp -R "$bundle" "$stage/mac/foo_jean.component"
entries=(mac)
if [ -n "$dll" ]; then
  mkdir "$stage/x64"
  cp "$dll" "$stage/x64/foo_jean.dll"
  entries+=(x64)
fi

# -X leaves out the owner ids and extended timestamps that vary between machines; -D leaves out directory entries.
(cd "$stage" && zip -q -r -X -D "$out" "${entries[@]}")

unzip -Z -l "$out" | awk '$1 ~ /^[-d][-rwx]+$/ { print "  " $NF "  " $4 " bytes" }'
mode="$(unzip -Z "$out" | awk '$NF ~ /Contents\/MacOS\/foo_jean$/ { print $1 }')"
case "$mode" in
  -rwx*) ;;
  *)
    echo "package-mac.sh: the binary is stored as '$mode' in $out, and the player needs it executable." >&2
    exit 1
    ;;
esac
echo "Packaged $out"
