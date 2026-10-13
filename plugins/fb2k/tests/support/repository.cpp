#include "support/repository.h"

#include "third_party/doctest.h"

#include <algorithm>

namespace jean::testing {

namespace {

constexpr char kSelf[] = "plugins/fb2k/tests/support/repository.cpp";

}  // namespace

// The compiler is given absolute source paths, so this finds the repository without the test
// binary having to be started from any particular directory. __FILE__ carries whichever
// separator the compiler was handed, so it is normalised before matching; forward slashes
// open a file on Windows too.
std::string repositoryRoot() {
    std::string self = __FILE__;
    std::replace(self.begin(), self.end(), '\\', '/');
    const auto tail = self.rfind(kSelf);

    REQUIRE_MESSAGE(tail != std::string::npos, "cannot locate the repository from ", self);
    return self.substr(0, tail);
}

}  // namespace jean::testing
