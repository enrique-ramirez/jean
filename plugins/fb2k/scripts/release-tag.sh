#!/usr/bin/env bash
# Checks a release tag against contract/openapi.yaml's info.version. .github/workflows/release.yml
# runs this before publishing a release, on the Mac and on a GitHub runner's bash alike, so nothing
# here goes past bash 3.2.
#
#   scripts/release-tag.sh v0.3.0
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: release-tag.sh <tag>" >&2
  exit 1
fi

tag="$1"

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=lib/version-header.sh
. "$root/scripts/lib/version-header.sh"
version=$(contract_info version)
expected="v$version"

if [ "$tag" != "$expected" ]; then
  echo "tag '$tag' does not match contract/openapi.yaml's info.version '$version' (expected '$expected')" >&2
  exit 1
fi
