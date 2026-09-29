#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Runs clang-tidy over src/core/ and tests/, to the checks in .clang-tidy.

  scripts/lint.sh                     everything
  scripts/lint.sh src/core/text.cpp   one file

src/fb2k/ is not covered: it needs the foobar2000 SDK and a compilation database MSBuild does not produce.
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
tidy="$(find_llvm_tool clang-tidy CLANG_TIDY)" || exit 127

# Passed after -- because clang-tidy is given no compilation database.
vendor_include=-isystem
# shellcheck source=lib/compile-flags.sh
. "$root/scripts/lib/compile-flags.sh"

if [ "$#" -gt 0 ]; then
  files=("$@")
else
  files=()
  while IFS= read -r file; do
    files+=("$file")
  done < <(find "$root/src/core" "$root/tests" -name '*.cpp' | sort)
fi

# Without --warnings-as-errors clang-tidy prints its findings and exits 0.
echo "Linting ${#files[@]} file(s). This is slow: doctest is a large header."
"$tidy" --quiet --warnings-as-errors='*' "${files[@]}" -- "${compile_flags[@]}"
echo "clang-tidy is clean."
