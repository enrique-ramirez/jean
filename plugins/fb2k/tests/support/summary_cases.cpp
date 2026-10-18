#include "support/summary_cases.h"

#include "support/repository.h"

#include "third_party/doctest.h"

#include <fstream>
#include <iterator>
#include <map>
#include <mutex>
#include <string>

namespace jean::testing {

const nlohmann::json& casesIn(const char* fixtureFilename) {
    static std::mutex lock;
    static std::map<std::string, nlohmann::json> parsed;

    const std::lock_guard<std::mutex> guard(lock);
    const auto held = parsed.find(fixtureFilename);
    if (held != parsed.end())
        return held->second;

    const std::string path = repositoryRoot() + "plugins/fb2k/tests/fixtures/" + fixtureFilename;
    std::ifstream file(path, std::ios::binary);
    REQUIRE_MESSAGE(file.is_open(), "cannot read ", path);
    return parsed
        .emplace(fixtureFilename, nlohmann::json::parse(std::istreambuf_iterator<char>(file),
                                                        std::istreambuf_iterator<char>()))
        .first->second;
}

const nlohmann::json& librarySummaryCases() {
    return casesIn("library_summary_cases.json");
}

}  // namespace jean::testing
