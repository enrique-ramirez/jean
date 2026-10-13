#pragma once

#include <string>

namespace jean::testing {

// The repository's root, with forward slashes and a trailing slash on every platform. Fails the
// running case where the root cannot be found.
std::string repositoryRoot();

}  // namespace jean::testing
