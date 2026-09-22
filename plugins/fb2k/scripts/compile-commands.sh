#!/usr/bin/env bash
# Writes the compilation database an editor's clangd reads. README.md, *Testing*, is what an
# editor gets wrong without it.
#
#   scripts/compile-commands.sh
#
# Run it after scripts/fetch-opus.sh, and again when a source file is added. The database lands
# in plugins/fb2k/, which is where clangd looks walking up from a source file.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# -isystem for the same reason clang-tidy uses it: clangd surfaces a vendored header's own
# warnings otherwise, and none of them are actionable here.
vendor_include=-isystem
# shellcheck source=lib/compile-flags.sh
. "$root/scripts/lib/compile-flags.sh"

: "${CXX:=c++}"

jsonString() {
  local value=$1
  value=${value//\\/\\\\}
  value=${value//\"/\\\"}
  printf '"%s"' "$value"
}

entry() {
  local file=$1 argument first=1
  printf '  {\n    "directory": %s,\n    "file": %s,\n    "arguments": [' \
    "$(jsonString "$root")" "$(jsonString "$file")"
  for argument in "$CXX" "${compile_flags[@]}" -c "$file"; do
    [ "$first" = 1 ] || printf ', '
    first=0
    jsonString "$argument"
  done
  printf ']\n  }'
}

sources=()
while IFS= read -r file; do
  sources+=("$file")
done < <(find "$root/src/core" "$root/tests" -name '*.cpp' | sort)

{
  printf '[\n'
  for index in "${!sources[@]}"; do
    [ "$index" = 0 ] || printf ',\n'
    entry "${sources[$index]}"
  done
  printf '\n]\n'
} > "$root/compile_commands.json"

echo "${#sources[@]} files -> $root/compile_commands.json"

if [ ! -d "$root/third_party/opus" ] || [ ! -d "$root/third_party/ogg" ]; then
  echo "libopus and libogg are missing, so clangd will still not resolve them. Run scripts/fetch-opus.sh" >&2
fi
