# Writes src/core/version.h from the `info` block of contract/openapi.yaml, so the component's
# name, its version and the API version are typed once, in the contract. Every script that
# compiles src/core/ sources this and writes the header first; the release scripts read the same
# fields for the tag. Bash 3.2: release-tag.sh runs on a GitHub runner's bash and on a Mac.
#
#   . "$root/scripts/lib/version-header.sh"
#   write_version_header       rewrites src/core/version.h where the contract moved
#   contract_info version      0.6.0; also title and x-api-version

version_header_fb2k_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
version_header_contract="$version_header_fb2k_root/../../contract/openapi.yaml"

contract_info() {
  local value
  value=$(sed -n "s/^  $1: *\(.*[^ ]\) *\$/\1/p" "$version_header_contract" | head -1)
  if [ -z "$value" ]; then
    echo "contract/openapi.yaml: no '$1' under info" >&2
    return 1
  fi
  printf '%s\n' "$value"
}

write_version_header() {
  local header="$version_header_fb2k_root/src/core/version.h" name version api
  name=$(contract_info title) || return 1
  version=$(contract_info version) || return 1
  api=$(contract_info x-api-version) || return 1
  case "$api" in
    '' | *[!0-9]*)
      echo "contract/openapi.yaml: x-api-version is '$api', not an integer" >&2
      return 1
      ;;
  esac

  cat > "$header.new" <<HEADER
// Written from the \`info\` block of contract/openapi.yaml by scripts/lib/version-header.sh and
// scripts/lib/version-header.ps1 before every build. Gitignored: edit the contract.
#pragma once

namespace jean {

constexpr char kComponentName[] = "$name";
constexpr char kVersion[] = "$version";
constexpr int kApiVersion = $api;

}  // namespace jean
HEADER

  if cmp -s "$header.new" "$header" 2>/dev/null; then
    rm "$header.new"
  else
    mv "$header.new" "$header"
  fi
}
