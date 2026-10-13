#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Runs clang-tidy over src/core/, tests/ and, on a Mac with the SDK fetched, src/fb2k/, to the checks in .clang-tidy.

  scripts/lint.sh                     everything
  scripts/lint.sh src/core/text.cpp   one file

src/fb2k/ is linted where scripts/fetch-sdk.sh has fetched the foobar2000 SDK and the host is a
Mac, less the files scripts/lib/compile-flags.sh names. It is linked and run only on the build machine.
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

core_files=()
fb2k_files=()
if [ "$#" -gt 0 ]; then
  for file in "$@"; do
    directory="$(cd "$(dirname "$file")" 2>/dev/null && pwd || true)"
    if [ "$directory" != "$root/src/fb2k" ]; then
      core_files+=("$file")
    elif [ -n "$fb2k_skipped" ]; then
      echo "$fb2k_skipped" >&2
    else
      if is_fb2k_unparsed "$file"; then
        echo "$file was skipped: it is in fb2k_unparsed_sources in scripts/lib/compile-flags.sh." >&2
      else
        fb2k_files+=("$file")
      fi
    fi
  done
else
  while IFS= read -r file; do
    core_files+=("$file")
  done < <(find "$root/src/core" "$root/tests" -name '*.cpp' | sort)
  fb2k_files=(${fb2k_sources[@]+"${fb2k_sources[@]}"})
  if [ -n "$fb2k_skipped" ]; then
    echo "$fb2k_skipped" >&2
  fi
fi

if [ "$((${#core_files[@]} + ${#fb2k_files[@]}))" = 0 ]; then
  echo "Nothing to lint." >&2
  exit 1
fi

# Without --warnings-as-errors clang-tidy prints its findings and exits 0.
echo "Linting $((${#core_files[@]} + ${#fb2k_files[@]})) file(s). This is slow: doctest is a large header."
findings=0
if [ "${#core_files[@]}" -gt 0 ]; then
  "$tidy" --quiet --warnings-as-errors='*' "${core_files[@]}" -- "${compile_flags[@]}" || findings=1
fi
if [ "${#fb2k_files[@]}" -gt 0 ]; then
  "$tidy" --quiet --warnings-as-errors='*' "${fb2k_files[@]}" -- "${fb2k_compile_flags[@]}" || findings=1
fi
[ "$findings" = 0 ] || exit 1
echo "clang-tidy is clean."
