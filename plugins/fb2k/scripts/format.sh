#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Formats our own C++ to .clang-format. third_party/ is never touched.

  scripts/format.sh            rewrite in place
  scripts/format.sh --check    exit non-zero if anything is unformatted

CLANG_FORMAT picks the binary, for a machine carrying more than one.
USAGE
}

case "${1:-}" in
  -h | --help)
    usage
    exit 0
    ;;
esac

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [ -n "${CLANG_FORMAT:-}" ]; then
  if ! command -v "$CLANG_FORMAT" >/dev/null 2>&1; then
    echo "CLANG_FORMAT names '$CLANG_FORMAT', which is not on PATH. A gate that asked for one" >&2
    echo "version must not quietly settle for another." >&2
    exit 127
  fi
  formatter="$CLANG_FORMAT"
elif command -v clang-format >/dev/null 2>&1; then
  formatter=clang-format
elif xcrun -f clang-format >/dev/null 2>&1; then
  formatter="xcrun clang-format"
else
  echo "clang-format not found. On macOS it comes with Xcode; otherwise install LLVM." >&2
  exit 127
fi

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
