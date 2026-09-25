#include "support/spec.h"

#include "third_party/doctest.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <string>
#include <vector>

namespace jean::testing {

namespace {

constexpr char kSelf[] = "plugins/fb2k/tests/support/spec.cpp";

// The compiler is given absolute source paths, so this finds the specification without the
// test binary having to be started from any particular directory. __FILE__ carries whichever
// separator the compiler was handed, so it is normalised before matching; forward slashes
// open a file on Windows too.
std::string specPath() {
    std::string self = __FILE__;
    std::replace(self.begin(), self.end(), '\\', '/');
    const auto tail = self.rfind(kSelf);

    REQUIRE_MESSAGE(tail != std::string::npos, "cannot locate the repository from ", self);
    return self.substr(0, tail) + "contract/openapi.yaml";
}

bool startsWith(const std::string& line, const std::string& prefix) {
    return line.rfind(prefix, 0) == 0;
}

// A key at exactly this indentation: deeper is a description's own text, and shallower is
// the next section.
bool keyAt(const std::string& line, size_t indent, const std::string& key) {
    return line == std::string(indent, ' ') + key;
}

size_t indentOf(const std::string& line) {
    return line.find_first_not_of(' ');
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
    REQUIRE_MESSAGE(file.is_open(), "cannot read contract/openapi.yaml");

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

        if (const auto status = statusKeyAt(line, 8);
            !status.empty() && !routes.empty() &&
            std::all_of(status.begin(), status.end(), [](char digit) {
                return std::isdigit(static_cast<unsigned char>(digit)) != 0;
            }))
            routes.back().statuses.insert(std::stoi(status));
    }

    return routes;
}

// Five levels of key rather than two, and hand-rolled for the same reason: `schemas:`, the
// schema, its `properties:`, the property and its `enum:` each sit at one fixed indentation,
// and that is the whole grammar this file uses.
std::vector<std::string> publishedEnum(const std::string& schema, const std::string& property) {
    std::ifstream file(specPath());
    REQUIRE_MESSAGE(file.is_open(), "cannot read contract/openapi.yaml");

    constexpr size_t kSchemasIndent = 2;
    constexpr size_t kSchemaIndent = 4;
    constexpr size_t kSchemaKeyIndent = 6;
    constexpr size_t kPropertyIndent = 8;
    constexpr size_t kEnumIndent = 10;
    const std::string bullet = std::string(kEnumIndent + 2, ' ') + "- ";

    std::vector<std::string> values;
    bool inSchemas = false;
    bool inSchema = false;
    bool inProperties = false;
    bool inProperty = false;
    bool inEnum = false;

    for (std::string line; std::getline(file, line);) {
        if (!line.empty() && line.back() == '\r')
            line.pop_back();

        const auto indent = indentOf(line);
        if (indent == std::string::npos)
            continue;

        if (!inSchemas) {
            inSchemas = keyAt(line, kSchemasIndent, "schemas:");
            continue;
        }

        if (indent < kSchemaIndent)
            break;

        if (indent == kSchemaIndent) {
            inSchema = keyAt(line, kSchemaIndent, schema + ":");
            inProperties = inProperty = inEnum = false;
            continue;
        }

        if (inSchema && indent == kSchemaKeyIndent) {
            inProperties = keyAt(line, kSchemaKeyIndent, "properties:");
            inProperty = inEnum = false;
            continue;
        }

        if (inProperties && indent == kPropertyIndent) {
            inProperty = keyAt(line, kPropertyIndent, property + ":");
            inEnum = false;
            continue;
        }

        if (inProperty && indent == kEnumIndent) {
            inEnum = keyAt(line, kEnumIndent, "enum:");
            continue;
        }

        if (inEnum && startsWith(line, bullet))
            values.push_back(line.substr(bullet.size()));
    }

    REQUIRE_MESSAGE(!values.empty(), "contract/openapi.yaml publishes no enum at ", schema, ".",
                    property);
    return values;
}

// Scoped to `/state`'s own block first, the same way `publishedRoutes` scopes to `paths:`
// before it reads anything, so an example of this name under a different route cannot be
// mistaken for this one. It does not descend further, into `get`, `responses`, `"200"` and
// `content`: `/state` publishes one operation, and its examples are the only ones the block
// holds, so bracketing the block is enough to make the match unambiguous.
std::set<std::string> publishedStatePlayerExample(const std::string& example) {
    std::ifstream file(specPath());
    REQUIRE_MESSAGE(file.is_open(), "cannot read contract/openapi.yaml");

    constexpr size_t kPathIndent = 2;
    constexpr size_t kExampleIndent = 16;
    constexpr size_t kSectionIndent = 20;
    constexpr size_t kFieldIndent = 22;

    std::vector<std::string> lines;
    for (std::string line; std::getline(file, line);) {
        if (!line.empty() && line.back() == '\r')
            line.pop_back();
        lines.push_back(std::move(line));
    }

    size_t blockStart = lines.size();
    size_t blockEnd = lines.size();
    bool inPaths = false;

    for (size_t at = 0; at < lines.size(); ++at) {
        const std::string& line = lines[at];

        if (line == "paths:") {
            inPaths = true;
            continue;
        }
        if (!inPaths || line.empty())
            continue;
        if (line.front() != ' ') {
            if (blockStart < lines.size())
                blockEnd = at;
            break;
        }

        if (startsWith(line, std::string(kPathIndent, ' ') + '/') && line.back() == ':') {
            if (blockStart < lines.size()) {
                blockEnd = at;
                break;
            }
            if (line.substr(kPathIndent, line.size() - kPathIndent - 1) == "/state")
                blockStart = at;
        }
    }
    REQUIRE_MESSAGE(blockStart < lines.size(), "contract/openapi.yaml has no /state path");

    size_t start = blockEnd;
    for (size_t at = blockStart; at < blockEnd; ++at) {
        if (keyAt(lines[at], kExampleIndent, example + ":")) {
            start = at;
            break;
        }
    }
    REQUIRE_MESSAGE(start < blockEnd, "contract/openapi.yaml's /state path names no example ",
                    example);

    size_t end = start + 1;
    while (end < blockEnd) {
        const auto indent = indentOf(lines[end]);
        // npos is SIZE_MAX, so the second test already excludes it. The first is what says a
        // blank line is skipped rather than taken for the end of the block.
        // NOLINTNEXTLINE(misc-redundant-expression)
        if (indent != std::string::npos && indent <= kExampleIndent)
            break;
        ++end;
    }

    std::set<std::string> keys;
    bool inPlayer = false;
    for (size_t at = start + 1; at < end; ++at) {
        const auto indent = indentOf(lines[at]);
        if (indent == std::string::npos)
            continue;

        if (indent == kSectionIndent) {
            inPlayer = keyAt(lines[at], kSectionIndent, "player:");
            continue;
        }

        if (inPlayer && indent == kFieldIndent) {
            const auto colon = lines[at].find(':', kFieldIndent);
            if (colon != std::string::npos)
                keys.insert(lines[at].substr(kFieldIndent, colon - kFieldIndent));
        }
    }

    REQUIRE_MESSAGE(!keys.empty(), "contract/openapi.yaml's ", example,
                    " example has no player section");
    return keys;
}

}  // namespace jean::testing
