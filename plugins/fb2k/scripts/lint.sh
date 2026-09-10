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

# clang-tidy adds and retunes checks between releases, so an unpinned one turns a clean tree
# dirty on the next machine and teaches everybody to ignore the gate. This is the version this
# repository is clean against; CLANG_TIDY overrides the search for anyone who knows better.
required_major=23

# Assigned separately, because a failing command substitution inside an array literal aborts
# the script under `set -e` before it can say what is wrong.
kegged=""
plain=""
if command -v brew >/dev/null 2>&1; then
  kegged="$(brew --prefix "llvm@$required_major" 2>/dev/null || true)"
  plain="$(brew --prefix llvm 2>/dev/null || true)"
fi

candidates=(
  "${CLANG_TIDY:-}"
  "clang-tidy-$required_major"
  "${kegged:+$kegged/bin/clang-tidy}"
  clang-tidy
  "${plain:+$plain/bin/clang-tidy}"
)

tidy=""
for candidate in "${candidates[@]}"; do
  [ -n "$candidate" ] || continue
  command -v "$candidate" >/dev/null 2>&1 || continue
  if [ "$("$candidate" --version | sed -n 's/.*LLVM version \([0-9][0-9]*\).*/\1/p')" = "$required_major" ]; then
    tidy="$candidate"
    break
  fi
done

if [ -z "$tidy" ]; then
  echo "clang-tidy $required_major not found. 'brew install llvm@$required_major' on macOS," >&2
  echo "or install clang-tidy-$required_major. Set CLANG_TIDY to point at one elsewhere." >&2
  echo "Another version will report different findings, which is why this refuses to guess." >&2
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
