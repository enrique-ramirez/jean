# The defines and include paths src/core/ and tests/ compile with, in one place: scripts/test.sh
# builds with them, scripts/lint.sh hands them to clang-tidy, and scripts/compile-commands.sh
# writes them into the database an editor's clangd reads. An include path missing from one of
# the three is an editor that disagrees with the build.
#
# Dot-source it with $root set to plugins/fb2k, and read the result from $compile_flags.
#
# $vendor_include is how third_party/ is reached. clang-tidy and clangd want -isystem there,
# because vendored headers are noisy and clang-tidy's --warnings-as-errors promotes anything
# HeaderFilterRegex filtered back into view. A compiler wants plain -I, which is the default.
# clang and gcc both take -isystem joined to its path, so either style is one array element.
#
# src/fb2k/ is not covered anywhere. It needs the foobar2000 SDK and the Windows SDK, and
# MSBuild produces no compilation database.

: "${vendor_include:=-I}"

compile_flags=(
  -std=c++17
  # Defined once for the whole build, never per file: third_party/README.md has why.
  -DCPPHTTPLIB_ZLIB_SUPPORT
  "$vendor_include$root"
  "$vendor_include$root/third_party/opus/include"
  "$vendor_include$root/third_party/ogg/include"
  "$vendor_include$root/third_party/zlib"
  "-I$root/src"
  "-I$root/tests"
)
