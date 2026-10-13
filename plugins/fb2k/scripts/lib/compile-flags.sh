# The defines and include paths the C++ here compiles with, in one place: scripts/test.sh builds
# with them, scripts/lint.sh hands them to clang-tidy, and scripts/compile-commands.sh
# writes them into the database an editor's clangd reads. An include path missing from one of
# the three is an editor that disagrees with the build. scripts/test.ps1 reads the
# compile_flags=( ... ) literal below too, and hands it to cl, so the literal holds only
# -std, -D and -I elements.
#
# Dot-source it with $root set to plugins/fb2k, and read the result from $compile_flags.
# src/fb2k/ takes $fb2k_compile_flags instead, and is covered where $fb2k_skipped is empty:
# the files are then in $fb2k_sources.
# $codec_defines is what libopus and libogg compile with, and $platform_flags is what every
# compile and link on this host carries beyond that: a floor of macOS 11.0 on a Mac,
# so src/core/ cannot use what a later release added.
#
# $vendor_include is how third_party/ is reached. clang-tidy and clangd want -isystem there,
# because vendored headers are noisy and clang-tidy's --warnings-as-errors promotes anything
# HeaderFilterRegex filtered back into view. A compiler wants plain -I, which is the default.
# clang and gcc both take -isystem joined to its path, so either style is one array element.
#
# src/fb2k/ is parsed and linted on a Mac with sdk/foobar2000 fetched, all but the files in
# $fb2k_unparsed_sources, and is linked and run nowhere but the build machine. The foobar2000
# SDK is somebody else's code and noisy, so it is always -isystem. Elsewhere the Windows SDK
# is needed, and MSBuild produces no compilation database.

: "${vendor_include:=-I}"

codec_defines=(-DOPUS_BUILD -DUSE_ALLOCA -DHAVE_LRINTF)

platform_flags=()
if [ "$(uname -s)" = Darwin ]; then
  platform_flags=(-mmacosx-version-min=11.0)
fi

compile_flags=(
  -std=c++20
  # Defined once for the whole build, never per file: third_party/README.md has why.
  -DCPPHTTPLIB_ZLIB_SUPPORT
  "$vendor_include$root"
  "$vendor_include$root/third_party/opus/include"
  "$vendor_include$root/third_party/ogg/include"
  "$vendor_include$root/third_party/zlib"
  "-I$root/src"
  "-I$root/tests"
)
# ${platform_flags[@]+...} because bash 3.2, which is macOS's /bin/bash, calls an empty array unset.
compile_flags+=(${platform_flags[@]+"${platform_flags[@]}"})

# Files the foobar2000 SDK or the Windows headers keep clang on a Mac from parsing.
fb2k_unparsed_sources=(preferences.cpp aac_encoder.cpp browser.cpp ui_assets.cpp)

fb2k_compile_flags=(
  "${compile_flags[@]}"
  -isystem "$root/sdk"
  -isystem "$root/sdk/foobar2000"
)

fb2k_skipped=""
if [ "$(uname -s)" != Darwin ]; then
  fb2k_skipped="src/fb2k/ was skipped: it is parsed on macOS only."
elif [ ! -d "$root/sdk/foobar2000" ]; then
  fb2k_skipped="src/fb2k/ was skipped: the foobar2000 SDK is not fetched. Run scripts/fetch-sdk.sh"
fi

is_fb2k_unparsed() {
  local name
  for name in "${fb2k_unparsed_sources[@]}"; do
    [ "${1##*/}" != "$name" ] || return 0
  done
  return 1
}

fb2k_sources=()
if [ -z "$fb2k_skipped" ]; then
  for fb2k_file in "$root"/src/fb2k/*.cpp; do
    is_fb2k_unparsed "$fb2k_file" || fb2k_sources+=("$fb2k_file")
  done
fi
