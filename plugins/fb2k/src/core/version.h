#pragma once

namespace jean {

// Renaming this orphans an installed component's profile directory, its log and its token:
// `fb2k/paths.cpp` builds all three from it, and the discovery record it writes is also
// beefweb's clientconfig id, which constrains the spelling. See `fb2k/paths.cpp`.
constexpr char kComponentName[] = "foo_jean";

// `scripts/test.sh` and `scripts/test.ps1` read the literal below with a regex and compare
// it against `contract/openapi.yaml`. Reformatting this declaration breaks both.
constexpr char kVersion[] = "0.3.0";

constexpr int kApiVersion = 1;

}  // namespace jean
