#include "support/runs_cases.h"

#include "support/summary_cases.h"

#include "third_party/doctest.h"

#include <algorithm>

namespace jean::testing {

namespace {

const nlohmann::json& namedIn(const nlohmann::json& cases, const std::string_view name) {
    const auto found = std::find_if(cases.begin(), cases.end(), [name](const nlohmann::json& one) {
        return one.at("name").get_ref<const std::string&>() == name;
    });
    REQUIRE_MESSAGE(found != cases.end(), "no case is named ", std::string(name));
    return *found;
}

}  // namespace

const nlohmann::json& runsCases() {
    return casesIn("library_runs_cases.json").at("cases");
}

RunsCase runsCaseOf(const nlohmann::json& expected) {
    const std::string name = expected.at("name").get<std::string>();
    const std::string source = expected.at("source").get<std::string>();
    const nlohmann::json& libraryCase = namedIn(casesIn(source.c_str()).at("cases"), name);
    return {name, questionLibraryOf(libraryCase),
            expected.at("lengths").get<std::vector<uint32_t>>(),
            expected.at("covers").get<std::vector<uint32_t>>(),
            expected.at("untagged").get<std::vector<uint32_t>>()};
}

RunsCase runsCase(const std::string_view name) {
    return runsCaseOf(namedIn(runsCases(), name));
}

std::map<std::string, std::string> expressionsOf(const QuestionLibrary& library) {
    std::map<std::string, std::string> expressions;
    for (const RoleAsked& role : library.roles)
        expressions.emplace(role.name, role.expression);
    return expressions;
}

LibraryRoles rolesOf(const Snapshot& snapshot, const QuestionLibrary& library) {
    const auto roles = rolesIn(snapshot, expressionsOf(library));
    REQUIRE(roles.has_value());
    return *roles;
}

std::string runsPath(const std::vector<RoleAsked>& roles) {
    return questionPath("runs", {}, roles);
}

}  // namespace jean::testing
