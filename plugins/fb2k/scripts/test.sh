#!/usr/bin/env bash
# Builds and runs the test suite. Needs no foobar2000 SDK and no Windows: everything it covers lives in src/core/.
#
#   scripts/test.sh                        everything
#   scripts/test.sh '-sf=*cors_test.cpp'   one file
#   scripts/test.sh '-tc=*bearer*'         test cases whose name matches
#
#   scripts/test.sh --sanitize=address     AddressSanitizer and UndefinedBehaviorSanitizer
#   scripts/test.sh --sanitize=thread      ThreadSanitizer, which is what covers the rings and the hold
#   scripts/test.sh --sanitize=leaks       the ordinary build under macOS's leaks
#
# --sanitize= comes first and composes with doctest's own arguments. Each instrumented build gets its
# own directories under bin/: linking instrumented tests against the cached plain libcodec.a would
# leave the codec uninstrumented and say nothing about it.
#
# doctest's source-file filter is -sf and needs the glob. -ts is test *suite*, matches nothing here and exits 0.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"
opus="$root/third_party/opus"
ogg="$root/third_party/ogg"

: "${CXX:=c++}"

sanitize=""
case "${1-}" in
  --sanitize=*)
    sanitize="${1#--sanitize=}"
    shift
    ;;
esac

# leaks refuses to inspect an ASan heap, so it takes the ordinary build and instruments nothing.
instrument=""
case "$sanitize" in
  "" | leaks) ;;
  address) instrument="-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined" ;;
  thread) instrument="-fsanitize=thread -fno-omit-frame-pointer" ;;
  *)
    echo "--sanitize takes 'address', 'thread' or 'leaks'" >&2
    exit 1
    ;;
esac

suffix=""
if [ -n "$instrument" ]; then
  suffix="-$sanitize"
fi

out="$root/bin/tests$suffix"
codec="$root/bin/codec$suffix"

assert_openapi_version_matches_code() {
  local spec_version code_version
  spec_version=$(sed -n 's/^  version: *//p' "$repo/contract/openapi.yaml" | head -1)
  code_version=$(sed -n 's/.*kVersion\[\] *= *"\([^"]*\)".*/\1/p' "$root/src/core/version.h")

  if [ "$spec_version" != "$code_version" ]; then
    echo "contract/openapi.yaml says version '$spec_version'; plugins/fb2k/src/core/version.h says '$code_version'" >&2
    exit 1
  fi
}

require_codec_sources() {
  if [ ! -d "$opus" ] || [ ! -d "$ogg" ]; then
    echo "libopus and libogg are missing. Run scripts/fetch-opus.sh" >&2
    exit 1
  fi
}

require_leaks_tool() {
  if ! command -v leaks >/dev/null 2>&1; then
    echo "--sanitize=leaks needs leaks(1), which ships with macOS and exists nowhere else." >&2
    exit 1
  fi
}

build_codec_archive_if_missing() {
  if [ -f "$codec/libcodec.a" ]; then
    return
  fi

  : "${CC:=cc}"
  mkdir -p "$codec"

  # The demo programs carry their own main().
  local sources
  sources=$(ls "$opus"/src/*.c "$opus"/celt/*.c "$opus"/silk/*.c "$opus"/silk/float/*.c \
                "$ogg"/src/*.c | grep -vE '(_demo|opus_compare)\.c$')

  # shellcheck disable=SC2086
  (cd "$codec" && $CC -c -O2 -w -DOPUS_BUILD -DUSE_ALLOCA -DHAVE_LRINTF $instrument \
    -I"$opus" -I"$opus/include" -I"$opus/celt" -I"$opus/silk" -I"$opus/silk/float" \
    -I"$ogg/include" $sources)

  ar rcs "$codec/libcodec.a" "$codec"/*.o
}

build_tests() {
  # -Wno-unused-function because doctest's SUBCASE machinery generates some.
  # shellcheck disable=SC2086
  "$CXX" -std=c++17 -g -O0 -Wall -Wextra -Wno-unused-function $instrument \
    -I"$root" -I"$root/src" -I"$root/tests" \
    -I"$opus/include" -I"$ogg/include" \
    "$root"/tests/*.cpp "$root"/tests/support/*.cpp "$root"/src/core/*.cpp \
    "$codec/libcodec.a" \
    -o "$out/foo_jean_tests"
}

# macOS's own tool, not LeakSanitizer: LSan has no implementation on this platform and an ASan binary
# given detect_leaks=1 aborts before main. leaks exits non-zero on a finding but reports only its own
# verdict, so the suite runs once for its result and leaks runs it again for the heap. It must launch
# the binary itself -- given a wrapper it inspects the wrapper.
run_with_leak_check() {
  "$out/foo_jean_tests" "$@"
  export MallocStackLogging=1
  exec leaks --atExit -- "$out/foo_jean_tests" "$@"
}

mkdir -p "$out"
assert_openapi_version_matches_code
require_codec_sources
if [ "$sanitize" = leaks ]; then
  require_leaks_tool
fi
build_codec_archive_if_missing
build_tests

if [ "$sanitize" = leaks ]; then
  run_with_leak_check "$@"
fi

"$out/foo_jean_tests" "$@"
