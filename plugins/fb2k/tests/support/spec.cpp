#include "support/spec.h"

#include "support/fixtures.h"
#include "support/repository.h"

#include "third_party/doctest.h"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace jean::testing {

namespace {

std::string specPath() {
    return repositoryRoot() + "contract/openapi.yaml";
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

std::string unquoted(const std::string& item) {
    if (item.size() >= 2 && item.front() == '"' && item.back() == '"')
        return item.substr(1, item.size() - 2);
    return item;
}

std::vector<std::string> flowItems(const std::string& inside) {
    std::vector<std::string> items(1);
    bool quoted = false;

    for (const char letter : inside) {
        if (letter == '"')
            quoted = !quoted;

        if (letter == ',' && !quoted)
            items.emplace_back();
        else if (letter != ' ' || !items.back().empty())
            items.back() += letter;
    }

    return items;
}

std::vector<std::string> specLines() {
    std::ifstream file(specPath());
    REQUIRE_MESSAGE(file.is_open(), "cannot read contract/openapi.yaml");

    std::vector<std::string> lines;
    for (std::string line; std::getline(file, line);) {
        if (!line.empty() && line.back() == '\r')
            line.pop_back();
        lines.push_back(std::move(line));
    }
    return lines;
}

std::string trimmed(const std::string& text) {
    const auto first = text.find_first_not_of(' ');
    if (first == std::string::npos)
        return {};
    return text.substr(first, text.find_last_not_of(' ') - first + 1);
}

// The inside of the flow sequence `key` opens at `lines[at]`, as `flowItems` takes it. Biome
// formats the contract and wraps a flow sequence past its line width, so the sequence is on the
// key's line, `key: [a, b]`, or below a key alone on its line: the brackets and items on one
// deeper line, or one item a line with a trailing comma.
std::optional<std::string> flowInsideAt(const std::vector<std::string>& lines, size_t at,
                                        const std::string& key) {
    const auto indent = indentOf(lines[at]);
    if (indent == std::string::npos)
        return std::nullopt;

    const auto text = lines[at].substr(indent);
    const std::string listOpens = key + ": [";

    if (startsWith(text, listOpens) && text.back() == ']')
        return text.substr(listOpens.size(), text.size() - listOpens.size() - 1);
    if (text != key + ":")
        return std::nullopt;

    std::string wrapped;
    for (size_t below = at + 1; below < lines.size(); ++below) {
        const auto belowIndent = indentOf(lines[below]);
        if (belowIndent == std::string::npos || belowIndent <= indent)
            return std::nullopt;

        wrapped += (wrapped.empty() ? "" : " ") + lines[below].substr(belowIndent);
        if (wrapped.front() != '[')
            return std::nullopt;
        if (wrapped.back() == ']')
            break;
    }
    if (wrapped.empty() || wrapped.back() != ']')
        return std::nullopt;

    auto inside = trimmed(wrapped.substr(1, wrapped.size() - 2));
    if (!inside.empty() && inside.back() == ',')
        inside.pop_back();
    return inside;
}

// The `error` a line of an example gives, whether the example is written as a flow mapping,
// `{ error: no such playlist, detail: "" }`, as one wrapped an entry a line with a trailing
// comma, or as a block with `error:` on a line of its own. Nothing where the line gives none,
// or gives an empty one.
std::optional<std::string> exampleError(const std::string& line) {
    const std::string key = "error: ";
    const auto at = line.find(key);
    if (at == std::string::npos)
        return std::nullopt;

    const auto before = at >= 2 ? line.substr(at - 2, 2) : std::string();
    const bool inFlow = before == "{ " || before == ", ";
    if (!inFlow && line.find_first_not_of(' ') != at)
        return std::nullopt;

    auto value = line.substr(at + key.size());
    const bool quoted = !value.empty() && value.front() == '"';
    if (quoted)
        value = value.substr(1, value.find('"', 1) - 1);
    else if (inFlow)
        value = trimmed(value.substr(0, value.find_first_of(",}")));
    else
        value = trimmed(value);

    if (!quoted && !value.empty() && value.back() == ',')
        value.pop_back();

    if (value.empty())
        return std::nullopt;
    return value;
}

// Every NAME a line refers to as `#/components/<kind>/NAME`.
std::vector<std::string> referenced(const std::string& line, const std::string& kind) {
    const std::string prefix = "#/components/" + kind + "/";

    std::vector<std::string> names;
    for (auto at = line.find(prefix); at != std::string::npos; at = line.find(prefix, at + 1)) {
        const auto start = at + prefix.size();
        const auto end = line.find_first_not_of(
            "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", start);
        names.push_back(line.substr(start, end - start));
    }
    return names;
}

struct Declared {
    std::set<std::string> schemas;
    std::set<std::string> errors;
};

void declare(Declared& declared, const std::string& line) {
    for (auto& schema : referenced(line, "schemas"))
        declared.schemas.insert(std::move(schema));
    if (auto error = exampleError(line))
        declared.errors.insert(std::move(*error));
}

// `components: responses:`, each shared response under its name.
std::map<std::string, Declared> sharedResponses(const std::vector<std::string>& lines) {
    constexpr size_t kNameIndent = 4;

    std::map<std::string, Declared> shared;
    Declared* current = nullptr;
    bool inComponents = false;
    bool inResponses = false;

    for (const auto& line : lines) {
        if (line == "components:") {
            inComponents = true;
            continue;
        }
        if (!inComponents || line.empty())
            continue;

        const auto indent = indentOf(line);
        if (indent == 2) {
            inResponses = keyAt(line, 2, "responses:");
            current = nullptr;
            continue;
        }
        if (!inResponses)
            continue;

        if (indent == kNameIndent && line.back() == ':') {
            current = &shared[line.substr(kNameIndent, line.size() - kNameIndent - 1)];
            continue;
        }
        if (current)
            declare(*current, line);
    }

    return shared;
}

struct Answers {
    std::map<std::string, std::set<int>> errors;
    std::map<std::string, std::set<int>> schemas;
};

// Every route's responses, status by status, with each shared response a status refers to read
// in place. Schemas and errors met outside a status, in a request body, are no answer.
Answers publishedAnswers() {
    const auto lines = specLines();
    const auto shared = sharedResponses(lines);

    Answers answers;
    const auto answer = [&answers](const Declared& declared, int status) {
        for (const auto& schema : declared.schemas)
            answers.schemas[schema].insert(status);
        for (const auto& error : declared.errors)
            answers.errors[error].insert(status);
    };

    bool inPaths = false;
    int status = 0;

    for (const auto& line : lines) {
        if (line == "paths:") {
            inPaths = true;
            continue;
        }
        if (!inPaths || line.empty())
            continue;
        if (line.front() != ' ')
            break;

        // A path, a method, or one of a method's own keys: `responses:`, `requestBody:`.
        constexpr size_t kOperationKeyIndent = 6;
        if (indentOf(line) <= kOperationKeyIndent) {
            status = 0;
            continue;
        }

        // A status often refers to a shared response on its own line: `"403": { $ref: ... }`.
        if (const auto key = statusKeyAt(line, 8); !key.empty())
            status = std::stoi(key);
        if (status == 0)
            continue;

        Declared declared;
        declare(declared, line);
        answer(declared, status);

        for (const auto& name : referenced(line, "responses")) {
            const auto found = shared.find(name);
            REQUIRE_MESSAGE(found != shared.end(), "contract/openapi.yaml refers to ", name,
                            " and declares no such response");
            answer(found->second, status);
        }
    }

    return answers;
}

}  // namespace

std::map<std::string, std::set<int>> publishedErrorExamples() {
    return publishedAnswers().errors;
}

std::map<std::string, std::set<int>> publishedSchemaStatuses() {
    return publishedAnswers().schemas;
}

std::map<std::string, std::string> publishedInfo() {
    constexpr size_t kFieldIndent = 2;

    std::map<std::string, std::string> info;
    bool inInfo = false;

    for (const auto& line : specLines()) {
        if (indentOf(line) == 0 && !line.empty()) {
            if (inInfo)
                break;
            inInfo = line == "info:";
            continue;
        }
        if (!inInfo || indentOf(line) != kFieldIndent || line[kFieldIndent] == '#')
            continue;

        const auto colon = line.find(": ", kFieldIndent);
        if (colon == std::string::npos)
            continue;
        info[line.substr(kFieldIndent, colon - kFieldIndent)] = trimmed(line.substr(colon + 2));
    }

    REQUIRE_MESSAGE(info.contains("version"), "contract/openapi.yaml has no info.version");
    return info;
}

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
    const std::string flow = std::string(kEnumIndent, ' ') + "enum: [";

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
            if (startsWith(line, flow) && line.back() == ']') {
                const auto inside = line.substr(flow.size(), line.size() - flow.size() - 1);
                const auto items = flowItems(inside);
                values.insert(values.end(), items.begin(), items.end());
            }
            continue;
        }

        if (inEnum && startsWith(line, bullet))
            values.push_back(line.substr(bullet.size()));
    }

    REQUIRE_MESSAGE(!values.empty(), "contract/openapi.yaml publishes no enum at ", schema, ".",
                    property);
    return values;
}

std::vector<std::string> publishedRequired(const std::string& schema, const std::string& property) {
    constexpr size_t kSchemasIndent = 2;
    constexpr size_t kSchemaIndent = 4;
    constexpr size_t kSchemaKeyIndent = 6;
    constexpr size_t kPropertyIndent = 8;
    bool inSchemas = false;
    bool inSchema = false;
    bool inProperties = false;
    bool inProperty = false;

    const auto lines = specLines();
    for (size_t at = 0; at < lines.size(); ++at) {
        const auto& line = lines[at];
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
            inProperties = inProperty = false;
            continue;
        }
        if (!inSchema)
            continue;

        if (indent == kSchemaKeyIndent) {
            inProperties = keyAt(line, kSchemaKeyIndent, "properties:");
            inProperty = false;
        } else if (inProperties && indent == kPropertyIndent) {
            inProperty = !property.empty() && keyAt(line, kPropertyIndent, property + ":");
            continue;
        }

        const bool wanted = property.empty() ? indent == kSchemaKeyIndent : inProperty;
        if (!wanted)
            continue;
        if (const auto inside = flowInsideAt(lines, at, "required"))
            return flowItems(*inside);
    }

    FAIL("contract/openapi.yaml publishes no required list at ", schema,
         property.empty() ? "" : "." + property);
    return {};
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

// Bracketed by its path first, as `publishedStatePlayerExample` is: example names repeat across
// routes, so one found without its path could be another route's.
std::vector<std::string> publishedExampleList(const std::string& path, const std::string& example,
                                              const std::string& key) {
    constexpr size_t kPathIndent = 2;
    const std::string pathLine = std::string(kPathIndent, ' ') + path + ":";

    bool inPaths = false;
    bool inPath = false;
    size_t exampleIndent = std::string::npos;

    const auto lines = specLines();
    for (size_t at = 0; at < lines.size(); ++at) {
        const auto& line = lines[at];
        if (line == "paths:") {
            inPaths = true;
            continue;
        }
        if (!inPaths || line.empty())
            continue;
        if (line.front() != ' ')
            break;

        if (startsWith(line, std::string(kPathIndent, ' ') + '/')) {
            inPath = line == pathLine;
            exampleIndent = std::string::npos;
            continue;
        }
        if (!inPath)
            continue;

        const auto indent = indentOf(line);
        if (indent == std::string::npos)
            continue;

        const auto text = line.substr(indent);
        if (exampleIndent == std::string::npos) {
            if (text == example + ":")
                exampleIndent = indent;
            continue;
        }
        if (indent <= exampleIndent)
            break;

        if (const auto inside = flowInsideAt(lines, at, key)) {
            if (inside->empty())
                return {};

            auto items = flowItems(*inside);
            std::transform(items.begin(), items.end(), items.begin(), unquoted);
            return items;
        }
    }

    FAIL("contract/openapi.yaml's ", path, " path shows no ", key, " list in its ", example,
         " example");
    return {};
}

std::multiset<std::string> inAnyOrder(const std::vector<std::string>& names) {
    return {names.begin(), names.end()};
}

std::string dialable(const std::string& path) {
    std::string filled = "/api" + path;
    for (auto open = filled.find('{'); open != std::string::npos; open = filled.find('{')) {
        const auto close = filled.find('}', open);
        const auto name = filled.substr(open, close - open + 1);
        const char* value = "0";
        if (name == "{id}")
            value = kPlaylistId;
        else if (name == "{role}")
            value = "scratch";
        filled.replace(open, name.size(), value);
    }
    return filled;
}

}  // namespace jean::testing
