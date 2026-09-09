#include "support/spec.h"

#include "third_party/doctest.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <string>
#include <vector>

namespace jean::testing {

namespace {

constexpr char kSelf[] = "tests/support/spec.cpp";

// The compiler is given absolute source paths, so this finds the specification without the
// test binary having to be started from any particular directory. __FILE__ carries whichever
// separator the compiler was handed, so it is normalised before matching; forward slashes
// open a file on Windows too.
std::string specPath() {
    std::string self = __FILE__;
    std::replace(self.begin(), self.end(), '\\', '/');
    const auto tail = self.rfind(kSelf);

    REQUIRE_MESSAGE(tail != std::string::npos, "cannot locate the repository from ", self);
    return self.substr(0, tail) + "docs/openapi.yaml";
}

bool startsWith(const std::string& line, const std::string& prefix) {
    return line.rfind(prefix, 0) == 0;
}

// A key at exactly this indentation: deeper is a description's own text, and shallower is
// the next section.
bool keyAt(const std::string& line, size_t indent, const std::string& key) {
    return line == std::string(indent, ' ') + key;
}

// A quoted three-digit status key at this indentation, e.g. `"404":` at the depth
// responses: are written at. Empty when the line does not match.
std::string statusKeyAt(const std::string& line, size_t indent) {
    constexpr size_t kStatusDigits = 3;
    const std::string prefix = std::string(indent, ' ') + '"';

    if (line.size() <= prefix.size() + kStatusDigits + 1 || !startsWith(line, prefix))
        return {};
    if (line[prefix.size() + kStatusDigits] != '"' ||
        line[prefix.size() + kStatusDigits + 1] != ':')
        return {};
    return line.substr(prefix.size(), kStatusDigits);
}

}  // namespace

// A hand-rolled reader rather than a YAML library, because the shape it needs is two levels
// of key: the file is written by hand and this is the whole grammar it uses.
std::vector<SpecRoute> publishedRoutes() {
    std::ifstream file(specPath());
    REQUIRE_MESSAGE(file.is_open(), "cannot read docs/openapi.yaml");

    std::vector<SpecRoute> routes;
    std::string path;
    bool inPaths = false;

    for (std::string line; std::getline(file, line);) {
        if (!line.empty() && line.back() == '\r')
            line.pop_back();

        if (line == "paths:") {
            inPaths = true;
            continue;
        }

        if (!inPaths || line.empty())
            continue;

        if (line.front() != ' ')
            break;

        constexpr size_t kPathIndent = 2;
        if (startsWith(line, std::string(kPathIndent, ' ') + '/') && line.back() == ':') {
            path = line.substr(kPathIndent, line.size() - kPathIndent - 1);
            continue;
        }

        for (const char* method : {"get", "post", "delete", "put", "patch"}) {
            if (keyAt(line, 4, std::string(method) + ":")) {
                std::string upper(method);
                for (char& letter : upper)
                    letter = static_cast<char>(std::toupper(static_cast<unsigned char>(letter)));

                SpecRoute route;
                route.method = upper;
                route.path = path;
                routes.push_back(std::move(route));
            }
        }

        if (keyAt(line, 6, "security: []") && !routes.empty())
            routes.back().needsNoToken = true;

        if (const auto status = statusKeyAt(line, 8); !status.empty() && !routes.empty()) {
            if (std::all_of(status.begin(), status.end(), [](char digit) {
                    return std::isdigit(static_cast<unsigned char>(digit)) != 0;
                }))
                routes.back().statuses.insert(std::stoi(status));
        }
    }

    return routes;
}

}  // namespace jean::testing
