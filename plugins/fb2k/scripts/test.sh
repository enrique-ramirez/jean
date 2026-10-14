#!/usr/bin/env bash
# Builds and runs the test suite. Needs no foobar2000 SDK and no Windows: everything it covers lives in src/core/, bar the
# AAC codec on a Mac, which is src/fb2k/aac_encoder_mac.cpp and needs only AudioToolbox.
#
#   scripts/test.sh                        everything
#   scripts/test.sh '-sf=*cors_test.cpp'   one file
#   scripts/test.sh '-tc=*ticket*'         test cases whose name matches
#
# The build is incremental, so a run costs what changed rather than the whole tree. -sf and -tc
# filter what runs, never what compiles, and the whole suite runs in seconds once built: filter
# to read less output, not to save time.
#
#   scripts/test.sh --sanitize=address     AddressSanitizer and UndefinedBehaviorSanitizer
#   scripts/test.sh --sanitize=thread      ThreadSanitizer, which is what covers the rings and the hold
#   scripts/test.sh --sanitize=leaks       the ordinary build under macOS's leaks
#
# --sanitize= comes first, once, and composes with doctest's own arguments; anywhere else it is
# refused. Each instrumented build gets its own directories under bin/: linking instrumented tests
# against the cached plain libcodec.a would leave the codec uninstrumented and say nothing about it.
#
# leaks scans conservatively rather than proving anything, so a clean run promises less than a clean
# LeakSanitizer run would.
#
# doctest's source-file filter is -sf and needs the glob. -ts is test *suite*, matches nothing here and exits 0.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
repo="$(cd "$root/../.." && pwd)"
opus="$root/third_party/opus"
ogg="$root/third_party/ogg"
zlib="$root/third_party/zlib"

# shellcheck source=lib/compile-flags.sh
. "$root/scripts/lib/compile-flags.sh"

: "${CXX:=c++}"

sanitize=""
case "${1-}" in
  --sanitize=*)
    sanitize="${1#--sanitize=}"
    shift
    ;;
esac

# doctest ignores options it does not know, so a flag left unparsed here would run the plain build
# and report it as the sanitised one.
for arg in "$@"; do
  case "$arg" in
    --sanitize | --sanitize=* | -sanitize | -sanitize=*)
      echo "$arg: --sanitize= takes address, thread or leaks and must be the first argument, as in: scripts/test.sh --sanitize=thread '-sf=*x_test.cpp'" >&2
      exit 1
      ;;
  esac
done

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
deflate="$root/bin/zlib$suffix"

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

  local sources
  sources=$(codec_source_files)

  # shellcheck disable=SC2086
  (cd "$codec" && $CC -c "${vendor_c_flags[@]}" "${codec_defines[@]}" ${platform_flags[@]+"${platform_flags[@]}"} $instrument \
    "${codec_include_flags[@]}" $sources)

  ar rcs "$codec/libcodec.a" "$codec"/*.o
}

build_zlib_archive_if_missing() {
  if [ -f "$deflate/libz.a" ]; then
    return
  fi

  : "${CC:=cc}"
  mkdir -p "$deflate"

  # shellcheck disable=SC2086
  (cd "$deflate" && $CC -c "${vendor_c_flags[@]}" ${platform_flags[@]+"${platform_flags[@]}"} $instrument "$zlib"/*.c)

  ar rcs "$deflate/libz.a" "$deflate"/*.o
}

# Only what changed since the last run is compiled, in parallel; scripts/lib/tests.mk has how.
build_tests() {
  local aac_sources="" aac_define="" aac_link=""
  if [ "$(uname -s)" = Darwin ]; then
    aac_sources="$root/src/fb2k/aac_encoder_mac.cpp"
    aac_define="-DJEAN_TESTS_HAVE_AAC"
    aac_link="-framework AudioToolbox"
  fi

  # -Wno-unused-function because doctest's SUBCASE machinery generates some. The hardening
  # defines make libc++ and libstdc++ check bounds that AddressSanitizer cannot see inside one
  # live allocation.
  local cxxflags="-g -O0 ${warning_flags[*]} -Werror -Wno-unused-function \
    -D_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_EXTENSIVE -D_GLIBCXX_ASSERTIONS \
    $instrument $aac_define ${compile_flags[*]}"
  local core_cxxflags="${core_warning_flags[*]}"
  local flags="$out/obj/flags"

  mkdir -p "$out/obj"
  if [ ! -f "$flags" ] || [ "$(cat "$flags")" != "$CXX $cxxflags $core_cxxflags" ]; then
    printf '%s' "$CXX $cxxflags $core_cxxflags" >"$flags"
  fi

  make -s -j "$(getconf _NPROCESSORS_ONLN)" -f "$root/scripts/lib/tests.mk" \
    ROOT="$root" OUT="$out" CXX="$CXX" CXXFLAGS="$cxxflags" LDFLAGS="-g $instrument ${platform_flags[*]-} $aac_link" \
    CORE_CXXFLAGS="$core_cxxflags" \
    SOURCES="$(echo "$root"/tests/*.cpp "$root"/tests/support/*.cpp "$root"/src/core/*.cpp) $aac_sources" \
    LIBS="$codec/libcodec.a $deflate/libz.a" FLAGS="$flags"
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
build_zlib_archive_if_missing
build_tests

if [ "$sanitize" = leaks ]; then
  run_with_leak_check "$@"
fi

"$out/foo_jean_tests" "$@"
