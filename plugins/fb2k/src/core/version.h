#pragma once

namespace jean {

// Renaming this orphans an installed component's profile directory, its log and its token:
// `fb2k/paths.cpp` builds all three from it. See `fb2k/paths.cpp`.
constexpr char kComponentName[] = "foo_jean";

// `scripts/test.sh` and `scripts/test.ps1` read the literal below with a regex and compare
// it against `contract/openapi.yaml`. `scripts/release-tag.sh` reads it the same way to check
// a release tag. Reformatting this declaration breaks all three.
constexpr char kVersion[] = "0.3.0";

constexpr int kApiVersion = 1;

}  // namespace jean
