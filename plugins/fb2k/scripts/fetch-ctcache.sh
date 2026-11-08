#!/usr/bin/env bash
# Fetches ctcache's clang-tidy-cache into bin/. It is one Python file with no dependencies
# outside the standard library.
set -euo pipefail

ctcache_commit=857b14271d3ded5511c2e6a60f2dc20c1e4b5680
ctcache_sha=65b86482ec7574528889ea60f3ce9388e0da562ecc27cdefa4343bc220360884

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
target="$root/bin/clang-tidy-cache"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -fsSL --retry 5 --retry-all-errors -o "$work/clang-tidy-cache" \
  "https://raw.githubusercontent.com/matus-chochlik/ctcache/$ctcache_commit/src/ctcache/clang_tidy_cache.py"
got=$(shasum -a 256 "$work/clang-tidy-cache" | cut -d' ' -f1)
if [ "$got" != "$ctcache_sha" ]; then
  echo "checksum mismatch for clang-tidy-cache: expected $ctcache_sha, got $got" >&2
  exit 1
fi

mkdir -p "$root/bin"
chmod 755 "$work/clang-tidy-cache"
mv "$work/clang-tidy-cache" "$target"
echo "clang-tidy-cache -> $target"
