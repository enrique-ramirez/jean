#!/usr/bin/env bash
# Checks a release tag against plugins/fb2k/src/core/version.h's kVersion, the way scripts/test.sh
# already reads that literal. .github/workflows/release.yml runs this before publishing a release,
# on the Mac and on a GitHub Windows runner's bash alike, so nothing here goes past bash 3.2.
#
#   scripts/release-tag.sh v0.3.0
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: release-tag.sh <tag>" >&2
  exit 1
fi

tag="$1"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
code_version=$(sed -n 's/.*kVersion\[\] *= *"\([^"]*\)".*/\1/p' "$root/src/core/version.h")
expected="v$code_version"

if [ "$tag" != "$expected" ]; then
  echo "tag '$tag' does not match plugins/fb2k/src/core/version.h's kVersion '$code_version' (expected '$expected')" >&2
  exit 1
fi
