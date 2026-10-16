#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Formats our own C++ and Objective-C++ to .clang-format. third_party/ is never touched.

  scripts/format.sh                              rewrite everything in place
  scripts/format.sh src/core/text.cpp            rewrite one file
  scripts/format.sh --check [file...]            exit non-zero if anything is unformatted

CLANG_FORMAT picks the binary, for a machine carrying more than one. Only the LLVM major pinned in scripts/lib/llvm.sh is accepted.
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

# shellcheck source=lib/compile-flags.sh
. "$root/scripts/lib/compile-flags.sh"

check=
if [ "${1:-}" = "--check" ]; then
  check=1
  shift
fi

# macOS ships bash 3.2, which has no mapfile.
files=()
if [ "$#" -gt 0 ]; then
  for file in "$@"; do
    case "$file" in
      *third_party/*) echo "$file was skipped: third_party/ is not ours to format." >&2 ;;
      *)
        if is_fb2k_generated "$file"; then
          echo "$file was skipped: it is in fb2k_generated_sources in scripts/lib/compile-flags.sh." >&2
        else
          files+=("$file")
        fi
        ;;
    esac
  done
else
  while IFS= read -r file; do
    is_fb2k_generated "$file" || files+=("$file")
  done < <(find "$root/src" "$root/tests" -type f \( -name '*.cpp' -o -name '*.mm' -o -name '*.h' \) | sort)
fi

if [ "${#files[@]}" = 0 ]; then
  echo "Nothing to format." >&2
  exit 1
fi

if [ -n "$check" ]; then
  $formatter --dry-run --Werror "${files[@]}"
  echo "Formatting is clean (${#files[@]} files)."
else
  $formatter -i "${files[@]}"
  echo "Formatted ${#files[@]} files."
fi
