# Finds the one LLVM major this repository's C++ is clean against, for scripts/lint.sh and
# scripts/format.sh. Dot-source it, then:
#
#   tool="$(find_llvm_tool clang-tidy CLANG_TIDY)" || exit 127
#
# clang-tidy and clang-format add and retune checks and styles between releases.

required_major=23

find_llvm_tool() {
  local name="$1" variable="$2"
  local override="${!variable:-}"

  # Assigned separately, because a failing command substitution inside an array literal aborts
  # the script under `set -e` before it can say what is wrong.
  local kegged="" plain=""
  if command -v brew >/dev/null 2>&1; then
    kegged="$(brew --prefix "llvm@$required_major" 2>/dev/null || true)"
    plain="$(brew --prefix llvm 2>/dev/null || true)"
  fi

  local candidates=("$override")
  [ -n "$override" ] || candidates=(
    "$name-$required_major"
    "${kegged:+$kegged/bin/$name}"
    "$name"
    "${plain:+$plain/bin/$name}"
  )

  local candidate
  for candidate in "${candidates[@]}"; do
    [ -n "$candidate" ] || continue
    command -v "$candidate" >/dev/null 2>&1 || continue
    if [ "$("$candidate" --version | sed -n 's/.*version \([0-9][0-9]*\).*/\1/p' | head -1)" = "$required_major" ]; then
      echo "$candidate"
      return 0
    fi
  done

  echo "$name $required_major not found. 'brew install llvm@$required_major' on macOS," >&2
  echo "or install $name-$required_major. Set $variable to point at one elsewhere." >&2
  echo "Another version will report different results, which is why this refuses to guess." >&2
  return 1
}
