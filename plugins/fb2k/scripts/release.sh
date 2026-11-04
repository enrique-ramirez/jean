#!/usr/bin/env bash
# Tags HEAD with the version plugins/fb2k/src/core/version.h carries and pushes the tag. Pushing a
# v* tag starts the publishing path of .github/workflows/release.yml.
#
#   scripts/release.sh
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"

version=$(sed -n 's/.*kVersion\[\] *= *"\([^"]*\)".*/\1/p' "$root/src/core/version.h")
if [ -z "$version" ]; then
  echo "could not find kVersion in $root/src/core/version.h" >&2
  exit 1
fi

spec_version=$(sed -n 's/^  version: *//p' "$repo/contract/openapi.yaml" | head -1)
if [ "$spec_version" != "$version" ]; then
  echo "contract/openapi.yaml says version '$spec_version'; src/core/version.h says '$version'" >&2
  exit 1
fi

tag="v$version"

if [ -n "$(git -C "$repo" status --porcelain)" ]; then
  echo "the working tree has uncommitted changes; a release tags a commit" >&2
  exit 1
fi

branch=$(git -C "$repo" symbolic-ref --short HEAD 2>/dev/null || true)
if [ "$branch" != "main" ]; then
  echo "releases are tagged on main; HEAD is on '${branch:-no branch}'" >&2
  exit 1
fi

git -C "$repo" fetch --quiet origin main

if [ "$(git -C "$repo" rev-parse HEAD)" != "$(git -C "$repo" rev-parse origin/main)" ]; then
  echo "HEAD is not origin/main; push main first, so the tag names a commit the repository shows" >&2
  exit 1
fi

if git -C "$repo" rev-parse --verify --quiet "refs/tags/$tag" >/dev/null \
  || git -C "$repo" ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null; then
  echo "tag '$tag' already exists; bump kVersion in src/core/version.h and contract/openapi.yaml" >&2
  exit 1
fi

git -C "$repo" tag --annotate --message "foo_jean $version" "$tag"
git -C "$repo" push origin "refs/tags/$tag" || {
  git -C "$repo" tag --delete "$tag" >/dev/null
  echo "the push failed, so '$tag' was removed again; a second run starts clean" >&2
  exit 1
}

echo "pushed $tag; the release workflow is at https://github.com/enrique-ramirez/jean/actions/workflows/release.yml"
