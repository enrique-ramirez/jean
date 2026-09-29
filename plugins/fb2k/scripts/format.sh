#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Formats our own C++ to .clang-format. third_party/ is never touched.

  scripts/format.sh            rewrite in place
  scripts/format.sh --check    exit non-zero if anything is unformatted

CLANG_FORMAT picks the binary, for a machine carrying more than one. Only LLVM 23 is accepted.
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# shellcheck source=lib/llvm.sh
. "$root/scripts/lib/llvm.sh"
formatter="$(find_llvm_tool clang-format CLANG_FORMAT)" || exit 127

# macOS ships bash 3.2, which has no mapfile.
files=()
while IFS= read -r file; do
  files+=("$file")
done < <(find "$root/src" "$root/tests" -type f \( -name '*.cpp' -o -name '*.h' \) | sort)

if [ "${1:-}" = "--check" ]; then
  $formatter --dry-run --Werror "${files[@]}"
  echo "Formatting is clean (${#files[@]} files)."
else
  $formatter -i "${files[@]}"
  echo "Formatted ${#files[@]} files."
fi
