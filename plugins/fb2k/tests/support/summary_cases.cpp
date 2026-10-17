#include "support/summary_cases.h"

#include "support/repository.h"

#include "third_party/doctest.h"

#include <fstream>
#include <iterator>
#include <string>

namespace jean::testing {

const nlohmann::json& librarySummaryCases() {
    static const nlohmann::json cases = [] {
        const std::string path =
            repositoryRoot() + "plugins/fb2k/tests/fixtures/library_summary_cases.json";
        std::ifstream file(path, std::ios::binary);
        REQUIRE_MESSAGE(file.is_open(), "cannot read ", path);
        return nlohmann::json::parse(std::istreambuf_iterator<char>(file),
                                     std::istreambuf_iterator<char>());
    }();
    return cases;
}

}  // namespace jean::testing
