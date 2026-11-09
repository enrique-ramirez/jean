#!/usr/bin/env bash
# Releases foo_jean: moves info.version in contract/openapi.yaml, commits that one line under the
# subject scripts/lib/conventional.mjs gives a release, pushes main, then tags the commit and
# pushes the tag, which starts .github/workflows/release.yml.
#
#   scripts/release.sh                    patch: 0.7.0 -> 0.7.1
#   scripts/release.sh minor              0.7.0 -> 0.8.0
#   scripts/release.sh major              0.7.0 -> 1.0.0
#   scripts/release.sh 0.9.0              exactly that
#   scripts/release.sh --dry-run [bump]   every check, then what it would do, and no write
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"
# shellcheck source=lib/version-header.sh
. "$root/scripts/lib/version-header.sh"

fail() {
  echo "release.sh: $*" >&2
  exit 1
}

dry_run=0
if [ "${1:-}" = --dry-run ]; then
  dry_run=1
  shift
fi
bump="${1:-patch}"

current=$(contract_info version)
IFS=. read -r major minor patch <<<"$current"
case "$bump" in
  major) version="$((major + 1)).0.0" ;;
  minor) version="$major.$((minor + 1)).0" ;;
  patch) version="$major.$minor.$((patch + 1))" ;;
  *)
    [[ $bump =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "'$bump' is not patch, minor, major or a version like 0.9.0"
    version="$bump"
    ;;
esac
[ "$version" != "$current" ] || fail "contract/openapi.yaml already says $current"
[ "$(printf '%s\n%s\n' "$current" "$version" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" = "$version" ] \
  || fail "$version is below the current $current"

tag="v$version"
subject=$(node "$repo/scripts/commit-message.mjs" --release-subject "$version")

[ -z "$(git -C "$repo" status --porcelain)" ] || fail "the working tree has changes; a release is one commit of its own"

branch=$(git -C "$repo" symbolic-ref --short HEAD 2>/dev/null || true)
[ "$branch" = main ] || fail "releases are made on main; HEAD is on '${branch:-no branch}'"

git -C "$repo" fetch --quiet origin main
head=$(git -C "$repo" rev-parse HEAD)
[ "$head" = "$(git -C "$repo" rev-parse origin/main)" ] || fail "HEAD is not origin/main; push or pull first, so the release follows what the repository shows"

if git -C "$repo" rev-parse --verify --quiet "refs/tags/$tag" >/dev/null \
  || git -C "$repo" ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null; then
  fail "tag '$tag' already exists"
fi

previous=$(git -C "$repo" describe --tags --abbrev=0 --match 'v*' HEAD 2>/dev/null || true)
if [ -n "$previous" ] && [ "$(git -C "$repo" rev-list --count "$previous..HEAD")" = 0 ]; then
  fail "nothing to release: HEAD is $previous, with no commit since"
fi

# The endpoint answers the latest run of each check unless asked for filter=all.
remote=$(git -C "$repo" remote get-url origin)
slug=${remote#*github.com}
slug=${slug#[:/]}
slug=${slug%.git}
checks=$(curl --silent --show-error --max-time 30 --header 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$slug/commits/$head/check-runs?per_page=100") \
  || fail "could not read the checks on HEAD from api.github.com"
verdict=$(printf '%s' "$checks" | python3 -I -c '
import json, sys

answer = json.load(sys.stdin)
if "message" in answer:
    print("GitHub answered: " + answer["message"])
    sys.exit(1)
runs = answer.get("check_runs", [])
if not runs:
    print("no check has reported on HEAD yet")
    sys.exit(1)
running = [run["name"] for run in runs if run["status"] != "completed"]
red = [run["name"] for run in runs if run["status"] == "completed"
       and run["conclusion"] not in ("success", "skipped", "neutral")]
if running or red:
    parts = []
    if running:
        parts.append("still running: " + ", ".join(running))
    if red:
        parts.append("red: " + ", ".join(red))
    print("the checks on HEAD are not green; " + "; ".join(parts))
    sys.exit(1)
print(f"{len(runs)} checks green on HEAD")
') || fail "$verdict"
echo "$verdict"

if [ "$dry_run" = 1 ]; then
  echo "dry run: would release $tag from $current as '$subject', then push main and the tag"
  exit 0
fi

contract="$repo/contract/openapi.yaml"
sed "s/^  version: .*/  version: $version/" "$contract" >"$contract.new" && mv "$contract.new" "$contract" || {
  rm -f "$contract.new"
  fail "could not write contract/openapi.yaml"
}
[ "$(contract_info version)" = "$version" ] || fail "contract/openapi.yaml: the version did not take"

git -C "$repo" add contract/openapi.yaml
git -C "$repo" commit --quiet --message "$subject" \
  || fail "the release commit failed; contract/openapi.yaml holds the bump, uncommitted"
git -C "$repo" push --quiet origin main || {
  git -C "$repo" reset --quiet --hard "$head"
  fail "the push of main failed; the release commit was undone and the tree is as it was"
}

git -C "$repo" tag --annotate --message "foo_jean $version" "$tag" \
  || fail "main is pushed with the bump but the tag was not made; run: git tag --annotate --message 'foo_jean $version' $tag && git push origin refs/tags/$tag"
git -C "$repo" push --quiet origin "refs/tags/$tag" \
  || fail "main is pushed with the bump but the tag is not; run: git push origin refs/tags/$tag"

echo "released $tag; the release workflow, which also republishes the site, is at https://github.com/$slug/actions/workflows/release.yml"
