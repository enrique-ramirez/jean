#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Runs clang-tidy over src/core/, tests/ and, on a Mac with the SDK fetched, src/fb2k/, to the checks in .clang-tidy.

  scripts/lint.sh                     everything
  scripts/lint.sh src/core/text.cpp   one file

src/fb2k/ is linted where scripts/fetch-sdk.sh has fetched the foobar2000 SDK and the host is a
Mac, less the files scripts/lib/compile-flags.sh names. It is linked and run only on the build machine.

Where ctcache's clang-tidy-cache is in bin/ (scripts/fetch-ctcache.sh puts it there), on PATH, or
named by CLANG_TIDY_CACHE, a file clean in an earlier run with the same source, flags, config and
LLVM is not linted again. The cache lives in CTCACHE_DIR, bin/ctcache by default, and needs
clang++ of the same LLVM major to preprocess with (CLANGXX points at one elsewhere).
CLANG_TIDY_CACHE= turns it off.
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
      if is_fb2k_generated "$file"; then
        echo "$file was skipped: it is in fb2k_generated_sources in scripts/lib/compile-flags.sh." >&2
      elif is_fb2k_unparsed "$file"; then
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

jobs="$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)"

fetched_cache="$root/bin/clang-tidy-cache"
[ -x "$fetched_cache" ] || fetched_cache="$(command -v clang-tidy-cache || true)"
cache="${CLANG_TIDY_CACHE-$fetched_cache}"
preprocessor=""
if [ -n "$cache" ] && ! preprocessor="$(find_llvm_tool clang++ CLANGXX 2>/dev/null)"; then
  echo "clang-tidy-cache was not used: it needs clang++ $required_major to preprocess with." >&2
  cache=""
fi
if [ -n "$cache" ]; then
  # ctcache keys an entry on the preprocessed source, the flags and clang-tidy --dump-config,
  # which names check globs rather than the checks a release puts under them, and not on
  # clang-tidy's version: so each LLVM build gets a directory of its own.
  llvm_build="$({ "$tidy" --version; "$preprocessor" --version; } | cksum | cut -d ' ' -f 1)"
  export CTCACHE_DIR="${CTCACHE_DIR:-$root/bin/ctcache}/$llvm_build"
  # ctcache preprocesses with comments stripped unless told otherwise, so removing a NOLINT
  # would hit the entry the NOLINT made clean.
  export CTCACHE_KEEP_COMMENTS=1
  # ctcache's hit and miss counts take a lock file per entry bucket, and one left by a killed
  # run sends every later lookup in that bucket to a timeout.
  export CTCACHE_NO_LOCAL_STATS=1
fi

lint_each() {
  local files=()
  while [ "$1" != -- ]; do
    files+=("$1")
    shift
  done
  shift
  # Without --warnings-as-errors clang-tidy prints its findings and exits 0. ctcache stores a run
  # only when clang-tidy exits 0 with nothing on stdout, and preprocesses with the compiler
  # command after --, turning its -c into -E; clang-tidy drops the compiler and the file there.
  # -E alone leaves out each #define, which checks such as bugprone-reserved-identifier read, so
  # -dD keeps them; clang-tidy ignores it.
  printf '%s\0' "${files[@]}" | xargs -0 -n 1 -P "$jobs" bash -c '
    cache="$1" preprocessor="$2"
    shift 2
    file="${@: -1}"
    flags=("${@:1:$#-1}")
    if [ -n "$cache" ]; then
      out="$("$cache" "$0" --quiet --warnings-as-errors="*" "$file" -- "$preprocessor" "${flags[@]}" -dD -c "$file" 2>&1)" && exit 0
    else
      out="$("$0" --quiet --warnings-as-errors="*" "$file" -- "${flags[@]}" 2>&1)" && exit 0
    fi
    printf "%s\n" "$out"
    exit 1
  ' "$tidy" "$cache" "$preprocessor" "$@"
}

echo "Linting $((${#core_files[@]} + ${#fb2k_files[@]})) file(s), $jobs at a time${cache:+, through clang-tidy-cache in $CTCACHE_DIR}."
findings=0
if [ "${#core_files[@]}" -gt 0 ]; then
  lint_each "${core_files[@]}" -- "${compile_flags[@]}" || findings=1
fi
fb2k_cpp_files=()
fb2k_objc_files=()
for file in ${fb2k_files[@]+"${fb2k_files[@]}"}; do
  if is_objc_source "$file"; then fb2k_objc_files+=("$file"); else fb2k_cpp_files+=("$file"); fi
done
if [ "${#fb2k_cpp_files[@]}" -gt 0 ]; then
  lint_each "${fb2k_cpp_files[@]}" -- "${fb2k_compile_flags[@]}" || findings=1
fi
if [ "${#fb2k_objc_files[@]}" -gt 0 ]; then
  lint_each "${fb2k_objc_files[@]}" -- "${fb2k_objc_compile_flags[@]}" || findings=1
fi
[ "$findings" = 0 ] || exit 1
echo "clang-tidy is clean."
