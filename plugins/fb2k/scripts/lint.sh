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

if command -v clang-tidy >/dev/null 2>&1; then
  tidy=clang-tidy
elif [ -x "$(brew --prefix llvm 2>/dev/null)/bin/clang-tidy" ]; then
  tidy="$(brew --prefix llvm)/bin/clang-tidy"
else
  echo "clang-tidy not found. 'brew install llvm' on macOS, or install the clang-tidy package." >&2
  exit 127
fi

# The same flags scripts/test.sh compiles with, passed after -- because there is no compilation database.
# Vendored headers must be -isystem or their diagnostics bury ours: --warnings-as-errors promotes anything HeaderFilterRegex filtered back into view.
compile_flags=(
  -std=c++17
  -DCPPHTTPLIB_ZLIB_SUPPORT
  -isystem "$root"
  -isystem "$root/third_party/opus/include"
  -isystem "$root/third_party/ogg/include"
  -isystem "$root/third_party/zlib"
  -I"$root/src"
  -I"$root/tests"
)

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
